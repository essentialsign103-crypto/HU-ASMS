// HU-ASMS: Telegram Bot Entrypoint
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createBot } from './bot.js';
import { createWebhookHttpServer } from './webhook.js';
import { sanitizeLogData } from './utils/error-handler.js';

export { createBot, type CreateBotOptions } from './bot.js';
export {
  processTelegramWebhookRequest,
  handleTelegramWebhookFetch,
  createWebhookHttpServer,
  resetWebhookBotCache,
} from './webhook.js';
export * from './types/context.js';
export * from './services/registration.service.js';

async function bootstrap() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') {
    console.log('[HU-ASMS Bot] Ready in standalone mode. Provide a valid TELEGRAM_BOT_TOKEN in .env to run live polling or webhook mode.');
    return;
  }

  if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_WEBHOOK_URL) {
    const port = Number(process.env.PORT || 3001);
    const bot = createBot(token);
    await bot.init();
    const server = createWebhookHttpServer({ bot });
    server.listen(port, () => {
      console.log(`[HU-ASMS Bot] Webhook listener active on port ${port}.`);
    });
    return;
  }

  try {
    const bot = createBot(token);
    console.log('[HU-ASMS Bot] Starting long polling...');
    await bot.start({
      onStart: (info) => {
        console.log(`[HU-ASMS Bot] Successfully connected as @${info.username}`);
      },
    });
  } catch (err: any) {
    console.error(
      '[HU-ASMS Bot] Failed to start:',
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
  bootstrap();
}
