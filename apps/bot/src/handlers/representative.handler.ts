// HU-ASMS: Representative Bot Interactive Handlers (Phase 05)
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types/context.js';
import { RepresentativeService } from '../services/representative.service.js';
import { RepresentativeReportingService } from '../services/representative-reporting.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { formatFileSize, formatDateUTC } from '@hu-asms/shared';
import { isPrivateTelegramChat, requirePrivateChat } from '../utils/chat-guard.js';
import { encodeReportCallback } from '../utils/callback-codec.js';

async function requirePrivateAuthorizedRep(
  ctx: BotContext,
  workflowLabel: string
) {
  if (!(await requirePrivateChat(ctx, workflowLabel))) {
    return null;
  }

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return null;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  const repData = await repService.getRepresentativeProfile(telegramUserId);

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return null;
  }

  return { supabase, repService, repData, telegramUserId };
}

export async function handleAssignedSections(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'assigned academic sections');
  if (!authorized) return;
  const { repService, repData, telegramUserId } = authorized;

  let text = `🏢 *Your Assigned Academic Sections*\n───────────────────────────\n`;
  for (const assign of repData.assignments) {
    const sec = assign.section;
    if (!sec) continue;
    const students = await repService.getSectionStudents(telegramUserId, sec.id);
    const projects = await repService.getSectionProjects(telegramUserId, sec.id);

    text += `• *${sec.academic_year?.name || 'Academic Year'} — ${sec.name}*\n` +
            `  👥 Enrolled Students: *${students.length}*\n` +
            `  📂 Active Projects: *${projects.length}*\n\n`;
  }
  text += `_Your permissions are strictly restricted to these sections._`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

export async function handleViewStudents(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'section student rosters');
  if (!authorized) return;
  const { repService, repData, telegramUserId } = authorized;

  // If representative has exactly 1 section, show it directly
  if (repData.assignments.length === 1) {
    const sec = repData.assignments[0].section;
    if (sec) {
      await displaySectionRoster(ctx, repService, telegramUserId, sec.id, `${sec.academic_year?.name || ''} — ${sec.name}`);
      return;
    }
  }

  // Otherwise present inline selection
  const keyboard = new InlineKeyboard();
  repData.assignments.forEach((assign) => {
    if (assign.section) {
      keyboard.text(
        `${assign.section.academic_year?.name || ''} — ${assign.section.name}`,
        `rep_roster_${assign.section_id}`
      ).row();
    }
  });

  await ctx.reply('Select an academic section to view registered students:', {
    reply_markup: keyboard,
  });
}

