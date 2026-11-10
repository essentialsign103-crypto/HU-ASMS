// HU-ASMS: Telegram Webhook Secret Token Verification Middleware (Phase 13)
// Enforces X-Telegram-Bot-Api-Secret-Token validation using constant-time comparison

import crypto from 'node:crypto';

/**
 * Validates the X-Telegram-Bot-Api-Secret-Token header using timingSafeEqual
 * to prevent side-channel timing attacks.
 */
export function verifyTelegramWebhookSecret(
  incomingHeader: string | string[] | undefined,
  expectedSecret: string | undefined
): boolean {
  if (!incomingHeader || !expectedSecret) {
    return false;
  }

  const token = Array.isArray(incomingHeader) ? incomingHeader[0] : incomingHeader;

  const tokenBuffer = Buffer.from(token, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSecret, 'utf-8');

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * HTTP Request Handler Guard for Webhook Endpoints
 */
export function handleWebhookSecretGuard(
  req: { headers: Record<string, string | string[] | undefined> },
  expectedSecret: string | undefined
): { authorized: boolean; statusCode: number; error?: string } {
  const secretHeader =
    req.headers['x-telegram-bot-api-secret-token'] ||
    req.headers['X-Telegram-Bot-Api-Secret-Token'];

  if (!expectedSecret) {
    return {
      authorized: false,
      statusCode: 500,
      error: 'TELEGRAM_WEBHOOK_SECRET is not configured on the server.',
    };
  }

  if (!secretHeader) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Missing X-Telegram-Bot-Api-Secret-Token header.',
    };
  }

  const isValid = verifyTelegramWebhookSecret(secretHeader, expectedSecret);
  if (!isValid) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Invalid webhook secret token.',
    };
  }

  return { authorized: true, statusCode: 200 };
}
