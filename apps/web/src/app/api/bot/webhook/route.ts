// HU-ASMS: Next.js App Router Telegram Webhook Endpoint
// Enforces secret-token header verification before dispatching updates into @hu-asms/bot

import { handleTelegramWebhookFetch } from '@hu-asms/bot/webhook';
import type { UserFromGetMe } from 'grammy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Supported on all Vercel plans: 60s max on legacy Hobby serverless, <= 300s on Fluid Compute / Pro
export const maxDuration = 60;

// Static bot info — avoids a Telegram getMe() API round-trip on every cold start.
// bot.init() is skipped entirely; grammY uses this object directly as ctx.me.
// Values sourced from: GET https://api.telegram.org/bot<TOKEN>/getMe
// If this bot token is ever replaced, update all fields below to match the new bot's getMe response.
const STATIC_BOT_INFO: UserFromGetMe = {
  id: 9200252077,
  is_bot: true,
  first_name: 'HU ASMS \u2013 Academic Assistant',
  username: 'HU_ASMS_Bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  supports_guest_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export async function POST(request: Request): Promise<Response> {
  // Structured intake log — visible in Vercel Function logs.
  // Never logs the secret header value or any PII.
  const hasSecret = request.headers.has('x-telegram-bot-api-secret-token');
  console.log('[webhook] POST received', {
    hasSecretHeader: hasSecret,
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
  });

  const response = await handleTelegramWebhookFetch(request, {
    botOptions: { botInfo: STATIC_BOT_INFO },
  });

  console.log('[webhook] POST response', { status: response.status });
  return response;
}
