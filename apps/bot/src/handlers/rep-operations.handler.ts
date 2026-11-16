// HU-ASMS: Representative Operations Center Bot Handlers
// Implements the complete 15-workflow Representative Operations Center
// with strict section-scope authorization, pagination (10/page), 64-byte callbacks,
// and browser-free Telegram delivery.

import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types/context.js';
import { RepresentativeService } from '../services/representative.service.js';
import { RepresentativeReportingService } from '../services/representative-reporting.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { formatDateUTC, formatFileSize } from '@hu-asms/shared';
import { isPrivateTelegramChat, requirePrivateChat } from '../utils/chat-guard.js';
import {
  uuidToBase64Url,
  base64UrlToUuid,
  encodeReportCallback,
} from '../utils/callback-codec.js';
import {
  getRepresentativeOperationsCenterKeyboard,
  getUnifiedMainMenuKeyboard,
} from '../keyboards/main-menu.js';

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// 0. Authorization & Scope Resolver
// ---------------------------------------------------------------------------

export async function resolveAuthorizedRepresentative(
  ctx: BotContext,
  workflowLabel: string
) {
  if (!(await requirePrivateChat(ctx, workflowLabel))) return null;
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return null;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  const reportingService = new RepresentativeReportingService(supabase);
  const repData = await repService.getRepresentativeProfile(telegramUserId);

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply(
      '⚠️ *Access Denied*\n\nYou do not have active section representative permissions.',
      { parse_mode: 'Markdown' }
    );
    return null;
  }

  // Active section scope resolution:
  // Prefer session's activeSectionId if still valid, otherwise default to first assignment
  const fallbackSectionId = repData.assignments[0].section_id;
  const activeSectionId: string =
    ctx.session.activeSectionId &&
    repData.assignments.some((a) => a.section_id === ctx.session.activeSectionId)
      ? ctx.session.activeSectionId
      : fallbackSectionId;

  ctx.session.activeSectionId = activeSectionId;
  const activeAssignment = repData.assignments.find((a) => a.section_id === activeSectionId)!;

  return {
    supabase,
    repService,
    reportingService,
    repData,
    telegramUserId,
    activeSectionId,
    activeAssignment,
  };
}

// ---------------------------------------------------------------------------
// 1. Operations Dashboard
// ---------------------------------------------------------------------------

export async function handleRepDashboard(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'operations dashboard');
  if (!auth) return;
  const { supabase, activeSectionId, activeAssignment, repData } = auth;

  const sectionName = `${activeAssignment.section?.academic_year?.name || 'Year'} — ${activeAssignment.section?.name || 'Section'}`;

  // Parallel fetch telemetry for active scope
  const [
    { count: studentCount },
    { data: projects },
    { count: submissionCount },
    { data: deliveries },
  ] = await Promise.all([
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('section_id', activeSectionId)
      .neq('registration_status', 'suspended'),
    supabase
      .from('projects')
      .select('id, submission_type, is_active, targets:project_targets!inner(section_id, academic_year_id)')
      .eq('is_active', true)
      .or(`academic_year_id.eq.${activeAssignment.section?.academic_year_id}`, { foreignTable: 'targets' })
      .or(`section_id.is.null,section_id.eq.${activeSectionId}`, { foreignTable: 'targets' }),
    supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('section_id', activeSectionId)
      .eq('status', 'active'),
    supabase
      .from('deliveries')
      .select('id, status')
      .eq('section_id', activeSectionId)
      .in('status', ['prepared', 'sent']),
  ]);

  const activeProjects = projects || [];
  const indProjects = activeProjects.filter((p: any) => p.submission_type === 'individual').length;
  const grpProjects = activeProjects.filter((p: any) => p.submission_type === 'group').length;
  const preparedDeliveries = (deliveries || []).filter((d: any) => d.status === 'prepared').length;
  const dispatchedDeliveries = (deliveries || []).filter((d: any) => d.status === 'sent').length;

  const b64Sec = uuidToBase64Url(activeSectionId);
  const kb = new InlineKeyboard()
    .text('👥 Roster', `ro_st:1:${b64Sec}`)
    .text('📂 Projects', `ro_pjs:${b64Sec}`)
    .row()
    .text('📊 Report', `ro_rep:${b64Sec}`)
    .text('📦 Deliveries', `ro_del_lst:${b64Sec}`);

  if (repData.assignments.length > 1) {
    kb.row().text('🔄 Switch Scope', 'ro_sc_menu');
  }

  const msg =
    `📊 *Representative Operations Dashboard*\n` +
    `Scope: *${sectionName}*\n` +
    `───────────────────────────\n` +
    `• 👥 *Enrolled Students:* ${studentCount || 0}\n` +
    `• 📂 *Active Projects:* ${activeProjects.length} (${indProjects} Individual, ${grpProjects} Group)\n` +
    `• 📥 *Active Submissions:* ${submissionCount || 0}\n` +
    `• 📦 *Pending Delivery Batches:* ${preparedDeliveries}\n` +
    `• 🚀 *Dispatched Deliveries:* ${dispatchedDeliveries}\n\n` +
    `_Select a quick action or use the operational keyboard below:_`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

// ---------------------------------------------------------------------------
// 2. My Assigned Sections
// ---------------------------------------------------------------------------

