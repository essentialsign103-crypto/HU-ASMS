// HU-ASMS: Next.js App Router Telegram Webhook Endpoint
// Enforces secret-token header verification before dispatching updates into @hu-asms/bot

import { handleTelegramWebhookFetch } from '@hu-asms/bot/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhookFetch(request);
}
