// HU-ASMS: Student Academic Project Browsing Handler (Phase 06)
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types/context.js';
import { getSupabaseAdminClient, DatabaseService, AcademicManagementService } from '@hu-asms/database';
import {
  formatDateUTC,
  formatFileSize,
  resolveEffectiveTelegramMaxFileSizeBytes,
} from '@hu-asms/shared';

export async function handleStudentMyProjects(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const db = new DatabaseService(supabase);

  // 1. Resolve registered student
  const student = await db.findStudentByTelegramId(telegramUserId);
  if (!student) {
    await ctx.reply('⚠️ Please register your official student identity first using /start.');
    return;
  }

  // 2. Fetch eligible projects targeted to their section and year
  const projects = await db.getEligibleProjects(student.academic_year_id, student.section_id);

  if (projects.length === 0) {
    await ctx.reply(
      `📋 *My Academic Projects*\n\n` +
        `There are currently no active projects or assignments open for *${student.academic_year?.name} — ${student.section?.name}*.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  let text =
    `📋 *Active Academic Projects*\n` +
    `Scope: *${student.academic_year?.name} — ${student.section?.name}*\n` +
    `───────────────────────────\n\n`;

  projects.forEach((proj, idx) => {
    const typeBadge = proj.submission_type === 'group' ? '👥 Group' : '👤 Individual';
    text += `${idx + 1}. *${proj.title}*\n` +
            `   • Course: ${proj.course?.title || 'Course'}\n` +
            `   • Delivery Recipient: ${proj.teacher?.full_name || 'Assigned Teacher'}\n` +
            `   • Type: ${typeBadge}\n` +
            `   • Deadline: ${formatDateUTC(proj.deadline)}\n\n`;

    keyboard.text(`📖 Details: ${proj.title.substring(0, 20)}...`, `view_proj_${proj.id}`).row();
  });

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

export async function handleProjectDetailsCallback(
  ctx: BotContext,
  projectId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const academicService = new AcademicManagementService(supabase);

  const proj = await academicService.getProjectDetails(projectId);
  if (!proj) {
    await ctx.reply('Project not found or no longer active.');
    return;
  }

  const allowedFormats = proj.file_rules?.allowed_extensions?.map((e) => `.${e}`).join(', ') || '.pdf';
  const maxMb = formatFileSize(
    resolveEffectiveTelegramMaxFileSizeBytes(proj.file_rules?.max_file_size_bytes)
  );
  const typeBadge = proj.submission_type === 'group' ? '👥 Group Project' : '👤 Individual Assignment';

  let detailMsg =
    `📖 *Project Details*\n` +
    `───────────────────────────\n` +
    `• *Title:* ${proj.title}\n` +
    `• *Course:* ${proj.course?.code} — ${proj.course?.title}\n` +
    `• *Assigned Teacher:* ${proj.teacher?.full_name}\n` +
    `• *Submission Type:* ${typeBadge}\n` +
    `• *Deadline:* ${formatDateUTC(proj.deadline)}\n` +
    `• *Resubmissions Allowed:* ${proj.resubmission_allowed ? '✅ Yes' : '❌ No'}\n` +
    `• *Accepted Formats:* \`${allowedFormats}\`\n` +
    `• *Max File Size:* ${maxMb}\n`;

  if (proj.submission_type === 'group' && proj.file_rules) {
    detailMsg += `• *Team Size Bounds:* ${proj.file_rules.min_group_size} – ${proj.file_rules.max_group_size} members\n`;
  }

  if (proj.description) {
    detailMsg += `\n*Instructions:*\n_${proj.description}_\n`;
  }

  detailMsg += `───────────────────────────`;

  await ctx.reply(detailMsg, { parse_mode: 'Markdown' });
}
