// HU-ASMS: Representative Manage Groups Conversation (Phase D — Core Workflow)
// Provides the representative with a Telegram-native group creation flow:
//   section → project → group code → members (from section roster) → leader → confirm
//
// Authorization: representative's Telegram ID → active assignment → section_id.
// DB-level triggers enforce section membership, leader identity, group size bounds,
// and submission type compatibility (group/both only).
// Existing groups are displayed as read-only via the existing handleRepViewGroups handler.

import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { RepresentativeService } from '../services/representative.service.js';
import { requirePrivateChat } from '../utils/chat-guard.js';
import { getRepresentativeMainMenuKeyboard } from '../keyboards/main-menu.js';

const MAX_GROUP_CODE_LENGTH = 30;

export async function repManageGroupsConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'group management'))) return;

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

  // 2. Present group management menu
  const menuKeyboard = new InlineKeyboard()
    .text('➕ Create New Group', 'rmg_action_create')
    .row()
    .text('👥 View My Groups', 'rmg_action_view')
    .row()
    .text('❌ Cancel', 'rmg_action_cancel');

  await ctx.reply(
    `👥 *Manage Groups*\n\nWhat would you like to do?`,
    { parse_mode: 'Markdown', reply_markup: menuKeyboard }
  );

  const actionCb = await conversation.waitForCallbackQuery(/^rmg_action_/);
  const action = actionCb.callbackQuery.data.replace('rmg_action_', '');

  if (action === 'cancel') {
    await actionCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Group management cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  if (action === 'view') {
    await actionCb.answerCallbackQuery({ text: 'Loading groups…' });
    // Fetch and display groups for all assigned sections
    const assignedSectionIds = repData.assignments.map((a) => a.section_id);
    const { data: groups, error } = await conversation.external(async () => {
      return supabase
        .from('groups')
        .select(`
          id, group_code, status,
          project:projects(title, course:courses(code)),
          section:sections(name, academic_year:academic_years(name)),
          leader:students!groups_group_leader_id_fkey(full_name, hu_student_id),
          members:group_members(confirmation_status)
        `)
        .in('section_id', assignedSectionIds)
        .order('group_code', { ascending: true })
        .limit(20);
    });

    if (error || !groups || groups.length === 0) {
      await ctx.reply(
        `👥 *Groups in Your Sections*\n\nNo groups have been created yet.\nUse *➕ Create New Group* to create one.`,
        { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
      );
      return;
    }

    let text = `👥 *Groups in Your Sections* (${groups.length})\n───────────────────────────\n\n`;
    (groups as any[]).forEach((grp, idx) => {
      const members = Array.isArray(grp.members) ? grp.members : [];
      const confirmed = members.filter((m: any) => m.confirmation_status === 'confirmed').length;
      const pending = members.filter((m: any) => m.confirmation_status === 'pending').length;
      text +=
        `${idx + 1}. *${grp.group_code}* — ${grp.project?.course?.code}: ${grp.project?.title?.substring(0, 25) || 'Project'}\n` +
        `   Section: ${grp.section?.academic_year?.name} — ${grp.section?.name}\n` +
        `   Status: \`${String(grp.status).toUpperCase()}\` | ✅ ${confirmed} confirmed${pending > 0 ? ` / ⏳ ${pending} pending` : ''}\n` +
        `   Leader: ${grp.leader?.full_name || 'None assigned'}\n\n`;
    });

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  // ── CREATE GROUP FLOW ──────────────────────────────────────────────────────

  await actionCb.answerCallbackQuery({ text: 'Starting group creation…' });

  // 3. Select section (if multiple)
  let selectedSectionId: string;
  let selectedSectionName: string;

  if (repData.assignments.length === 1) {
    selectedSectionId = repData.assignments[0].section_id;
    selectedSectionName = `${repData.assignments[0].section?.academic_year?.name || ''} — ${repData.assignments[0].section?.name || ''}`;
  } else {
    const secKeyboard = new InlineKeyboard();
    repData.assignments.forEach((a) => {
      secKeyboard.text(
        `${a.section?.academic_year?.name || ''} — ${a.section?.name || a.section_id}`,
        `rmg_sec_${a.section_id}`
      ).row();
    });

    await ctx.reply(`Select section for the new group:`, { reply_markup: secKeyboard });
    const secCb = await conversation.waitForCallbackQuery(/^rmg_sec_/);
    selectedSectionId = secCb.callbackQuery.data.replace('rmg_sec_', '');
    const a = repData.assignments.find((x) => x.section_id === selectedSectionId);
    selectedSectionName = `${a?.section?.academic_year?.name || ''} — ${a?.section?.name || ''}`;
    await secCb.answerCallbackQuery({ text: selectedSectionName });
  }

  // 4. Select project (group/both only)
  const projects = await conversation.external(() =>
    repService.getSectionProjects(telegramUserId, selectedSectionId)
  );

  const groupProjects = projects.filter(
    (p) => p.submission_type === 'group' || p.submission_type === 'both'
  );

  if (groupProjects.length === 0) {
    await ctx.reply(
      `⚠️ No group-type assignments found for *${selectedSectionName}*.\n\nCreate a "Group" or "Both" type assignment first.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
    return;
  }

  const projectKeyboard = new InlineKeyboard();
  groupProjects.forEach((p) => {
    projectKeyboard.text(
      `${p.course?.code || '?'}: ${p.title.substring(0, 30)}`,
      `rmg_proj_${p.id}`
    ).row();
  });

  await ctx.reply(`📂 Select the assignment for this group:`, { reply_markup: projectKeyboard });
  const projCb = await conversation.waitForCallbackQuery(/^rmg_proj_/);
  const selectedProjectId = projCb.callbackQuery.data.replace('rmg_proj_', '');
  const selectedProject = groupProjects.find((p) => p.id === selectedProjectId);
  if (!selectedProject) {
    await projCb.answerCallbackQuery({ text: 'Not found' });
    await ctx.reply('❌ Project not found.');
    return;
  }
  await projCb.answerCallbackQuery({ text: selectedProject.title.substring(0, 30) });

  // 5. Group code
  await ctx.reply(
    `🔤 *Group Code*\n\nEnter a short identifier for this group (max ${MAX_GROUP_CODE_LENGTH} chars).\nExamples: \`Group 01\`, \`Team Alpha\`, \`DB-G3\``,
    { parse_mode: 'Markdown' }
  );
  const codeMsg = await conversation.waitFor(':text');
  const groupCode = (codeMsg.message?.text?.trim() || '').substring(0, MAX_GROUP_CODE_LENGTH);
  if (groupCode.length < 2) {
    await ctx.reply('❌ Group code too short. Please restart.');
    return;
  }

  // 6. Select members from section roster
  const sectionStudents = await conversation.external(() =>
    repService.getSectionStudents(telegramUserId, selectedSectionId)
  );

  const eligibleStudents = sectionStudents.filter(
    (s) => s.registration_status === 'approved' || s.registration_status === 'locked'
  );

  if (eligibleStudents.length === 0) {
    await ctx.reply(
      `⚠️ No eligible approved students found in *${selectedSectionName}*.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
    return;
  }

  // Build paginated member selection (up to 8 at a time)
  const PAGE_SIZE = 8;
  const selectedMemberIds: string[] = [];

  const renderMemberKeyboard = (page: number) => {
    const start = page * PAGE_SIZE;
    const slice = eligibleStudents.slice(start, start + PAGE_SIZE);
    const kb = new InlineKeyboard();
    slice.forEach((s) => {
      const isSelected = selectedMemberIds.includes(s.id);
      kb.text(
        `${isSelected ? '✅ ' : ''}${s.full_name.substring(0, 25)} (${s.hu_student_id})`,
        `rmg_mbr_${s.id}`
      ).row();
    });
    if (eligibleStudents.length > PAGE_SIZE) {
      if (page > 0) kb.text('⬅ Prev', `rmg_pg_${page - 1}`);
      if (start + PAGE_SIZE < eligibleStudents.length) kb.text('Next ➡', `rmg_pg_${page + 1}`);
      kb.row();
    }
    kb.text(`✅ Done (${selectedMemberIds.length} selected)`, 'rmg_mbr_done').row();
    kb.text('❌ Cancel', 'rmg_mbr_cancel');
    return kb;
  };

  let page = 0;
  const fileRules = selectedProject.file_rules;
  const minSize = fileRules?.min_group_size ?? 1;
  const maxSize = fileRules?.max_group_size ?? 10;

  await ctx.reply(
    `👥 *Select Group Members*\n` +
      `Group code: *${groupCode}*\n` +
      `Required: ${minSize}–${maxSize} members\n\n` +
      `Tap a student to add/remove them from the group:`,
    { parse_mode: 'Markdown', reply_markup: renderMemberKeyboard(page) }
  );

  while (true) {
    const memberCb = await conversation.waitForCallbackQuery(/^rmg_(mbr_|pg_)/);
    const data = memberCb.callbackQuery.data;

    if (data === 'rmg_mbr_done') {
      if (selectedMemberIds.length < minSize) {
        await memberCb.answerCallbackQuery({
          text: `Select at least ${minSize} member(s). Currently: ${selectedMemberIds.length}.`,
          show_alert: true,
        });
        continue;
      }
      if (selectedMemberIds.length > maxSize) {
        await memberCb.answerCallbackQuery({
          text: `Maximum is ${maxSize} members. Currently: ${selectedMemberIds.length}.`,
          show_alert: true,
        });
        continue;
      }
      await memberCb.answerCallbackQuery({ text: 'Members selected' });
      break;
    }

    if (data === 'rmg_mbr_cancel') {
      await memberCb.answerCallbackQuery({ text: 'Cancelled' });
      await ctx.reply('Group creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
      return;
    }

    if (data.startsWith('rmg_pg_')) {
      page = parseInt(data.replace('rmg_pg_', ''), 10) || 0;
      await memberCb.answerCallbackQuery();
      await ctx.reply(`Page ${page + 1}:`, { reply_markup: renderMemberKeyboard(page) });
      continue;
    }

    if (data.startsWith('rmg_mbr_')) {
      const studentId = data.replace('rmg_mbr_', '');
      if (selectedMemberIds.includes(studentId)) {
        selectedMemberIds.splice(selectedMemberIds.indexOf(studentId), 1);
        await memberCb.answerCallbackQuery({ text: 'Removed' });
      } else {
        selectedMemberIds.push(studentId);
        await memberCb.answerCallbackQuery({ text: 'Added' });
      }
      await ctx.reply(
        `${selectedMemberIds.length} member(s) selected. Continue selecting or tap ✅ Done:`,
        { reply_markup: renderMemberKeyboard(page) }
      );
    }
  }

  // 7. Select group leader from chosen members
  const chosenMembers = eligibleStudents.filter((s) => selectedMemberIds.includes(s.id));
  const leaderKeyboard = new InlineKeyboard();
  chosenMembers.forEach((s) => {
    leaderKeyboard.text(
      `${s.full_name.substring(0, 30)} (${s.hu_student_id})`,
      `rmg_ldr_${s.id}`
    ).row();
  });

  await ctx.reply(
    `🎖️ *Select Group Leader*\n\nThe leader is the only member authorized to upload the group file:`,
    { parse_mode: 'Markdown', reply_markup: leaderKeyboard }
  );

  const leaderCb = await conversation.waitForCallbackQuery(/^rmg_ldr_/);
  const leaderId = leaderCb.callbackQuery.data.replace('rmg_ldr_', '');
  const leader = chosenMembers.find((s) => s.id === leaderId);
  if (!leader) {
    await leaderCb.answerCallbackQuery({ text: 'Not found' });
    await ctx.reply('❌ Leader not found.');
    return;
  }
  await leaderCb.answerCallbackQuery({ text: `Leader: ${leader.full_name}` });

  // 8. Confirm
  const memberList = chosenMembers.map((s) => `• ${s.full_name} (\`${s.hu_student_id}\`)`).join('\n');
  const confirmKb = new InlineKeyboard()
    .text('✅ Create Group', 'rmg_confirm')
    .text('❌ Cancel', 'rmg_cancel');

  await ctx.reply(
    `📋 *Confirm Group Creation*\n` +
      `───────────────────────────\n` +
      `• *Code:* ${groupCode}\n` +
      `• *Assignment:* ${selectedProject.course?.code}: ${selectedProject.title}\n` +
      `• *Section:* ${selectedSectionName}\n` +
      `• *Leader:* ${leader.full_name}\n` +
      `• *Members (${chosenMembers.length}):*\n${memberList}\n\n` +
      `Students will receive a membership confirmation request.`,
    { parse_mode: 'Markdown', reply_markup: confirmKb }
  );

  const confirmCb = await conversation.waitForCallbackQuery(['rmg_confirm', 'rmg_cancel']);
  if (confirmCb.callbackQuery.data === 'rmg_cancel') {
    await confirmCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Group creation cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  // 9. Create group + members in DB
  try {
    // Insert group
    const { data: group, error: groupErr } = await conversation.external(async () => {
      return supabase
        .from('groups')
        .insert({
          project_id: selectedProjectId,
          section_id: selectedSectionId,
          group_code: groupCode,
          group_leader_id: leaderId,
          status: 'pending',
          created_by: repData.profile.id,
        })
        .select()
        .single();
    });

    if (groupErr || !group) {
      throw new Error(groupErr?.message || 'Failed to create group record.');
    }

    // Insert members
    const memberPayloads = chosenMembers.map((s) => ({
      group_id: group.id,
      student_id: s.id,
      confirmation_status: 'pending',
      is_group_leader: s.id === leaderId,
    }));

    const { error: memberErr } = await conversation.external(async () => {
      return supabase.from('group_members').insert(memberPayloads);
    });

    if (memberErr) {
      // Rollback group
      await conversation.external(() =>
        supabase.from('groups').delete().eq('id', group.id)
      );
      throw new Error(`Failed to add group members: ${memberErr.message}`);
    }

    await confirmCb.answerCallbackQuery({ text: 'Group created!' });
    await ctx.reply(
      `✅ *Group Created Successfully!*\n\n` +
        `• *Code:* ${groupCode}\n` +
        `• *Assignment:* ${selectedProject.title}\n` +
        `• *${chosenMembers.length} members* have been notified to confirm membership via /start.\n\n` +
        `The group will be marked *Verified* once all members confirm.`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await confirmCb.answerCallbackQuery({ text: 'Error' });
    await ctx.reply(`❌ *Group creation failed:*\n${msg}`, { parse_mode: 'Markdown' });
  }
}
