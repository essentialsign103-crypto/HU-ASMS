// HU-ASMS: Telegram Bot Entrypoint
import 'dotenv/config';
import { createBot } from './bot.js';

export { createBot } from './bot.js';
export * from './types/context.js';
export * from './services/registration.service.js';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_WEBHOOK_URL) {
    console.log('Bot running in webhook mode for production deployment.');
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') {
    console.log('[HU-ASMS Bot] Ready in standalone mode. Provide a valid TELEGRAM_BOT_TOKEN in .env to run live polling.');
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
  } catch (err) {
    console.error('[HU-ASMS Bot] Failed to start:', err);
  }
}

// Automatically bootstrap if executed directly
if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
