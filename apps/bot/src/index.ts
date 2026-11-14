// HU-ASMS: Telegram Bot Entrypoint (Serverless Vercel Architecture & Local Dev Polling)
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createBot, type CreateBotOptions } from './bot.js';
import {
  processTelegramWebhookRequest,
  handleTelegramWebhookFetch,
  resetWebhookBotCache,
  UpdateDeduplicator,
  defaultUpdateDeduplicator,
} from './webhook.js';
import { sanitizeLogData } from './utils/error-handler.js';

export { createBot, type CreateBotOptions } from './bot.js';
export {
  processTelegramWebhookRequest,
  handleTelegramWebhookFetch,
  resetWebhookBotCache,
  UpdateDeduplicator,
  defaultUpdateDeduplicator,
} from './webhook.js';
export * from './types/context.js';
export * from './services/registration.service.js';
export * from './services/notification.service.js';

/**
 * Local standalone runner for developer testing.
 * In production, all updates are processed serverless via Vercel at /api/bot/webhook.
 * Long polling is strictly disabled in production.
 */
async function bootstrap() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') {
    console.log(
      '[HU-ASMS Bot] Standalone development mode. Set a valid TELEGRAM_BOT_TOKEN in .env to run local polling.'
    );
    return;
  }

  // STRICT SAFETY GUARD: Production never runs long polling
  if (process.env.NODE_ENV === 'production') {
    console.log(
      '[HU-ASMS Bot] Production mode detected. Long polling is strictly disabled.\n' +
      '[HU-ASMS Bot] All Telegram updates are processed serverless by Next.js at /api/bot/webhook on Vercel.'
    );
    return;
  }

  try {
    const bot = createBot(token);
    console.log('[HU-ASMS Bot] Starting local development polling...');
    await bot.start({
      onStart: (info) => {
        console.log(
          `[HU-ASMS Bot] Connected as @${info.username} (${info.id}) [Local Development Polling]`
        );
      },
    });
  } catch (err: any) {
    console.error(
      '[HU-ASMS Bot] Local polling failed to start:',
      sanitizeLogData({ message: err?.message || String(err) })
    );
  }
}

function isExecutedDirectly(): boolean {
  if (!process.argv[1] || process.env.NODE_ENV === 'test') {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  bootstrap().catch((err) => {
    console.error(
      '[HU-ASMS Bot] Fatal bootstrap error:',
      sanitizeLogData({ message: err?.message || String(err) })
    );
    process.exit(1);
  });
}
