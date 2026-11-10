// HU-ASMS: Group Submission Interactive Conversation (Phase 09)
// Enforces group verification check, sole leader submitter check, duplicate prevention, and team snapshotting

import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { GroupSubmissionService, GroupSubmissionError } from '../services/group-submission.service.js';
import { NotificationService } from '../services/notification.service.js';
import { getSupabaseAdminClient, DatabaseService } from '@hu-asms/database';
import { formatDateUTC, formatFileSize, BOT_MESSAGES } from '@hu-asms/shared';

export async function groupSubmissionConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Telegram account cannot be identified.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const db = new DatabaseService(supabase);
  const notificationService = new NotificationService(supabase, (chatId, msg) =>
    ctx.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' })
  );
  const groupSubmissionService = new GroupSubmissionService(supabase, notificationService);

  // 1. Resolve registered student identity
  const student = await conversation.external(() =>
    db.findStudentByTelegramId(telegramUserId)
  );

  if (!student) {
    await ctx.reply('⚠️ Please register your official student identity first using /start.');
    return;
  }

  if (student.registration_status === 'suspended') {
    await ctx.reply('⛔ Your student account is currently suspended. Submissions are disabled.');
    return;
  }

  // 2. Query groups student is a member of
  const { data: memberEntries, error: memberErr } = await conversation.external(async () => {
    return await supabase
      .from('group_members')
      .select(`
        *,
        group:groups(
          *,
          project:projects(*, file_rules:project_file_rules(*), course:courses(*), teacher:teachers(*)),
          section:sections(*, academic_year:academic_years(*)),
          leader:students!groups_group_leader_id_fkey(*),
          members:group_members(*, student:students(*))
        )
      `)
      .eq('student_id', student.id)
      .neq('confirmation_status', 'removed');
  });

  if (memberErr || !memberEntries || memberEntries.length === 0) {
    await ctx.reply(
      `📭 *No Group Assignments Found*\n\n` +
        `You are not currently assigned to any group. Your section representative or instructor must assign you to a group before you can participate in group submissions.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Filter groups for active projects that accept group submissions
  const eligibleGroups = memberEntries
    .map((m: any) => m.group)
    .filter((g: any) => g && g.project && g.project.is_active && (g.project.submission_type === 'group' || g.project.submission_type === 'both'));

  if (eligibleGroups.length === 0) {
    await ctx.reply(
      `📭 *No Active Group Projects*\n\n` +
        `There are currently no active group projects accepting submissions for your groups.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 3. Select group if multiple, or pick the one
  let selectedGroup = eligibleGroups[0];

  if (eligibleGroups.length > 1) {
    const keyboard = new InlineKeyboard();
    eligibleGroups.forEach((grp: any) => {
      keyboard.text(
        `${grp.group_code} — ${grp.project.title.substring(0, 20)}...`,
        `grp_sub_${grp.id}`
      ).row();
    });
    keyboard.text('❌ Cancel', 'grp_sub_cancel');

    await ctx.reply(
      `👥 *Select Group Assignment to Submit*\n\n` +
        `Please choose the group project you wish to submit:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );

    const selection = await conversation.waitForCallbackQuery(/^grp_sub_/);
    if (selection.callbackQuery.data === 'grp_sub_cancel') {
      await selection.answerCallbackQuery({ text: 'Group submission cancelled' });
      await ctx.reply('Group submission process cancelled.');
      return;
    }

    const selectedGroupId = selection.callbackQuery.data.replace('grp_sub_', '');
    selectedGroup = eligibleGroups.find((g: any) => g.id === selectedGroupId);
    if (!selectedGroup) {
      await selection.answerCallbackQuery({ text: 'Group not found' });
      await ctx.reply('Selected group could not be found.');
      return;
    }
    await selection.answerCallbackQuery();
  }

  const project = selectedGroup.project;
  const group = selectedGroup;

  // 4. Verification Gate Check
  if (group.status !== 'verified') {
    const pendingMembers = (group.members || [])
      .filter((m: any) => m.confirmation_status !== 'confirmed')
      .map((m: any) => `• ${m.student?.full_name || 'Student'} (${m.confirmation_status})`)
      .join('\n');

    await ctx.reply(
      `⚠️ *Group Not Verified*\n\n` +
        `Group *${group.group_code}* cannot submit because not all members have confirmed their membership.\n\n` +
        `*Pending Members:*\n${pendingMembers}\n\n` +
        `Every member must confirm membership via Telegram before submissions can be accepted.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 5. Sole Submitter Principle: Must be the designated group leader
  if (group.group_leader_id && group.group_leader_id !== student.id) {
    const leaderName = group.leader?.full_name || 'Designated Group Leader';
    await ctx.reply(
      `⛔ *Unauthorized Submitter*\n\n` +
        `Only the designated group leader (*${leaderName}*) is authorized to submit project files on behalf of *${group.group_code}*.\n\n` +
        `Please coordinate with your group leader to upload the team submission.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 6. Submitter must be confirmed member
  const currentMember = (group.members || []).find((m: any) => m.student_id === student.id);
  if (!currentMember || currentMember.confirmation_status !== 'confirmed') {
    await ctx.reply(
      `⚠️ You have not confirmed your membership in *${group.group_code}*. Please confirm membership before submitting.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 7. Check Project Deadline & Availability
  const now = new Date();
  const openingDate = new Date(project.opening_date);
  const deadline = new Date(project.deadline);

  if (now < openingDate) {
    await ctx.reply(
      `⏳ *Assignment Not Open Yet*\n` +
        `Submissions for *${project.title}* will open on ${formatDateUTC(project.opening_date)}.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (now > deadline) {
    await ctx.reply(
      `⛔ *Submission Deadline Passed*\n` +
        `The deadline for *${project.title}* was ${formatDateUTC(project.deadline)}. Group submissions are closed.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 8. Check existing active group submission
  const existingSub = await conversation.external(() =>
    db.getActiveGroupSubmission(project.id, group.id)
  );

  if (existingSub && !project.resubmission_allowed) {
    await ctx.reply(BOT_MESSAGES.ALREADY_SUBMITTED_GROUP(group.group_code, project.title), {
      parse_mode: 'Markdown',
    });
    return;
  }

  const allowedFormats = project.file_rules?.allowed_extensions?.map((e: string) => `.${e}`).join(', ') || '.pdf';
  const maxSize = project.file_rules?.max_file_size_bytes
    ? formatFileSize(project.file_rules.max_file_size_bytes)
    : '20 MB';

  const confirmedMembersList = (group.members || [])
    .filter((m: any) => m.confirmation_status === 'confirmed')
    .map((m: any) => `• ${m.student?.full_name || 'Member'} (${m.student?.hu_student_id || 'ID'})`)
    .join('\n');

  let promptText =
    `👥 *Upload Group Submission*\n` +
    `───────────────────────────\n` +
    `• *Group:* ${group.group_code}\n` +
    `• *Project:* ${project.title}\n` +
    `• *Course:* ${project.course?.title || 'Academic Course'}\n` +
    `• *Teacher:* ${project.teacher?.full_name || 'Assigned Teacher'}\n` +
    `• *Deadline:* ${formatDateUTC(project.deadline)}\n` +
    `• *Accepted Formats:* \`${allowedFormats}\`\n` +
    `• *Maximum File Size:* ${maxSize}\n\n` +
    `*Verified Team Members Credited:*\n${confirmedMembersList}\n`;

  if (existingSub) {
    promptText += `\n⚠️ *Notice:* Your group previously submitted Version ${existingSub.version}. Uploading a new file will create *Version ${existingSub.version + 1}* and supersede the earlier submission.\n`;
  }

  promptText += `\n📎 *Please send your team's document now as a Telegram file attachment:*`;

  await ctx.reply(promptText, { parse_mode: 'Markdown' });

  // 9. Wait for document upload
  const fileMsg = await conversation.waitFor(':document');
  const doc = fileMsg.message?.document;

  if (!doc) {
    await ctx.reply('❌ No valid document received. Please restart via /submit_group.');
    return;
  }

  const filename = doc.file_name || 'group_project.pdf';
  const mimeType = doc.mime_type || 'application/pdf';
  const fileSize = doc.file_size || 0;

  await ctx.reply('⏳ *Processing and securing group submission...*', { parse_mode: 'Markdown' });

  try {
    const result = await conversation.external(() =>
      groupSubmissionService.submitGroupAssignment({
        telegramUserId,
        groupId: group.id,
        projectId: project.id,
        file: {
          originalFilename: filename,
          mimeType,
          sizeBytes: fileSize,
          telegramFileId: doc.file_id,
        },
      })
    );

    const versionLabel = result.isResubmission ? ` (Version ${result.version} - Resubmission)` : '';
    await ctx.reply(
      `🎉 *Group Submission Successfully Received!*${versionLabel}\n\n` +
        `• *Group:* ${group.group_code}\n` +
        `• *Project:* ${project.title}\n` +
        `• *Submitting Leader:* ${student.full_name}\n` +
        `• *Credited Members:* ${result.confirmedMembersCount} verified students\n` +
        `• *File:* \`${filename}\` (${formatFileSize(fileSize)})\n` +
        `• *Submission Version:* ${result.version}\n` +
        `• *Timestamp:* ${new Date().toUTCString()}\n\n` +
        `✅ Your section representative has been automatically notified and will review your group's submission.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: unknown) {
    if (err instanceof GroupSubmissionError) {
      await ctx.reply(`❌ *Group Submission Rejected:* ${err.message}`, { parse_mode: 'Markdown' });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ An unexpected error occurred: ${msg}`);
    }
  }
}
