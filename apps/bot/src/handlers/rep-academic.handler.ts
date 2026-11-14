// HU-ASMS: Representative Academic Operations Bot Handlers (Phase B / Core Workflow)
// Provides: My Courses, Collect Submissions, View Students, View Sections.
// Create Course and Create Assignment are handled via conversations (rep-course.conversation.ts
// and rep-project.conversation.ts) registered in bot.ts.
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types/context.js';
import { RepresentativeService } from '../services/representative.service.js';
import {
  CourseOfferingService,
  type CourseOfferingWithDetails,
} from '@hu-asms/database';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { formatDateUTC } from '@hu-asms/shared';
import { requirePrivateChat } from '../utils/chat-guard.js';
import { encodeReportCallback } from '../utils/callback-codec.js';
import { RepresentativeReportingService } from '../services/representative-reporting.service.js';
import {
  renderProjectReport,
  displaySectionRoster,
  handleAssignedSections,
} from './representative.handler.js';

// Re-export these so bot.ts doesn't need two handler imports
export { handleAssignedSections, displaySectionRoster, renderProjectReport };

// ---------------------------------------------------------------------------
// Authorization helper
// ---------------------------------------------------------------------------

async function requirePrivateAuthorizedRep(ctx: BotContext, label: string) {
  if (!(await requirePrivateChat(ctx, label))) return null;
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

// ---------------------------------------------------------------------------
// 1. My Courses — lists course offerings for the rep's section(s)
// ---------------------------------------------------------------------------

export async function handleRepMyCourses(ctx: BotContext): Promise<void> {
  const auth = await requirePrivateAuthorizedRep(ctx, 'course listings');
  if (!auth) return;
  const { repData, telegramUserId, supabase } = auth;

  const cso = new CourseOfferingService(supabase);
  const allOfferings: CourseOfferingWithDetails[] = [];

  for (const assign of repData.assignments) {
    const offerings = await cso.getOfferingsForSection(assign.section_id);
    allOfferings.push(...offerings);
  }

  if (allOfferings.length === 0) {
    await ctx.reply(
      `📚 *My Courses*\n\nNo courses have been created for your section(s) yet.\n\nUse *➕ Create Course* to add a course offering.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text = `📚 *My Course Offerings*\n───────────────────────────\n\n`;
  const keyboard = new InlineKeyboard();

  allOfferings.forEach((off, idx) => {
    const secLabel = `${off.academic_year?.name || ''} — ${off.section?.name || ''}`;
    text +=
      `${idx + 1}. *${off.course?.title || 'Course'}* \`${off.course?.code || ''}\`\n` +
      `   • Section: ${secLabel}\n` +
      `   • Teacher: ${off.teacher?.full_name || 'TBA'}\n\n`;
    keyboard
      .text(`📂 ${off.course?.code}: Assignments`, `cso_proj_${off.id}_${off.section_id}`)
      .row();
  });

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ---------------------------------------------------------------------------
// 2. Collect Submissions — select section → course → assignment → report
// ---------------------------------------------------------------------------

export async function handleRepCollectSubmissions(ctx: BotContext): Promise<void> {
  const auth = await requirePrivateAuthorizedRep(ctx, 'submission collection');
  if (!auth) return;
  const { repData, supabase, telegramUserId } = auth;

  // Build a keyboard of all projects the rep can see, grouped across all their sections
  const repService = new RepresentativeService(supabase);
  const keyboard = new InlineKeyboard();
  let projectCount = 0;

  for (const assign of repData.assignments) {
    if (!assign.section) continue;
    const projects = await repService.getSectionProjects(telegramUserId, assign.section_id);
    for (const proj of projects) {
      projectCount++;
      const label =
        `${proj.course?.code || '?'}: ${proj.title.substring(0, 22)}` +
        (assign.section?.name ? ` (${assign.section.name})` : '');
      keyboard
        .text(label.substring(0, 60), encodeReportCallback(assign.section_id, proj.id))
        .row();
    }
  }

  if (projectCount === 0) {
    await ctx.reply(
      `📥 *Collect Submissions*\n\nNo active assignments are available for your section(s) yet.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await ctx.reply(
    `📥 *Collect Submissions*\n` +
      `Select an assignment to view submitted and missing students:\n\n` +
      `_${projectCount} assignment(s) across your assigned section(s)_`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ---------------------------------------------------------------------------
// 3. Callback: projects for a specific course offering
// ---------------------------------------------------------------------------

export async function handleCourseOfferingProjects(
  ctx: BotContext,
  offeringId: string,
  sectionId: string
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  // Re-verify section scope
  try {
    await repService.assertSectionScope(telegramUserId, sectionId);
  } catch {
    await ctx.answerCallbackQuery({ text: '⛔ Access denied for this section.', show_alert: true });
    return;
  }

  const cso = new CourseOfferingService(supabase);
  let projects: any[] = [];
  try {
    projects = await cso.getProjectsForOffering(offeringId, sectionId);
  } catch {
    await ctx.answerCallbackQuery({ text: '⛔ Course offering not found.', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  if (projects.length === 0) {
    await ctx.reply(
      `📂 *Assignments for this Course*\n\nNo assignments have been created yet.\nUse *📝 Create Assignment* to add one.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  let text = `📂 *Course Assignments*\n───────────────────────────\n\n`;

  projects.forEach((proj: any, idx: number) => {
    const typeBadge = proj.submission_type === 'group' ? '👥 Group' : '👤 Individual';
    text +=
      `${idx + 1}. *${proj.title}*\n` +
      `   • Type: ${typeBadge} | Deadline: ${formatDateUTC(proj.deadline)}\n\n`;
    keyboard
      .text(`📊 Report: ${proj.title.substring(0, 30)}`, encodeReportCallback(sectionId, proj.id))
      .row();
  });

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ---------------------------------------------------------------------------
// 4. My Sections (renamed from handleAssignedSections for new keyboard label)
// ---------------------------------------------------------------------------

export async function handleRepMySections(ctx: BotContext): Promise<void> {
  return handleAssignedSections(ctx);
}

// ---------------------------------------------------------------------------
// 5. View All Students (wrapper kept for backward compat with new keyboard)
// ---------------------------------------------------------------------------

export async function handleRepViewAllStudents(ctx: BotContext): Promise<void> {
  const auth = await requirePrivateAuthorizedRep(ctx, 'section student rosters');
  if (!auth) return;
  const { repData, repService, telegramUserId } = auth;

  if (repData.assignments.length === 1) {
    const sec = repData.assignments[0].section;
    if (sec) {
      await displaySectionRoster(
        ctx,
        repService,
        telegramUserId,
        sec.id,
        `${sec.academic_year?.name || ''} — ${sec.name}`
      );
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  repData.assignments.forEach((assign) => {
    if (assign.section) {
      keyboard
        .text(
          `${assign.section.academic_year?.name || ''} — ${assign.section.name}`,
          `rep_roster_${assign.section_id}`
        )
        .row();
    }
  });

  await ctx.reply('Select a section to view its student roster:', { reply_markup: keyboard });
}
