// HU-ASMS: /start Command Handler (Phase 04)
import type { BotContext } from '../types/context.js';
import { getSupabaseAdminClient, DatabaseService } from '@hu-asms/database';
import {
  getStudentMainMenuKeyboard,
  getRepresentativeMainMenuKeyboard,
  getUnifiedMainMenuKeyboard,
} from '../keyboards/main-menu.js';
import { requirePrivateChat } from '../utils/chat-guard.js';

export async function handleStartCommand(ctx: BotContext): Promise<void> {
  const updateId = ctx.update?.update_id;
  console.log('[start] handler entered', { updateId, chatType: ctx.chat?.type });

  if (!(await requirePrivateChat(ctx, 'registration and account access'))) {
    console.log('[start] rejected — not private chat', { updateId });
    return;
  }

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Could not identify your Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const db = new DatabaseService(supabase);

  // 1. Resolve student identity
  let student: Awaited<ReturnType<typeof db.findStudentByTelegramId>>;
  try {
    student = await db.findStudentByTelegramId(telegramUserId);
    console.log('[start] student lookup done', { updateId, found: !!student, status: student?.registration_status });
  } catch (err: any) {
    console.error('[start] student lookup failed', { updateId, error: err?.message });
    await ctx.reply('⚠️ Could not reach the university database. Please try again in a moment.');
    return;
  }

  // 2. Resolve representative assignments
  let repData: Awaited<ReturnType<typeof db.findRepresentativeByTelegramId>>;
  try {
    repData = await db.findRepresentativeByTelegramId(telegramUserId);
    console.log('[start] rep lookup done', { updateId, isRep: !!(repData?.assignments?.length) });
  } catch (err: any) {
    console.error('[start] rep lookup failed', { updateId, error: err?.message });
    repData = null;
  }
  const isRep = !!(repData && repData.assignments && repData.assignments.length > 0);

  // Unified Student / Representative Experience
  if (student) {
    if (student.registration_status === 'suspended') {
      console.log('[start] sending suspended message', { updateId });
      await ctx.reply(
        `🚫 *Account Suspended*\n\n` +
          `Your student record (\`${student.hu_student_id}\`) is currently suspended.\n` +
          `Please contact the System Owner / Academic Administrator for assistance.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Retrieve assigned representative for their section
    const reps = await db.getSectionRepresentatives(student.section_id);
    const repNames = reps.map((r) => r.profile?.full_name).join(', ') || 'Not assigned yet';

    let repScopeText = '';
    if (isRep && repData) {
      const assignedSections = repData.assignments
        .map((a) => `• ${a.section?.academic_year?.name} — ${a.section?.name}`)
        .join('\n');
      repScopeText = `\n🎖️ *Designated Representative Scope:*\n${assignedSections}\n`;
    }

    console.log('[start] sending registered-student welcome', { updateId });
    try {
      await ctx.reply(
        `👋 *Welcome back, ${student.full_name}!*\n\n` +
          `🎓 *HU Student ID:* \`${student.hu_student_id}\`\n` +
          `🏢 *Department:* ${student.department?.name}\n` +
          `📚 *Academic Scope:* ${student.academic_year?.name} — ${student.section?.name}\n` +
          `🎖️ *Section Representative:* ${repNames}\n` +
          `🔒 *Status:* ${student.registration_status.toUpperCase()} (Identity Locked)\n` +
          repScopeText +
          `\nSelect an action below:` +
          (isRep ? `\n_⭐ Representative operations are enabled in your menu._` : ''),
        {
          parse_mode: 'Markdown',
          reply_markup: getUnifiedMainMenuKeyboard(isRep),
        }
      );
      console.log('[start] registered-student reply sent OK', { updateId });
    } catch (replyErr: any) {
      console.error('[start] ctx.reply failed for registered student', {
        updateId,
        errorCode: replyErr?.error_code ?? replyErr?.code,
        description: replyErr?.description ?? replyErr?.message,
      });
    }
    return;
  }

  // Fallback for non-student representative profiles
  if (isRep && repData) {
    const assignedSections = repData.assignments
      .map((a) => `• ${a.section?.academic_year?.name} — ${a.section?.name}`)
      .join('\n');

    console.log('[start] sending rep-only welcome', { updateId });
    try {
      await ctx.reply(
        `🎖️ *Welcome Representative ${repData.profile.full_name}!*\n\n` +
          `*Assigned Academic Scope:*\n${assignedSections || 'None assigned yet'}\n\n` +
          `Use the quick actions below to monitor submissions and view student rosters:`,
        {
          parse_mode: 'Markdown',
          reply_markup: getRepresentativeMainMenuKeyboard(),
        }
      );
      console.log('[start] rep-only reply sent OK', { updateId });
    } catch (replyErr: any) {
      console.error('[start] ctx.reply failed for rep-only', {
        updateId,
        errorCode: replyErr?.error_code ?? replyErr?.code,
        description: replyErr?.description ?? replyErr?.message,
      });
    }
    return;
  }

  // 3. Not linked -> Enter interactive registration conversation
  console.log('[start] entering registrationConversation', { updateId });
  await ctx.conversation.enter('registrationConversation');
  console.log('[start] registrationConversation entered', { updateId });
}
