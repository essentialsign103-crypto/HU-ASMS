// HU-ASMS: Next.js App Router Telegram Webhook Endpoint
// Enforces secret-token header verification before dispatching updates into @hu-asms/bot

import { handleTelegramWebhookFetch } from '@hu-asms/bot/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Supported on all Vercel plans: 60s max on legacy Hobby serverless, <= 300s on Fluid Compute / Pro
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhookFetch(request);
}
