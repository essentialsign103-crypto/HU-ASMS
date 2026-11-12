// HU-ASMS: Student Academic Profile Command (Phase 04)
import type { BotContext } from '../types/context.js';
import { getSupabaseAdminClient, DatabaseService } from '@hu-asms/database';
import { requirePrivateChat } from '../utils/chat-guard.js';

export async function handleProfileCommand(ctx: BotContext): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'student profile lookup'))) {
    return;
  }

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Could not identify your Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const db = new DatabaseService(supabase);

  const student = await db.findStudentByTelegramId(telegramUserId);
  if (!student) {
    await ctx.reply('⚠️ No registered student profile found. Send /start to register.');
    return;
  }

  // Retrieve assigned representative for the section
  const reps = await db.getSectionRepresentatives(student.section_id);
  const repList = reps.map((r) => `${r.profile?.full_name} (${r.profile?.phone || 'No phone'})`).join(', ') || 'None assigned';

  await ctx.reply(
    `👤 *Student Academic Profile*\n` +
      `───────────────────────────\n` +
      `• *Full Name:* ${student.full_name}\n` +
      `• *HU Student ID:* \`${student.hu_student_id}\`\n` +
      `• *Department:* ${student.department?.name || 'N/A'}\n` +
      `• *Academic Year:* ${student.academic_year?.name || 'N/A'}\n` +
      `• *Section:* ${student.section?.name || 'N/A'}\n` +
      `• *Section Representative:* ${repList}\n` +
      `• *Registration Status:* ${student.registration_status.toUpperCase()}\n` +
      `• *Identity Locked:* ${student.is_locked ? '✅ Yes' : '❌ No'}\n` +
      `• *Linked Telegram ID:* \`${student.telegram_user_id}\`\n` +
      `───────────────────────────\n` +
      `_If any detail is incorrect, send /correction to submit an owner-reviewed change request._`,
    { parse_mode: 'Markdown' }
  );
}
