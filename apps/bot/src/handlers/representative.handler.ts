// HU-ASMS: Representative Bot Interactive Handlers (Phase 05)
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types/context.js';
import { RepresentativeService } from '../services/representative.service.js';
import { RepresentativeReportingService } from '../services/representative-reporting.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { formatFileSize, formatDateUTC } from '@hu-asms/shared';

export async function handleAssignedSections(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  const repData = await repService.getRepresentativeProfile(telegramUserId);

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return;
  }

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
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  const repData = await repService.getRepresentativeProfile(telegramUserId);

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return;
  }

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
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  const repData = await repService.getRepresentativeProfile(telegramUserId);

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return;
  }

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
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);
  const repData = await repService.getRepresentativeProfile(telegramUserId);

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return;
  }

  const keyboard = new InlineKeyboard();
  let hasProjects = false;

  for (const assign of repData.assignments) {
    const projects = await repService.getSectionProjects(telegramUserId, assign.section_id);
    for (const proj of projects) {
      hasProjects = true;
      const secName = assign.section?.name || 'Section';
      keyboard.text(
        `${proj.title.substring(0, 30)}... (${secName})`,
        `rep_report_${assign.section_id}_${proj.id}`
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
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const reportingService = new RepresentativeReportingService(supabase);

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
