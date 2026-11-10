// HU-ASMS: Student Academic Identity Correction Request Conversation (Phase 04)
import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { StudentRegistrationService } from '../services/registration.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';

export async function correctionConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Telegram account cannot be identified.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const registrationService = new StudentRegistrationService(supabase);

  // 1. Check if user has an existing approved student record
  const student = await conversation.external(() =>
    registrationService.getStudentByTelegramId(telegramUserId)
  );

  if (!student) {
    await ctx.reply(
      '⚠️ You do not have an approved student record yet. Please run /start to register.'
    );
    return;
  }

  await ctx.reply(
    `🔒 *Academic Identity Correction Request*\n\n` +
      `Current Registered Identity:\n` +
      `• Student ID: \`${student.hu_student_id}\`\n` +
      `• Full Name: *${student.full_name}*\n` +
      `• Department: *${student.department?.name || 'N/A'}*\n` +
      `• Academic Scope: *${student.academic_year?.name || 'N/A'} — ${student.section?.name || 'N/A'}*\n\n` +
      `To protect academic integrity, your identity cannot be modified independently.\n` +
      `Please state what information needs correction and why:`,
    { parse_mode: 'Markdown' }
  );

  const reasonMsg = await conversation.waitFor(':text');
  const reason = reasonMsg.message?.text?.trim() || '';

  if (reason.length < 10) {
    await ctx.reply(
      '❌ Correction reason is too short. Please provide a clear explanation (at least 10 characters).'
    );
    return;
  }

  const confirmKeyboard = new InlineKeyboard()
    .text('✅ Submit Correction Request', 'confirm_correction_req')
    .text('❌ Cancel', 'cancel_correction_req');

  await ctx.reply(
    `📋 *Confirm Correction Submission*\n\n` +
      `Reason for Change:\n_"${reason}"_\n\n` +
      `This request will be forwarded directly to the System Owner for administrative review. Do you want to submit?`,
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard }
  );

  const decision = await conversation.waitForCallbackQuery([
    'confirm_correction_req',
    'cancel_correction_req',
  ]);

  if (decision.callbackQuery.data === 'confirm_correction_req') {
    try {
      await conversation.external(() =>
        registrationService.submitCorrectionRequest(student.id, reason, {
          requested_at: new Date().toISOString(),
          requested_by_telegram_id: telegramUserId,
        })
      );

      await decision.answerCallbackQuery({ text: 'Correction request submitted' });
      await ctx.reply(
        `✅ *Correction Request Submitted*\n\n` +
          `Your request has been logged and sent to the System Owner.\n` +
          `You will be notified once the administrator reviews and processes your request.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Failed to submit correction request: ${msg}`);
    }
  } else {
    await decision.answerCallbackQuery({ text: 'Request cancelled' });
    await ctx.reply('Correction request cancelled.');
  }
}