export async function displaySectionRoster(
  ctx: BotContext,
  repService: RepresentativeService,
  telegramUserId: number,
  sectionId: string,
  scopeName: string
): Promise<void> {
  if (!isPrivateTelegramChat(ctx)) {
    await requirePrivateChat(ctx, 'section student rosters');
    return;
  }

  const students = await repService.getSectionStudents(telegramUserId, sectionId);

  if (students.length === 0) {
    await ctx.reply(`📋 *Section Roster: ${scopeName}*\n\nNo students registered in this section yet.`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  let msg = `📋 *Section Roster: ${scopeName}* (${students.length} Students)\n───────────────────────────\n`;
  students.forEach((s, idx) => {
    const lockIcon = s.is_locked ? '🔒' : '⏳';
    msg += `${idx + 1}. *${s.full_name}*\n` +
           `   HU ID: \`${s.hu_student_id}\` | ${lockIcon} ${s.registration_status}\n`;
  });

  await ctx.reply(msg, { parse_mode: 'Markdown' });
}

export async function handleViewProjects(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'section projects');
  if (!authorized) return;
  const { repService, repData, telegramUserId } = authorized;

  let text = `📂 *Academic Projects in Your Scope*\n───────────────────────────\n`;
  let projectCount = 0;

  for (const assign of repData.assignments) {
    const projects = await repService.getSectionProjects(telegramUserId, assign.section_id);
    for (const proj of projects) {
      projectCount++;
      const typeBadge = proj.submission_type === 'group' ? '👥 Group' : '👤 Individual';
      text += `*${proj.title}*\n` +
              `• Course: ${proj.course?.title || 'N/A'}\n` +
              `• Teacher: ${proj.teacher?.full_name || 'N/A'}\n` +
              `• Type: ${typeBadge} | Deadline: ${formatDateUTC(proj.deadline)}\n\n`;
    }
  }

  if (projectCount === 0) {
    text += `No active projects currently targeted at your assigned sections.`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

export async function handleSubmissionReports(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'submission reports');
  if (!authorized) return;
  const { repService, repData, telegramUserId } = authorized;

  const keyboard = new InlineKeyboard();
  let hasProjects = false;

  for (const assign of repData.assignments) {
    const projects = await repService.getSectionProjects(telegramUserId, assign.section_id);
    for (const proj of projects) {
      hasProjects = true;
      const secName = assign.section?.name || 'Section';
      keyboard.text(
        `${proj.title.substring(0, 30)}... (${secName})`,
        encodeReportCallback(assign.section_id, proj.id)
      ).row();
    }
  }

  if (!hasProjects) {
    await ctx.reply('No active projects available for reports in your assigned sections.');
    return;
  }

  await ctx.reply('📊 *Submission Reports*\nSelect a project to view submitted and missing work:', {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

export async function renderProjectReport(
  ctx: BotContext,
  sectionId: string,
  projectId: string
): Promise<void> {
  if (!isPrivateTelegramChat(ctx)) {
    await requirePrivateChat(ctx, 'submission reports');
    return;
  }

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const reportingService = new RepresentativeReportingService(supabase);

  // Re-verify authorization on every callback invocation:
  try {
    await reportingService.assertSectionScope(telegramUserId, sectionId);
  } catch (scopeErr) {
    await ctx.reply('⛔ *Unauthorized Scope*\n\nYou are not authorized as an active representative for this academic section.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // 1. Fetch project to check submission type
  const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single();
  if (!project) {
    await ctx.reply('Project not found.');
    return;
  }

  if (project.submission_type === 'individual') {
    const report = await reportingService.getDetailedIndividualReport(telegramUserId, sectionId, projectId);
    
    let text = `📊 *Individual Submission Report*\n` +
               `*Project:* ${report.project.title}\n` +
               `*Scope:* ${report.section.academicYearName} — ${report.section.name}\n` +
               `*Progress:* ${report.submittedCount}/${report.totalEligibleStudents} (${report.completionPercentage}%)\n` +
               `*Status:* ${report.isPastDeadline ? '⛔ Past Deadline' : '🟢 Open'}\n` +
               `───────────────────────────\n\n`;

    if (report.submittedStudents.length > 0) {
      text += `✅ *SUBMITTED STUDENTS (${report.submittedCount}):*\n`;
      report.submittedStudents.forEach((item, idx) => {
        const vTag = item.isResubmission ? ` (v${item.version})` : '';
        text += `${idx + 1}. *${item.student.full_name}* (\`${item.student.hu_student_id}\`)${vTag}\n` +
                `   File: \`${item.fileName}\` (${formatFileSize(item.fileSizeBytes)})\n` +
                `   Date: ${formatDateUTC(item.submittedAt)}\n`;
      });
      text += `\n`;
    }

    if (report.missingStudents.length > 0) {
      text += `❌ *MISSING STUDENTS (${report.missingCount}):*\n`;
      report.missingStudents.forEach((item, idx) => {
        const tgIcon = item.isTelegramLinked ? '📱' : '⚠️ No Telegram';
        text += `${idx + 1}. *${item.fullName}* (\`${item.huStudentId}\`) | ${item.registrationStatus} [${tgIcon}]\n`;
      });
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  } else {
    // Group Report
    const report = await reportingService.getDetailedGroupReport(telegramUserId, sectionId, projectId);

    let text = `📊 *Group Submission Report*\n` +
               `*Project:* ${report.project.title}\n` +
               `*Scope:* ${report.section.academicYearName} — ${report.section.name}\n` +
               `*Progress:* ${report.submittedGroupsCount}/${report.totalGroups} Teams (${report.completionPercentage}%)\n` +
               `*Status:* ${report.isPastDeadline ? '⛔ Past Deadline' : '🟢 Open'}\n` +
               `───────────────────────────\n\n`;

    if (report.submittedGroups.length > 0) {
      text += `✅ *SUBMITTED TEAMS (${report.submittedGroupsCount}):*\n`;
      report.submittedGroups.forEach((item, idx) => {
        const vTag = item.version > 1 ? ` (v${item.version})` : '';
        const membersList = item.creditedMembers.map((m) => m.studentName).join(', ');
        text += `${idx + 1}. *${item.group.group_code}*${vTag} (Leader: ${item.submittedByStudentName})\n` +
                `   Credited: _${membersList || 'None' }_\n` +
                `   File: \`${item.fileName}\` (${formatFileSize(item.fileSizeBytes)})\n` +
                `   Date: ${formatDateUTC(item.submittedAt)}\n`;
      });
      text += `\n`;
    }

    if (report.missingGroups.length > 0) {
      text += `❌ *MISSING TEAMS (${report.missingGroupsCount}):*\n`;
      report.missingGroups.forEach((item, idx) => {
        let memberStatus = `${item.confirmedMembersCount} confirmed`;
        if (item.pendingMembersCount > 0) {
          memberStatus += `, ${item.pendingMembersCount} pending (${item.pendingMemberNames.join(', ')})`;
        }
        if (item.declinedMembersCount > 0) {
          memberStatus += `, ${item.declinedMembersCount} declined`;
        }
        text += `${idx + 1}. *${item.groupCode}* (Leader: ${item.groupLeaderName})\n` +
                `   Status: \`${item.groupStatus.toUpperCase()}\` | Members: ${memberStatus}\n`;
      });
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }
}

export async function handleRepViewGroups(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'section group rosters');
  if (!authorized) return;
  const { supabase, repData } = authorized;

  const assignedSectionIds = repData.assignments.map((a) => a.section_id);
  const { data: groups, error } = await supabase
    .from('groups')
    .select(`
      id,
      group_code,
      status,
      project:projects(title),
      section:sections(name, academic_year:academic_years(name)),
      leader:students!groups_group_leader_id_fkey(full_name, hu_student_id),
      members:group_members(confirmation_status)
    `)
    .in('section_id', assignedSectionIds)
    .order('group_code', { ascending: true })
    .limit(20);

  if (error) throw error;

  if (!groups || groups.length === 0) {
    await ctx.reply(
      `👥 *Section Groups*\n\nNo project groups have been created yet for your assigned section(s).`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `👥 *Project Groups in Your Scope* (${groups.length})\n` +
    `───────────────────────────\n\n`;

  groups.forEach((grp: any, idx: number) => {
    const members = Array.isArray(grp.members) ? grp.members : [];
    const confirmedCount = members.filter((m: any) => m.confirmation_status === 'confirmed').length;
    const declinedCount = members.filter((m: any) => m.confirmation_status === 'declined').length;
    const secLabel = `${grp.section?.academic_year?.name || ''} — ${grp.section?.name || 'Section'}`;
    const leaderLabel = grp.leader
      ? `${grp.leader.full_name} (\`${grp.leader.hu_student_id}\`)`
      : 'Unassigned';

    text +=
      `${idx + 1}. *${grp.group_code}* — ${grp.project?.title || 'Project'}\n` +
      `   • Scope: ${secLabel}\n` +
      `   • Status: \`${String(grp.status || 'pending').toUpperCase()}\` | Confirmed: ${confirmedCount}/${members.length}` +
      (declinedCount > 0 ? ` (${declinedCount} declined)` : '') +
      `\n   • Leader: ${leaderLabel}\n\n`;
  });

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

export async function handleRepForwardToTeacher(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'teacher delivery forwarding');
  if (!authorized) return;
  const { supabase, repService, repData, telegramUserId } = authorized;

  const assignedSectionIds = repData.assignments.map((a) => a.section_id);
  let activeProjectsCount = 0;
  for (const assign of repData.assignments) {
    const projects = await repService.getSectionProjects(telegramUserId, assign.section_id);
    activeProjectsCount += projects.length;
  }

  const { count: activeSubmissionsCount, error } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .in('section_id', assignedSectionIds)
    .eq('status', 'active');

  if (error) throw error;

  const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const portalHint =
    baseUrl && !/your-domain\.vercel\.app/i.test(baseUrl)
      ? `${baseUrl}/rep/deliveries/new`
      : 'Representative Web Portal → `/rep/deliveries/new`';

  await ctx.reply(
    `📦 *Forward Submissions to Teacher*\n` +
      `───────────────────────────\n` +
      `• *Assigned Sections:* ${assignedSectionIds.length}\n` +
      `• *Active Projects:* ${activeProjectsCount}\n` +
      `• *Active Submissions in Scope:* ${activeSubmissionsCount || 0}\n\n` +
      `Manual teacher delivery batches, signed Vault download manifests, and teacher dispatch confirmation are managed in the authenticated web portal:\n` +
      `👉 Open: ${portalHint}`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleRepDeliveryHistory(ctx: BotContext): Promise<void> {
  const authorized = await requirePrivateAuthorizedRep(ctx, 'delivery history');
  if (!authorized) return;
  const { supabase, repData } = authorized;

  const assignedSectionIds = repData.assignments.map((a) => a.section_id);
  const { data: deliveries, error } = await supabase
    .from('deliveries')
    .select(`
      id,
      batch_count,
      status,
      channel,
      prepared_at,
      sent_at,
      acknowledged_at,
      created_at,
      project:projects(title),
      course:courses(code, title),
      teacher:teachers(full_name),
      section:sections(name, academic_year:academic_years(name))
    `)
    .in('section_id', assignedSectionIds)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) throw error;

  if (!deliveries || deliveries.length === 0) {
    await ctx.reply(
      `📜 *Delivery History*\n\nNo teacher delivery batches have been prepared for your assigned sections yet.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text =
    `📜 *Recent Teacher Deliveries* (${deliveries.length})\n` +
    `───────────────────────────\n\n`;

  deliveries.forEach((d: any, idx: number) => {
    const secLabel = `${d.section?.academic_year?.name || ''} — ${d.section?.name || 'Section'}`;
    text +=
      `${idx + 1}. *${d.project?.title || 'Project'}* (${d.course?.code || 'Course'})\n` +
      `   • Recipient: ${d.teacher?.full_name || 'Assigned Teacher'}\n` +
      `   • Scope: ${secLabel} | Batch: ${d.batch_count} item(s)\n` +
      `   • Channel: \`${d.channel}\` | Status: \`${String(d.status || 'pending').toUpperCase()}\`\n` +
      `   • Updated: ${formatDateUTC(d.acknowledged_at || d.sent_at || d.prepared_at || d.created_at)}\n\n`;
  });

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
