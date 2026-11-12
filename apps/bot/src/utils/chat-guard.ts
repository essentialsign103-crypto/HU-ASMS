// HU-ASMS: Private Chat Enforcement Helper for Sensitive Student Workflows
import type { BotContext } from '../types/context.js';

export function isPrivateTelegramChat(ctx: Pick<BotContext, 'chat'>): boolean {
  return ctx.chat?.type === 'private';
}

/**
 * Ensures sensitive student registration, identity correction, profile lookup, and
 * assignment upload flows execute strictly inside private 1-on-1 Telegram chats.
 */
export async function requirePrivateChat(
  ctx: BotContext,
  workflowLabel: string = 'this feature'
): Promise<boolean> {
  if (isPrivateTelegramChat(ctx)) {
    return true;
  }

  await ctx.reply(
    `🔒 *Private Chat Required*\n\n` +
      `To protect student privacy and prevent shared-chat interference, please open a direct 1-on-1 message with this bot to use *${workflowLabel}*.`,
    { parse_mode: 'Markdown' }
  );
  return false;
}