export async function handleRepAssignedSections(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'assigned sections');
  if (!auth) return;
  const { repData, activeSectionId, repService, telegramUserId } = auth;

  let text =
    `🏢 *Your Assigned Academic Scopes*\n` +
    `Representative: *${repData.profile.full_name}*\n` +
    `───────────────────────────\n\n`;

  const kb = new InlineKeyboard();

  for (const assign of repData.assignments) {
    const sec = assign.section;
    if (!sec) continue;
    const isCurrent = assign.section_id === activeSectionId;
    const students = await repService.getSectionStudents(telegramUserId, sec.id);
    const projects = await repService.getSectionProjects(telegramUserId, sec.id);
    const secLabel = `${sec.academic_year?.name || 'Year'} — ${sec.name}`;

    text +=
      `${isCurrent ? '👉 *[ACTIVE SCOPE]*\n' : ''}` +
      `• *${secLabel}*\n` +
      `  - Students: *${students.length}* | Projects: *${projects.length}*\n\n`;

    if (repData.assignments.length > 1) {
      const b64 = uuidToBase64Url(assign.section_id);
      kb.text(
        isCurrent ? `✅ ${sec.name} (Active)` : `Switch to ${sec.name}`,
        `ro_sc:${b64}`
      ).row();
    }
  }

  text += `_All operations are strictly partitioned to your active academic scope._`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: repData.assignments.length > 1 ? kb : undefined,
  });
}

// ---------------------------------------------------------------------------
// 3. My Students (Paginated at 10 per page)
// ---------------------------------------------------------------------------

export async function handleRepMyStudents(
  ctx: BotContext,
  requestedPage = 1,
  requestedSectionId?: string
): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'students roster');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId, repData } = auth;

  const sectionId = requestedSectionId || activeSectionId;
  await repService.assertSectionScope(telegramUserId, sectionId);

  const assign = repData.assignments.find((a) => a.section_id === sectionId);
  const scopeName = `${assign?.section?.academic_year?.name || 'Year'} — ${assign?.section?.name || 'Section'}`;

  // Fetch verified students for section
  const allStudents = await repService.getSectionStudents(telegramUserId, sectionId);
  const eligibleStudents = allStudents.filter(
    (s) => s.registration_status !== 'suspended'
  );

  if (eligibleStudents.length === 0) {
    await ctx.reply(
      `👥 *Section Students Roster*\nScope: *${scopeName}*\n\nNo eligible students enrolled in this section yet.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const totalPages = Math.ceil(eligibleStudents.length / PAGE_SIZE) || 1;
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const pageStudents = eligibleStudents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  let text =
    `👥 *Section Students Roster* (Page ${page}/${totalPages})\n` +
    `Scope: *${scopeName}* | Total: *${eligibleStudents.length}* Students\n` +
    `───────────────────────────\n\n`;

  pageStudents.forEach((s, idx) => {
    const overallIdx = (page - 1) * PAGE_SIZE + idx + 1;
    const lockIcon = s.is_locked ? '🔒' : '⏳';
    const tgIcon = s.telegram_user_id ? '📱 Linked' : '⚠️ No Telegram';
    text +=
      `${overallIdx}. *${s.full_name}*\n` +
      `   • HU ID: \`${s.hu_student_id}\`\n` +
      `   • Status: ${lockIcon} ${s.registration_status.toUpperCase()} | ${tgIcon}\n\n`;
  });

  const b64Sec = uuidToBase64Url(sectionId);
  const kb = new InlineKeyboard();

  if (page > 1) {
    kb.text('◀️ Prev', `ro_st:${page - 1}:${b64Sec}`);
  }
  kb.text(`Page ${page}/${totalPages}`, 'ro_noop');
  if (page < totalPages) {
    kb.text('Next ▶️', `ro_st:${page + 1}:${b64Sec}`);
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: totalPages > 1 ? kb : undefined,
  });
}

// ---------------------------------------------------------------------------
// 4. My Projects
// ---------------------------------------------------------------------------

