// HU-ASMS: /correction Command Handler (Phase 04)
import type { BotContext } from '../types/context.js';
import { requirePrivateChat } from '../utils/chat-guard.js';

export async function handleCorrectionCommand(ctx: BotContext): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'identity correction requests'))) {
    return;
  }
  await ctx.conversation.enter('correctionConversation');
}
