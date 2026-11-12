// HU-ASMS: /start Command Handler (Phase 04)
import type { BotContext } from '../types/context.js';
import { getSupabaseAdminClient, DatabaseService } from '@hu-asms/database';
import {
  getStudentMainMenuKeyboard,
  getRepresentativeMainMenuKeyboard,
} from '../keyboards/main-menu.js';
import { requirePrivateChat } from '../utils/chat-guard.js';

export async function handleStartCommand(ctx: BotContext): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'registration and account access'))) {
    return;
  }

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Could not identify your Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const db = new DatabaseService(supabase);

  // 1. Check if user is a Section Representative
  const repData = await db.findRepresentativeByTelegramId(telegramUserId);
  if (repData) {
    const assignedSections = repData.assignments
      .map((a) => `• ${a.section?.academic_year?.name} — ${a.section?.name}`)
      .join('\n');

    await ctx.reply(
      `🎖️ *Welcome Representative ${repData.profile.full_name}!*\n\n` +
        `*Assigned Academic Scope:*\n${assignedSections || 'None assigned yet'}\n\n` +
        `Use the quick actions below to monitor submissions and view student rosters:`,
      {
        parse_mode: 'Markdown',
        reply_markup: getRepresentativeMainMenuKeyboard(),
      }
    );
    return;
  }

  // 2. Check if Telegram account is already linked to an approved/suspended student record
  const student = await db.findStudentByTelegramId(telegramUserId);
  if (student) {
    if (student.registration_status === 'suspended') {
      await ctx.reply(
        `🚫 *Account Suspended*\n\n` +
          `Your student record (\`${student.hu_student_id}\`) is currently suspended.\n` +
          `Please contact the System Owner / Academic Administrator for assistance.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Also retrieve assigned representative for their section
    const reps = await db.getSectionRepresentatives(student.section_id);
    const repNames = reps.map((r) => r.profile?.full_name).join(', ') || 'Not assigned yet';

    await ctx.reply(
      `👋 *Welcome back, ${student.full_name}!*\n\n` +
        `🎓 *HU Student ID:* \`${student.hu_student_id}\`\n` +
        `🏢 *Department:* ${student.department?.name}\n` +
        `📚 *Academic Scope:* ${student.academic_year?.name} — ${student.section?.name}\n` +
        `🎖️ *Section Representative:* ${repNames}\n` +
        `🔒 *Status:* ${student.registration_status.toUpperCase()} (Identity Locked)\n\n` +
        `Select an action below:`,
      {
        parse_mode: 'Markdown',
        reply_markup: getStudentMainMenuKeyboard(),
      }
    );
    return;
  }

  // 3. Not linked -> Enter interactive registration conversation
  await ctx.conversation.enter('registrationConversation');
}