export async function handleRepMyProjects(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'projects listing');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId, activeAssignment } = auth;

  const projects = await repService.getSectionProjects(telegramUserId, activeSectionId);
  const sectionName = `${activeAssignment.section?.academic_year?.name || ''} — ${activeAssignment.section?.name || ''}`;

  if (projects.length === 0) {
    await ctx.reply(
      `📂 *Section Academic Projects*\nScope: *${sectionName}*\n\n` +
        `No active projects are targeted at this section currently.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `📂 *Academic Projects in Scope*\n` +
    `Scope: *${sectionName}* (${projects.length} Active)\n` +
    `───────────────────────────\n\n`;

  const kb = new InlineKeyboard();

  projects.forEach((proj, idx) => {
    const isGrp = proj.submission_type === 'group';
    const now = new Date();
    const isOpen = new Date(proj.opening_date) <= now && now <= new Date(proj.deadline);
    const statusBadge = isOpen ? '🟢 Open' : '🔴 Closed';

    text +=
      `${idx + 1}. *${proj.title}*\n` +
      `   • Course: ${proj.course?.code || 'Course'} — ${proj.course?.title || ''}\n` +
      `   • Teacher: ${proj.teacher?.full_name || 'Assigned Teacher'}\n` +
      `   • Type: ${isGrp ? '👥 Group' : '👤 Individual'} | ${statusBadge}\n` +
      `   • Deadline: ${formatDateUTC(proj.deadline)}\n\n`;

    const b64Sec = uuidToBase64Url(activeSectionId);
    const b64Proj = uuidToBase64Url(proj.id);
    kb.text(`📊 ${proj.title.substring(0, 20)}`, `rr:${b64Sec}:${b64Proj}`).row();
  });

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

// ---------------------------------------------------------------------------
// 5. Incoming Submissions
// ---------------------------------------------------------------------------

export async function handleRepIncomingSubmissions(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'incoming submissions');
  if (!auth) return;
  const { supabase, activeSectionId, activeAssignment } = auth;

  const sectionName = `${activeAssignment.section?.academic_year?.name || ''} — ${activeAssignment.section?.name || ''}`;

  const { data: subs, error } = await supabase
    .from('submissions')
    .select(`
      id,
      version,
      status,
      submission_type,
      created_at,
      project:projects(title),
      student:students(full_name, hu_student_id),
      group:groups(group_code),
      files:submission_files(original_filename, file_size_bytes)
    `)
    .eq('section_id', activeSectionId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  if (!subs || subs.length === 0) {
    await ctx.reply(
      `📥 *Incoming Submissions*\nScope: *${sectionName}*\n\n` +
        `No submissions recorded yet for this section.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `📥 *Recent Incoming Submissions* (Latest ${subs.length})\n` +
    `Scope: *${sectionName}*\n` +
    `───────────────────────────\n\n`;

  subs.forEach((sub: any, idx: number) => {
    const isGrp = sub.submission_type === 'group';
    const submitter = isGrp
      ? `Team *${sub.group?.group_code || 'Group'}*`
      : `*${sub.student?.full_name || 'Student'}* (\`${sub.student?.hu_student_id}\`)`;
    const file = Array.isArray(sub.files) ? sub.files[0] : sub.files;

    text +=
      `${idx + 1}. ${submitter}\n` +
      `   • Project: ${sub.project?.title || 'Assignment'} (v${sub.version})\n` +
      `   • File: \`${file?.original_filename || 'Attachment'}\` (${formatFileSize(file?.file_size_bytes || 0)})\n` +
      `   • Received: ${formatDateUTC(sub.created_at)}\n\n`;
  });

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

// ---------------------------------------------------------------------------
// 6. Submitted Students Picker & View
// ---------------------------------------------------------------------------

export async function handleRepSubmittedStudents(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'submitted students');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId } = auth;

  const projects = await repService.getSectionProjects(telegramUserId, activeSectionId);
  if (projects.length === 0) {
    await ctx.reply('No active projects available to check submissions.');
    return;
  }

  const kb = new InlineKeyboard();
  const b64Sec = uuidToBase64Url(activeSectionId);

  projects.forEach((p) => {
    const b64Proj = uuidToBase64Url(p.id);
    kb.text(`✅ ${p.title.substring(0, 30)}`, `ro_sub:1:${b64Sec}:${b64Proj}`).row();
  });

  await ctx.reply(
    '✅ *Submitted Students*\nSelect an academic assignment to view submitted work:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleRepSubmittedStudentsProject(
  ctx: BotContext,
  sectionId: string,
  projectId: string,
  page = 1
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const reportingService = new RepresentativeReportingService(supabase);
  await reportingService.assertSectionScope(telegramUserId, sectionId);

  const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single();
  if (!project) {
    await ctx.reply('Project not found.');
    return;
  }

  if (project.submission_type === 'individual') {
    const report = await reportingService.getDetailedIndividualReport(telegramUserId, sectionId, projectId);
    const submitted = report.submittedStudents;

    if (submitted.length === 0) {
      await ctx.reply(
        `✅ *Submitted Students: ${project.title}*\n\nNo students have submitted this assignment yet.`
      );
      return;
    }

    const totalPages = Math.ceil(submitted.length / PAGE_SIZE) || 1;
    const p = Math.max(1, Math.min(page, totalPages));
    const items = submitted.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

    let text =
      `✅ *Submitted Students: ${project.title}* (${submitted.length}/${report.totalEligibleStudents})\n` +
      `Page ${p}/${totalPages}\n───────────────────────────\n\n`;

    items.forEach((item, idx) => {
      const num = (p - 1) * PAGE_SIZE + idx + 1;
      const vTag = item.isResubmission ? ` (v${item.version})` : '';
      text +=
        `${num}. *${item.student.full_name}* (\`${item.student.hu_student_id}\`)${vTag}\n` +
        `   • File: \`${item.fileName}\` (${formatFileSize(item.fileSizeBytes)})\n` +
        `   • Date: ${formatDateUTC(item.submittedAt)}\n\n`;
    });

    const b64Sec = uuidToBase64Url(sectionId);
    const b64Proj = uuidToBase64Url(projectId);
    const kb = new InlineKeyboard();
    if (p > 1) kb.text('◀️ Prev', `ro_sub:${p - 1}:${b64Sec}:${b64Proj}`);
    kb.text(`${p}/${totalPages}`, 'ro_noop');
    if (p < totalPages) kb.text('Next ▶️', `ro_sub:${p + 1}:${b64Sec}:${b64Proj}`);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: totalPages > 1 ? kb : undefined,
    });
  } else {
    // Group Project
    const report = await reportingService.getDetailedGroupReport(telegramUserId, sectionId, projectId);
    const groups = report.submittedGroups;

    if (groups.length === 0) {
      await ctx.reply(
        `✅ *Submitted Teams: ${project.title}*\n\nNo teams have submitted this project yet.`
      );
      return;
    }

    let text =
      `✅ *Submitted Teams: ${project.title}* (${groups.length}/${report.totalGroups} Teams)\n` +
      `───────────────────────────\n\n`;

    groups.forEach((g, idx) => {
      const vTag = g.version > 1 ? ` (v${g.version})` : '';
      const members = g.creditedMembers.map((m) => m.studentName).join(', ');
      text +=
        `${idx + 1}. *Team ${g.group.group_code}*${vTag} (Leader: ${g.submittedByStudentName})\n` +
        `   • Members: _${members || 'None' }_\n` +
        `   • File: \`${g.fileName}\` (${formatFileSize(g.fileSizeBytes)})\n` +
        `   • Date: ${formatDateUTC(g.submittedAt)}\n\n`;
    });

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }
}

