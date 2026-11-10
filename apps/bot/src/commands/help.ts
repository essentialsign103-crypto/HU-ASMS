// HU-ASMS: /help Command Handler (Phase 04)
import type { BotContext } from '../types/context.js';

export async function handleHelpCommand(ctx: BotContext): Promise<void> {
  await ctx.reply(
    `📖 *HU-ASMS Student & Representative Help Center*\n\n` +
      `*Available Student Commands:*\n` +
      `• /start - Open main menu or register identity\n` +
      `• /profile - View registered academic profile\n` +
      `• /correction - Submit identity correction request to System Owner\n` +
      `• /help - Display this command overview\n\n` +
      `*Key Guidelines:*\n` +
      `1. Your HU Student ID is permanent. Once approved, your academic identity is locked.\n` +
      `2. Submissions are automatically routed to your assigned section representative.\n` +
      `3. For group projects, all members must confirm membership before the group leader submits.\n\n` +
      `For additional assistance, contact your Section Representative or the System Administrator.`,
    { parse_mode: 'Markdown' }
  );
}
