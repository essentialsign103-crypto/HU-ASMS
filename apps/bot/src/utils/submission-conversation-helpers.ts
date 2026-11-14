// HU-ASMS: Shared Conversation Helpers for Document Submissions
import type { Document } from 'grammy/types';
import type { BotContext, BotConversation } from '../types/context.js';

/**
 * Waits for a real Telegram Document attachment while rejecting compressed photos,
 * media, or plain text with explicit recovery guidance and `/cancel` instructions.
 */
export async function waitForSubmissionDocument(
  conversation: BotConversation,
  ctx: BotContext
): Promise<Document | undefined> {
  const fileMsg = await conversation.waitFor(':document', {
    otherwise: async (otherCtx) => {
      if (otherCtx.callbackQuery) {
        await otherCtx.answerCallbackQuery({
          text: 'Please send a file attachment or send /cancel.',
        });
        return;
      }

      if (otherCtx.message?.photo) {
        await otherCtx.reply(
          `⚠️ *Compressed Photo Unsupported*\n\n` +
            `Telegram compresses images sent as photos, stripping original file metadata.\n\n` +
            `Please tap the 📎 attachment icon and send your assignment as a *File / Document* (without compression), or send /cancel to abort.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (
        otherCtx.message?.video ||
        otherCtx.message?.animation ||
        otherCtx.message?.sticker ||
        otherCtx.message?.voice ||
        otherCtx.message?.audio
      ) {
        await otherCtx.reply(
          `⚠️ *Compressed Media / Audio Unsupported*\n\n` +
            `Please tap the 📎 attachment icon and attach your submission as a *File / Document*, or send /cancel to abort.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await otherCtx.reply(
        `⚠️ *Document File Required*\n\n` +
          `Please attach your submission using the 📎 *File / Document* picker (do not send plain text or compressed photos), or send /cancel to abort.`,
        { parse_mode: 'Markdown' }
      );
    },
  });

  return fileMsg.message?.document;
}