// ---------------------------------------------------------------------------
// 7. Not Submitted Students Picker & View
// ---------------------------------------------------------------------------

export async function handleRepNotSubmittedStudents(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'not submitted students');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId } = auth;

  const projects = await repService.getSectionProjects(telegramUserId, activeSectionId);
  if (projects.length === 0) {
    await ctx.reply('No active projects available to check missing submissions.');
    return;
  }

  const kb = new InlineKeyboard();
  const b64Sec = uuidToBase64Url(activeSectionId);

  projects.forEach((p) => {
    const b64Proj = uuidToBase64Url(p.id);
    kb.text(`❌ ${p.title.substring(0, 30)}`, `ro_mis:1:${b64Sec}:${b64Proj}`).row();
  });

  await ctx.reply(
    '❌ *Not Submitted Students*\nSelect an academic assignment to view missing work:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleRepMissingStudentsProject(
  ctx: BotContext,
  sectionId: string,
  projectId: string,
  page = 1
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const reportingService = new RepresentativeReportingService(supabase);
  await reportingService.assertSectionScope(telegramUserId, sectionId);

  const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single();
  if (!project) {
    await ctx.reply('Project not found.');
    return;
  }

  if (project.submission_type === 'individual') {
    const report = await reportingService.getDetailedIndividualReport(telegramUserId, sectionId, projectId);
    const missing = report.missingStudents;

    if (missing.length === 0) {
      await ctx.reply(
        `🎉 *Complete Submissions: ${project.title}*\n\nAll ${report.totalEligibleStudents} eligible students in this section have submitted!`
      );
      return;
    }

    const totalPages = Math.ceil(missing.length / PAGE_SIZE) || 1;
    const p = Math.max(1, Math.min(page, totalPages));
    const items = missing.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

    let text =
      `❌ *Missing Students: ${project.title}* (${missing.length}/${report.totalEligibleStudents} Missing)\n` +
      `Page ${p}/${totalPages}\n───────────────────────────\n\n`;

    items.forEach((item, idx) => {
      const num = (p - 1) * PAGE_SIZE + idx + 1;
      const tgIcon = item.isTelegramLinked ? '📱' : '⚠️ No Telegram';
      text += `${num}. *${item.fullName}* (\`${item.huStudentId}\`) | ${item.registrationStatus} [${tgIcon}]\n`;
    });

    const b64Sec = uuidToBase64Url(sectionId);
    const b64Proj = uuidToBase64Url(projectId);
    const kb = new InlineKeyboard();
    if (p > 1) kb.text('◀️ Prev', `ro_mis:${p - 1}:${b64Sec}:${b64Proj}`);
    kb.text(`${p}/${totalPages}`, 'ro_noop');
    if (p < totalPages) kb.text('Next ▶️', `ro_mis:${p + 1}:${b64Sec}:${b64Proj}`);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: totalPages > 1 ? kb : undefined,
    });
  } else {
    // Group Missing
    const report = await reportingService.getDetailedGroupReport(telegramUserId, sectionId, projectId);
    const missing = report.missingGroups;

    if (missing.length === 0) {
      await ctx.reply(
        `🎉 *Complete Submissions: ${project.title}*\n\nAll ${report.totalGroups} registered teams in this section have submitted!`
      );
      return;
    }

    let text =
      `❌ *Missing Teams: ${project.title}* (${missing.length}/${report.totalGroups} Missing)\n` +
      `───────────────────────────\n\n`;

    missing.forEach((g, idx) => {
      text +=
        `${idx + 1}. *Team ${g.groupCode}* (Leader: ${g.groupLeaderName})\n` +
        `   • Confirmed: ${g.confirmedMembersCount} | Pending: ${g.pendingMembersCount}\n\n`;
    });

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }
}

// ---------------------------------------------------------------------------
// 8. Individual Assignments Summary
// ---------------------------------------------------------------------------

