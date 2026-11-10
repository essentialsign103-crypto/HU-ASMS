// HU-ASMS: /correction Command Handler (Phase 04)
import type { BotContext } from '../types/context.js';

export async function handleCorrectionCommand(ctx: BotContext): Promise<void> {
  await ctx.conversation.enter('correctionConversation');
}
