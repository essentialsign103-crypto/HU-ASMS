// HU-ASMS: Representative Create Assignment/Project Conversation (Phase B — Core Workflow)
// Flow:
//   1. Rep selects their section (derived from assignment).
//   2. Rep selects a course offering in that section.
//   3. Rep fills in project details: title, description, type, deadline, file rules.
//   4. Preview + confirm.
//   5. Project is created with project_target scoped to the rep's section.
//
// Authorization: validated against representative_assignments.section_id at every step.
// Once published, the project record is read-only for students (they cannot modify it).
// Representatives who need to update an existing project should use the web portal.

import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import {
  CourseOfferingService,
  AcademicManagementService,
} from '@hu-asms/database';
import { RepresentativeService } from '../services/representative.service.js';
import { requirePrivateChat } from '../utils/chat-guard.js';
import { getRepresentativeMainMenuKeyboard } from '../keyboards/main-menu.js';
import { formatDateUTC } from '@hu-asms/shared';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

function parseDeadline(input: string): Date | null {
  // Accept YYYY-MM-DD or YYYY-MM-DD HH:MM
  const cleaned = input.trim();
  const date = new Date(cleaned.includes('T') ? cleaned : `${cleaned}T23:59:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

export async function repCreateProjectConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'assignment creation'))) return;

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Could not identify your Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  // 1. Resolve representative
  const repData = await conversation.external(() =>
    repService.getRepresentativeProfile(telegramUserId)
  );

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return;
  }

  // 2. Select section (if multiple)
  let selectedSectionId: string;
  let selectedAcademicYearId: string;
  let selectedSectionName: string;

  if (repData.assignments.length === 1) {
    const a = repData.assignments[0];
    selectedSectionId = a.section_id;
    selectedAcademicYearId = a.section?.academic_year_id || '';
    selectedSectionName = `${a.section?.academic_year?.name || ''} — ${a.section?.name || ''}`;
  } else {
    const keyboard = new InlineKeyboard();
    repData.assignments.forEach((a) => {
      keyboard.text(
        `${a.section?.academic_year?.name || ''} — ${a.section?.name || a.section_id}`,
        `rpj_sec_${a.section_id}`
      ).row();
    });

    await ctx.reply(`📝 *Create Assignment*\n\nSelect a section:`, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    const secCb = await conversation.waitForCallbackQuery(/^rpj_sec_/);
    selectedSectionId = secCb.callbackQuery.data.replace('rpj_sec_', '');
    const a = repData.assignments.find((x) => x.section_id === selectedSectionId);
    selectedAcademicYearId = a?.section?.academic_year_id || '';
    selectedSectionName = `${a?.section?.academic_year?.name || ''} — ${a?.section?.name || ''}`;
    await secCb.answerCallbackQuery({ text: selectedSectionName });
  }

  // 3. List course offerings in this section
  const cso = new CourseOfferingService(supabase);
  const offerings = await conversation.external(() =>
    cso.getOfferingsForSection(selectedSectionId)
  );

  if (offerings.length === 0) {
    await ctx.reply(
      `⚠️ No courses found for *${selectedSectionName}*.\n` +
        `Use *➕ Create Course* first to add a course before creating assignments.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
    return;
  }

  const courseKeyboard = new InlineKeyboard();
  offerings.forEach((off) => {
    courseKeyboard
      .text(`${off.course?.code}: ${off.course?.title?.substring(0, 30) || ''}`, `rpj_off_${off.id}`)
      .row();
  });
  courseKeyboard.text('❌ Cancel', 'rpj_cancel');

  await ctx.reply(
    `📝 *Create Assignment*\n` +
      `Section: *${selectedSectionName}*\n\n` +
      `Select a course:`,
    { parse_mode: 'Markdown', reply_markup: courseKeyboard }
  );

  const offCb = await conversation.waitForCallbackQuery(/^rpj_(off_|cancel)/);
  if (offCb.callbackQuery.data === 'rpj_cancel') {
    await offCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Assignment creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  const selectedOfferingId = offCb.callbackQuery.data.replace('rpj_off_', '');
  const selectedOffering = offerings.find((o) => o.id === selectedOfferingId);
  if (!selectedOffering) {
    await offCb.answerCallbackQuery({ text: 'Offering not found.' });
    await ctx.reply('❌ Course offering not found.');
    return;
  }
  await offCb.answerCallbackQuery({ text: selectedOffering.course?.code || 'Course selected' });

  // 4. Assignment title
  await ctx.reply(
    `📝 *Assignment Title*\n\n` +
      `Course: *${selectedOffering.course?.code} — ${selectedOffering.course?.title}*\n\n` +
      `Enter the assignment or project title (max ${MAX_TITLE_LENGTH} chars):\n` +
      `_(Send /cancel to abort)_`,
    { parse_mode: 'Markdown' }
  );
  const titleMsg = await conversation.waitFor(':text');
  const title = titleMsg.message?.text?.trim() || '';
  if (title.length < 3 || title.length > MAX_TITLE_LENGTH) {
    await ctx.reply(`❌ Title must be between 3 and ${MAX_TITLE_LENGTH} characters. Please restart.`);
    return;
  }

  // 5. Description / instructions
  await ctx.reply(
    `📄 *Instructions (Optional)*\n\n` +
      `Enter the assignment instructions or description.\n` +
      `Students will see this as the official assignment brief.\n` +
      `Send a dash \`-\` to skip.`,
    { parse_mode: 'Markdown' }
  );
  const descMsg = await conversation.waitFor(':text');
  const rawDesc = descMsg.message?.text?.trim() || '';
  const description =
    rawDesc === '-' ? null : rawDesc.substring(0, MAX_DESCRIPTION_LENGTH) || null;

  // 6. Submission type
  const typeKeyboard = new InlineKeyboard()
    .text('👤 Individual', 'rpj_type_individual')
    .text('👥 Group', 'rpj_type_group')
    .text('👤👥 Both', 'rpj_type_both');

  await ctx.reply(`📤 *Submission Type*\n\nHow will students submit this assignment?`, {
    parse_mode: 'Markdown',
    reply_markup: typeKeyboard,
  });

  const typeCb = await conversation.waitForCallbackQuery(/^rpj_type_/);
  const submissionType = typeCb.callbackQuery.data.replace('rpj_type_', '') as
    | 'individual'
    | 'group'
    | 'both';
  await typeCb.answerCallbackQuery({ text: submissionType });

  // 7. Deadline
  await ctx.reply(
    `📅 *Deadline*\n\n` +
      `Enter the submission deadline in ISO format:\n` +
      `• Date only: \`2026-12-15\` (assumes 23:59 UTC)\n` +
      `• Date + time: \`2026-12-15T17:00:00Z\``,
    { parse_mode: 'Markdown' }
  );

  let deadline: Date | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const deadlineMsg = await conversation.waitFor(':text');
    deadline = parseDeadline(deadlineMsg.message?.text?.trim() || '');
    if (deadline && deadline > new Date()) break;
    deadline = null;
    await ctx.reply('❌ Invalid or past deadline. Please enter a future date/time (YYYY-MM-DD):');
  }

  if (!deadline) {
    await ctx.reply('❌ Could not parse a valid future deadline after 3 attempts. Please restart.');
    return;
  }

  // 8. Max file size (simple MB input)
  await ctx.reply(
    `📦 *Maximum File Size (MB)*\n\nEnter the maximum allowed file size in megabytes (1–20).\nSend \`20\` for the default 20 MB limit.`,
    { parse_mode: 'Markdown' }
  );
  const sizeMsg = await conversation.waitFor(':text');
  const sizeMb = Math.min(20, Math.max(1, parseInt(sizeMsg.message?.text?.trim() || '20', 10) || 20));
  const maxSizeBytes = sizeMb * 1024 * 1024;

  // 9. Group size bounds (only for group/both)
  let minGroup = 1;
  let maxGroup = 1;

  if (submissionType === 'group' || submissionType === 'both') {
    await ctx.reply(
      `👥 *Group Size*\n\nEnter minimum and maximum group size.\nFormat: \`min max\` (e.g. \`2 5\`)`,
      { parse_mode: 'Markdown' }
    );
    const groupSizeMsg = await conversation.waitFor(':text');
    const parts = (groupSizeMsg.message?.text?.trim() || '2 5').split(/\s+/);
    minGroup = Math.max(1, parseInt(parts[0] || '2', 10) || 2);
    maxGroup = Math.max(minGroup, parseInt(parts[1] || '5', 10) || 5);
  }

  // 10. Opening date — now
  const openingDate = new Date();

  // 11. Preview + confirm
  const confirmKeyboard = new InlineKeyboard()
    .text('✅ Publish Assignment', 'rpj_confirm')
    .row()
    .text('❌ Cancel', 'rpj_cancel');

  const typeBadge =
    submissionType === 'group' ? '👥 Group' : submissionType === 'both' ? '👤👥 Both' : '👤 Individual';

  let preview =
    `📋 *Assignment Preview*\n` +
    `───────────────────────────\n` +
    `• *Title:* ${title}\n` +
    `• *Course:* ${selectedOffering.course?.code} — ${selectedOffering.course?.title}\n` +
    `• *Section:* ${selectedSectionName}\n` +
    `• *Teacher:* ${selectedOffering.teacher?.full_name}\n` +
    `• *Type:* ${typeBadge}\n` +
    `• *Deadline:* ${formatDateUTC(deadline.toISOString())}\n` +
    `• *Max File Size:* ${sizeMb} MB\n`;

  if (description) {
    preview += `• *Instructions:* _${description.substring(0, 100)}${description.length > 100 ? '…' : ''}_\n`;
  }
  if (submissionType !== 'individual') {
    preview += `• *Group Size:* ${minGroup}–${maxGroup} members\n`;
  }

  preview +=
    `\n⚠️ *Once published, students can see and submit this assignment.*\n` +
    `Publish now?`;

  await ctx.reply(preview, { parse_mode: 'Markdown', reply_markup: confirmKeyboard });

  const finalCb = await conversation.waitForCallbackQuery(['rpj_confirm', 'rpj_cancel']);
  if (finalCb.callbackQuery.data === 'rpj_cancel') {
    await finalCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Assignment creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  // 12. Create project
  const academicService = new AcademicManagementService(supabase);

  try {
    const project = await conversation.external(() =>
      academicService.createProject({
        course_id: selectedOffering.course_id,
        teacher_id: selectedOffering.teacher_id,
        title,
        description: description || undefined,
        submission_type: submissionType,
        opening_date: openingDate.toISOString(),
        deadline: deadline!.toISOString(),
        resubmission_allowed: true,
        is_active: true,
        created_by: repData.profile.id,
        targets: [
          {
            academic_year_id: selectedAcademicYearId,
            section_id: selectedSectionId,
          },
        ],
        file_rules: {
          allowed_extensions: ['pdf'],
          allowed_mime_types: ['application/pdf'],
          max_file_size_bytes: maxSizeBytes,
          min_group_size: minGroup,
          max_group_size: maxGroup,
        },
      })
    );

    await finalCb.answerCallbackQuery({ text: 'Published!' });
    await ctx.reply(
      `🎉 *Assignment Published!*\n\n` +
        `• *Title:* ${project.title}\n` +
        `• *Course:* ${project.course?.code} — ${project.course?.title}\n` +
        `• *Section:* ${selectedSectionName}\n` +
        `• *Deadline:* ${formatDateUTC(project.deadline)}\n\n` +
        `Students in *${selectedSectionName}* can now view and submit this assignment via their bot menu.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalCb.answerCallbackQuery({ text: 'Error' });
    await ctx.reply(`❌ *Failed to create assignment:*\n${msg}`, { parse_mode: 'Markdown' });
  }
}