export async function handleRepIndividualAssignments(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'individual assignments');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId, reportingService, activeAssignment } = auth;

  const projects = await repService.getSectionProjects(telegramUserId, activeSectionId);
  const indProjects = projects.filter((p) => p.submission_type === 'individual');

  const sectionName = `${activeAssignment.section?.academic_year?.name || ''} — ${activeAssignment.section?.name || ''}`;

  if (indProjects.length === 0) {
    await ctx.reply(
      `👤 *Individual Assignments*\nScope: *${sectionName}*\n\nNo individual assignments open for this section.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `👤 *Individual Assignments Progress*\n` +
    `Scope: *${sectionName}*\n` +
    `───────────────────────────\n\n`;

  const kb = new InlineKeyboard();
  const b64Sec = uuidToBase64Url(activeSectionId);

  for (const [idx, p] of indProjects.entries()) {
    const report = await reportingService.getDetailedIndividualReport(telegramUserId, activeSectionId, p.id);
    const b64Proj = uuidToBase64Url(p.id);

    text +=
      `${idx + 1}. *${p.title}*\n` +
      `   • Course: ${p.course?.code || ''}\n` +
      `   • Progress: *${report.submittedCount}/${report.totalEligibleStudents}* (${report.completionPercentage}%)\n` +
      `   • Deadline: ${formatDateUTC(p.deadline)}\n\n`;

    kb.text(`📊 ${p.title.substring(0, 20)}`, `rr:${b64Sec}:${b64Proj}`).row();
  }

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ---------------------------------------------------------------------------
// 9. Group Assignments Summary
// ---------------------------------------------------------------------------

export async function handleRepGroupAssignments(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'group assignments');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId, reportingService, activeAssignment } = auth;

  const projects = await repService.getSectionProjects(telegramUserId, activeSectionId);
  const grpProjects = projects.filter((p) => p.submission_type === 'group');

  const sectionName = `${activeAssignment.section?.academic_year?.name || ''} — ${activeAssignment.section?.name || ''}`;

  if (grpProjects.length === 0) {
    await ctx.reply(
      `👥 *Group Assignments*\nScope: *${sectionName}*\n\nNo group projects open for this section.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `👥 *Group Project Progress*\n` +
    `Scope: *${sectionName}*\n` +
    `───────────────────────────\n\n`;

  const kb = new InlineKeyboard();
  const b64Sec = uuidToBase64Url(activeSectionId);

  for (const [idx, p] of grpProjects.entries()) {
    const report = await reportingService.getDetailedGroupReport(telegramUserId, activeSectionId, p.id);
    const b64Proj = uuidToBase64Url(p.id);

    text +=
      `${idx + 1}. *${p.title}*\n` +
      `   • Course: ${p.course?.code || ''}\n` +
      `   • Submitted Teams: *${report.submittedGroupsCount}/${report.totalGroups}* (${report.completionPercentage}%)\n` +
      `   • Deadline: ${formatDateUTC(p.deadline)}\n\n`;

    kb.text(`📊 ${p.title.substring(0, 20)}`, `rr:${b64Sec}:${b64Proj}`).row();
  }

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ---------------------------------------------------------------------------
// 10. Teacher Delivery (In-Telegram Workflow)
// ---------------------------------------------------------------------------

export async function handleRepTeacherDelivery(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'teacher delivery');
  if (!auth) return;
  const { repService, telegramUserId, activeSectionId } = auth;

  const projects = await repService.getSectionProjects(telegramUserId, activeSectionId);
  if (projects.length === 0) {
    await ctx.reply('No active projects available for teacher delivery in your assigned section.');
    return;
  }

  const kb = new InlineKeyboard();
  const b64Sec = uuidToBase64Url(activeSectionId);

  projects.forEach((p) => {
    const b64Proj = uuidToBase64Url(p.id);
    kb.text(`📦 ${p.title.substring(0, 28)}`, `ro_del:${b64Sec}:${b64Proj}`).row();
  });

  await ctx.reply(
    `📦 *Teacher Delivery Center*\n` +
      `Select an assignment to inspect submissions, assemble delivery batches, and dispatch files to the assigned course teacher:`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleRepTeacherDeliveryProject(
  ctx: BotContext,
  sectionId: string,
  projectId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  await repService.assertSectionScope(telegramUserId, sectionId);

  // 1. Fetch project and teacher
  const { data: project } = await supabase
    .from('projects')
    .select('*, course:courses(*), teacher:teachers(*)')
    .eq('id', projectId)
    .single();

  if (!project) {
    await ctx.reply('Project record not found.');
    return;
  }

  // 2. Fetch active submissions for this project & section
  const { data: subs } = await supabase
    .from('submissions')
    .select('id, version, submission_type')
    .eq('project_id', projectId)
    .eq('section_id', sectionId)
    .eq('status', 'active');

  const subCount = subs?.length || 0;

  // 3. Check existing delivery for this project & section
  const { data: existingDelivery } = await supabase
    .from('deliveries')
    .select('*')
    .eq('project_id', projectId)
    .eq('section_id', sectionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const teacherName = project.teacher?.full_name || 'Designated Course Teacher';
  const teacherEmail = project.teacher?.email || 'N/A';
  const statusLabel = existingDelivery
    ? existingDelivery.status.toUpperCase()
    : 'NOT PREPARED';

  let msg =
    `📦 *Teacher Delivery Package*\n` +
    `───────────────────────────\n` +
    `• *Project:* ${project.title}\n` +
    `• *Course:* ${project.course?.code || ''} — ${project.course?.title || ''}\n` +
    `• *Assigned Teacher:* *${teacherName}* (\`${teacherEmail}\`)\n` +
    `• *Active Submissions in Scope:* *${subCount}*\n` +
    `• *Delivery Status:* \`${statusLabel}\`\n`;

  if (existingDelivery) {
    msg +=
      `• *Batch Count:* ${existingDelivery.batch_count} files\n` +
      `• *Prepared At:* ${formatDateUTC(existingDelivery.prepared_at)}\n`;
    if (existingDelivery.sent_at) {
      msg += `• *Sent At:* ${formatDateUTC(existingDelivery.sent_at)}\n`;
    }
  }

  msg += `\n_Teacher destination is strictly derived from academic catalog \`projects.teacher_id\`._`;

  const b64Sec = uuidToBase64Url(sectionId);
  const b64Proj = uuidToBase64Url(projectId);
  const kb = new InlineKeyboard();

  if (!existingDelivery || existingDelivery.status === 'pending') {
    if (subCount > 0) {
      kb.text('📦 Prepare Delivery Batch', `ro_d_prep:${b64Sec}:${b64Proj}`).row();
    }
  } else if (existingDelivery.status === 'prepared') {
    const b64Del = uuidToBase64Url(existingDelivery.id);
    kb.text('🚀 Mark Dispatched to Teacher', `ro_d_sent:${b64Del}`).row();
    kb.text('📄 View Delivery Manifest', `ro_d_man:${b64Del}`).row();
  } else if (existingDelivery.status === 'sent') {
    const b64Del = uuidToBase64Url(existingDelivery.id);
    kb.text('✅ Record Teacher Acknowledgment', `ro_d_ack:${b64Del}`).row();
    kb.text('📄 View Delivery Manifest', `ro_d_man:${b64Del}`).row();
  } else if (existingDelivery.status === 'acknowledged') {
    const b64Del = uuidToBase64Url(existingDelivery.id);
    kb.text('📄 View Delivery Manifest', `ro_d_man:${b64Del}`).row();
  }

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

export async function handleRepPrepareDeliveryBatch(
  ctx: BotContext,
  sectionId: string,
  projectId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  await repService.assertSectionScope(telegramUserId, sectionId);

  const repData = await repService.getRepresentativeProfile(telegramUserId);
  if (!repData) return;

  // 1. Fetch project
  const { data: project } = await supabase
    .from('projects')
    .select('*, teacher:teachers(*)')
    .eq('id', projectId)
    .single();

  if (!project) {
    await ctx.reply('Project record not found.');
    return;
  }

  // 2. Fetch active submissions
  const { data: subs } = await supabase
    .from('submissions')
    .select('id')
    .eq('project_id', projectId)
    .eq('section_id', sectionId)
    .eq('status', 'active');

  if (!subs || subs.length === 0) {
    await ctx.reply('⚠️ No active submissions to assemble for this project.');
    return;
  }

  // 3. Atomically create delivery batch
  const { data: delivery, error: delErr } = await supabase
    .from('deliveries')
    .insert({
      project_id: projectId,
      section_id: sectionId,
      course_id: project.course_id,
      teacher_id: project.teacher_id,
      representative_id: repData.profile.id,
      batch_count: subs.length,
      status: 'prepared',
      channel: 'telegram',
      delivery_notes: `Assembled in Telegram Bot by Representative ${repData.profile.full_name}`,
      prepared_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (delErr || !delivery) {
    await ctx.reply(`❌ Failed to create delivery batch: ${delErr?.message || 'Database error'}`);
    return;
  }

  // 4. Insert delivery items
  const items = subs.map((s) => ({
    delivery_id: delivery.id,
    submission_id: s.id,
  }));
  await supabase.from('delivery_items').insert(items);

  // 5. Audit log
  await supabase.from('audit_logs').insert({
    actor_id: repData.profile.id,
    actor_telegram_id: telegramUserId,
    actor_role: 'section_representative',
    action: 'TEACHER_DELIVERY_PREPARED',
    entity_type: 'delivery',
    entity_id: delivery.id,
    metadata: { project_id: projectId, section_id: sectionId, batch_count: subs.length },
  });

  const b64Del = uuidToBase64Url(delivery.id);
  const kb = new InlineKeyboard()
    .text('🚀 Mark Dispatched to Teacher', `ro_d_sent:${b64Del}`)
    .row()
    .text('📄 View Delivery Manifest', `ro_d_man:${b64Del}`);

  await ctx.reply(
    `✅ *Delivery Batch Prepared!*\n\n` +
      `• *Batch ID:* \`${delivery.id.slice(0, 8)}\`\n` +
      `• *Files Packaged:* ${subs.length}\n` +
      `• *Designated Teacher:* *${project.teacher?.full_name}*\n` +
      `• *Status:* PREPARED\n\n` +
      `You may now dispatch the batch or view the signed file manifest:`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleRepDispatchDelivery(
  ctx: BotContext,
  deliveryId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  // Fetch delivery
  const { data: delivery } = await supabase
    .from('deliveries')
    .select('*, project:projects(title), teacher:teachers(full_name)')
    .eq('id', deliveryId)
    .single();

  if (!delivery) {
    await ctx.reply('Delivery record not found.');
    return;
  }

  await repService.assertSectionScope(telegramUserId, delivery.section_id);
  const repData = await repService.getRepresentativeProfile(telegramUserId);
  if (!repData) return;

  // Try calling atomic RPC if available
  const { error: rpcErr } = await supabase.rpc('mark_delivery_sent_with_audit', {
    p_delivery_id: deliveryId,
    p_actor_id: repData.profile.id,
    p_notes: 'Dispatched via Telegram Bot by Section Representative',
  });

  if (rpcErr) {
    // Fallback direct update
    await supabase
      .from('deliveries')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);

    await supabase.from('audit_logs').insert({
      actor_id: repData.profile.id,
      actor_telegram_id: telegramUserId,
      actor_role: 'section_representative',
      action: 'TEACHER_DELIVERY_DISPATCHED',
      entity_type: 'delivery',
      entity_id: deliveryId,
      metadata: { fallback: true },
    });
  }

  const b64Del = uuidToBase64Url(deliveryId);
  const kb = new InlineKeyboard()
    .text('📄 View Delivery Manifest', `ro_d_man:${b64Del}`)
    .row()
    .text('✅ Record Teacher Acknowledgment', `ro_d_ack:${b64Del}`);

  await ctx.reply(
    `🚀 *Delivery Package Dispatched!*\n\n` +
      `• *Project:* ${delivery.project?.title}\n` +
      `• *Teacher:* ${delivery.teacher?.full_name}\n` +
      `• *Status:* SENT (Recorded at ${formatDateUTC(new Date().toISOString())})\n\n` +
      `_Note: "Sent" status records transmission to the course teacher. Official teacher acknowledgment can be recorded once verified._`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleRepAcknowledgeDelivery(
  ctx: BotContext,
  deliveryId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  const { data: delivery } = await supabase
    .from('deliveries')
    .select('*, project:projects(title), teacher:teachers(full_name)')
    .eq('id', deliveryId)
    .single();

  if (!delivery) {
    await ctx.reply('Delivery record not found.');
    return;
  }

  await repService.assertSectionScope(telegramUserId, delivery.section_id);
  const repData = await repService.getRepresentativeProfile(telegramUserId);
  if (!repData) return;

  await supabase
    .from('deliveries')
    .update({
      status: 'acknowledged',
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', deliveryId);

  await supabase.from('audit_logs').insert({
    actor_id: repData.profile.id,
    actor_telegram_id: telegramUserId,
    actor_role: 'section_representative',
    action: 'TEACHER_DELIVERY_ACKNOWLEDGED',
    entity_type: 'delivery',
    entity_id: deliveryId,
  });

  await ctx.reply(
    `✅ *Teacher Acknowledgment Recorded!*\n\n` +
      `• *Project:* ${delivery.project?.title}\n` +
      `• *Teacher:* ${delivery.teacher?.full_name}\n` +
      `• *Status:* ACKNOWLEDGED\n\n` +
      `Academic delivery completed successfully.`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleRepViewDeliveryManifest(
  ctx: BotContext,
  deliveryId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  const { data: delivery } = await supabase
    .from('deliveries')
    .select(`
      *,
      project:projects(title, course:courses(code, title)),
      teacher:teachers(full_name, email),
      section:sections(name, academic_year:academic_years(name)),
      items:delivery_items(
        submission:submissions(
          id,
          version,
          submission_type,
          student:students(full_name, hu_student_id),
          group:groups(group_code),
          files:submission_files(original_filename, file_size_bytes, storage_path)
        )
      )
    `)
    .eq('id', deliveryId)
    .single();

  if (!delivery) {
    await ctx.reply('Delivery package not found.');
    return;
  }

  await repService.assertSectionScope(telegramUserId, delivery.section_id);

  let manifest =
    `📄 *Official Teacher Delivery Manifest*\n` +
    `Batch: \`${delivery.id.slice(0, 8)}\` | Status: *${delivery.status.toUpperCase()}*\n` +
    `───────────────────────────\n` +
    `• *Project:* ${delivery.project?.title}\n` +
    `• *Course:* ${delivery.project?.course?.code} — ${delivery.project?.course?.title}\n` +
    `• *Designated Teacher:* ${delivery.teacher?.full_name} (${delivery.teacher?.email})\n` +
    `• *Scope:* ${delivery.section?.academic_year?.name} — ${delivery.section?.name}\n` +
    `• *Total Submissions:* ${delivery.items?.length || 0}\n\n` +
    `*Packaged Submission Files:*\n`;

  (delivery.items || []).forEach((item: any, idx: number) => {
    const sub = item.submission;
    if (!sub) return;
    const isGrp = sub.submission_type === 'group';
    const name = isGrp
      ? `Team ${sub.group?.group_code}`
      : `${sub.student?.full_name} (\`${sub.student?.hu_student_id}\`)`;
    const file = Array.isArray(sub.files) ? sub.files[0] : sub.files;

    manifest +=
      `${idx + 1}. *${name}* (v${sub.version})\n` +
      `   📄 \`${file?.original_filename || 'File'}\` (${formatFileSize(file?.file_size_bytes || 0)})\n`;
  });

  await ctx.reply(manifest, { parse_mode: 'Markdown' });
}

// ---------------------------------------------------------------------------
// 11. Delivery History
// ---------------------------------------------------------------------------

export async function handleRepDeliveryHistory(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'delivery history');
  if (!auth) return;
  const { supabase, activeSectionId, activeAssignment } = auth;

  const sectionName = `${activeAssignment.section?.academic_year?.name || ''} — ${activeAssignment.section?.name || ''}`;

  const { data: deliveries, error } = await supabase
    .from('deliveries')
    .select(`
      id,
      batch_count,
      status,
      prepared_at,
      sent_at,
      acknowledged_at,
      project:projects(title),
      teacher:teachers(full_name)
    `)
    .eq('section_id', activeSectionId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  if (!deliveries || deliveries.length === 0) {
    await ctx.reply(
      `📜 *Delivery History*\nScope: *${sectionName}*\n\n` +
        `No teacher delivery packages prepared for this section yet.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `📜 *Teacher Delivery History* (Recent ${deliveries.length})\n` +
    `Scope: *${sectionName}*\n` +
    `───────────────────────────\n\n`;

  const kb = new InlineKeyboard();

  deliveries.forEach((d: any, idx: number) => {
    const statusIcon =
      d.status === 'acknowledged' ? '✅' : d.status === 'sent' ? '🚀' : '📦';
    const date = d.sent_at || d.prepared_at;

    text +=
      `${idx + 1}. *${d.project?.title || 'Project'}*\n` +
      `   • Teacher: ${d.teacher?.full_name || 'Teacher'}\n` +
      `   • Batch: ${d.batch_count} items | ${statusIcon} \`${d.status.toUpperCase()}\`\n` +
      `   • Date: ${formatDateUTC(date)}\n\n`;

    const b64Del = uuidToBase64Url(d.id);
    kb.text(`📄 Manifest: ${d.id.slice(0, 8)}`, `ro_d_man:${b64Del}`).row();
  });

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ---------------------------------------------------------------------------
// 12. Academic Reports
// ---------------------------------------------------------------------------

export async function handleRepAcademicReports(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'academic reports');
  if (!auth) return;
  const { reportingService, telegramUserId, activeSectionId } = auth;

  const report = await reportingService.getSectionSummaryReport(telegramUserId, activeSectionId);

  let text =
    `📊 *Academic Submission Telemetry*\n` +
    `Scope: *${report.academicYearName} — ${report.sectionName}*\n` +
    `Enrolled Students: *${report.totalStudentsEnrolled}* | Active Projects: *${report.totalActiveProjects}*\n` +
    `───────────────────────────\n\n`;

  if (report.projectsSummary.length === 0) {
    text += `No projects found for this section.`;
    await ctx.reply(text, { parse_mode: 'Markdown' });
    return;
  }

  const kb = new InlineKeyboard();
  const b64Sec = uuidToBase64Url(activeSectionId);

  report.projectsSummary.forEach((p, idx) => {
    const statusIcon = p.isPastDeadline ? '⛔ Past Deadline' : '🟢 Open';
    text +=
      `${idx + 1}. *${p.projectTitle}*\n` +
      `   • Progress: *${p.submittedCount}/${p.totalExpectedCount}* (${p.completionPercentage}%)\n` +
      `   • Status: ${statusIcon} | Due: ${formatDateUTC(p.deadline)}\n\n`;

    const b64Proj = uuidToBase64Url(p.projectId);
    kb.text(`📊 ${p.projectTitle.substring(0, 22)}`, `rr:${b64Sec}:${b64Proj}`).row();
  });

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ---------------------------------------------------------------------------
// 13. Switch Active Scope
// ---------------------------------------------------------------------------

export async function handleRepSwitchActiveScope(ctx: BotContext): Promise<void> {
  const auth = await resolveAuthorizedRepresentative(ctx, 'switch scope');
  if (!auth) return;
  const { repData, activeSectionId } = auth;

  if (repData.assignments.length <= 1) {
    const assign = repData.assignments[0];
    await ctx.reply(
      `ℹ️ *Single Scope Assigned*\n\n` +
        `You are designated representative for 1 section:\n` +
        `*${assign.section?.academic_year?.name || ''} — ${assign.section?.name || ''}*\n\n` +
        `All representative operations automatically partition to this scope.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const kb = new InlineKeyboard();
  repData.assignments.forEach((a) => {
    const sec = a.section;
    if (!sec) return;
    const isCurrent = a.section_id === activeSectionId;
    const label = `${isCurrent ? '✅ ' : ''}${sec.academic_year?.name || ''} — ${sec.name}`;
    const b64 = uuidToBase64Url(a.section_id);
    kb.text(label, `ro_sc:${b64}`).row();
  });

  await ctx.reply(
    `🔄 *Switch Active Academic Scope*\n\n` +
      `Select which academic section you want to operate on:`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleRepSwitchScopeCallback(
  ctx: BotContext,
  sectionId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  await repService.assertSectionScope(telegramUserId, sectionId);

  ctx.session.activeSectionId = sectionId;

  const repData = await repService.getRepresentativeProfile(telegramUserId);
  const assign = repData?.assignments.find((a) => a.section_id === sectionId);
  const secName = `${assign?.section?.academic_year?.name || ''} — ${assign?.section?.name || ''}`;

  await ctx.answerCallbackQuery({ text: `Switched scope to ${secName}` });
  await ctx.reply(
    `🔄 *Scope Switched Successfully*\n\n` +
      `Active Scope is now: *${secName}*\n` +
      `All operational menus now target this section.`,
    { parse_mode: 'Markdown' }
  );
  await handleRepDashboard(ctx);
}

// ---------------------------------------------------------------------------
// 14. Help and Support
// ---------------------------------------------------------------------------

export async function handleRepHelpSupport(ctx: BotContext): Promise<void> {
  const helpText =
    `❓ *Representative Operations Manual*\n` +
    `───────────────────────────\n` +
    `As an authorized Section Representative, you facilitate academic submission tracking and teacher delivery for your enrolled section.\n\n` +
    `*Key Workflows:*\n` +
    `• *📊 Operations Dashboard:* Real-time KPIs of your active section.\n` +
    `• *👥 My Students:* Paginated verified student roster with lock & Telegram status.\n` +
    `• *📂 My Projects:* Academic assignments targeted to your scope.\n` +
    `• *📥 Incoming Submissions:* Recent student and group assignment uploads.\n` +
    `• *✅ / ❌ Submitted vs Missing:* Drill-down reports per assignment.\n` +
    `• *📦 Teacher Delivery:* Assemble submissions into a batch and dispatch to the designated teacher.\n` +
    `• *📜 Delivery History:* Track status of prepared, sent, and acknowledged packages.\n` +
    `• *🔄 Switch Scope:* Switch between multiple assigned sections if designated.\n\n` +
    `*Rules & Boundaries:*\n` +
    `1. You represent ONLY your enrolled academic section.\n` +
    `2. Course teachers are derived strictly from official project records.\n` +
    `3. You retain full ordinary student privileges (submission, groups, profile).\n\n` +
    `For administrative escalations, contact the System Owner.`;

  await ctx.reply(helpText, { parse_mode: 'Markdown' });
}

// ---------------------------------------------------------------------------
// 15. Return to Student Menu
// ---------------------------------------------------------------------------

export async function handleRepReturnToStudentMenu(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  await ctx.reply(
    `🎓 *Returned to Student Main Menu*\n\n` +
      `You can now access your personal student functions:\n` +
      `• Submit personal or group assignments\n` +
      `• Browse assigned projects\n` +
      `• Manage project groups\n` +
      `• View your submission history\n\n` +
      `_Tap ⭐ Representative Operations anytime to return to staff console._`,
    {
      parse_mode: 'Markdown',
      reply_markup: getUnifiedMainMenuKeyboard(true),
    }
  );
}
