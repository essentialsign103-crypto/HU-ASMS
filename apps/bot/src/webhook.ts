// HU-ASMS: Telegram Webhook Processor & HTTP Adapters (Phase 14)
// Enforces X-Telegram-Bot-Api-Secret-Token verification before dispatching updates into grammY

import http from 'node:http';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot, type CreateBotOptions } from './bot.js';
import { handleWebhookSecretGuard } from './middleware/webhook-security.middleware.js';
import { sanitizeLogData } from './utils/error-handler.js';
import type { BotContext } from './types/context.js';

export interface WebhookHttpRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface WebhookHttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface WebhookProcessorDependencies {
  bot?: Bot<BotContext>;
  botToken?: string;
  secretToken?: string;
  botOptions?: CreateBotOptions;
}

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1 MB safety limit

let cachedBot: Bot<BotContext> | null = null;
let cachedToken: string | undefined;

function getOrCreateWebhookBot(
  botToken?: string,
  botOptions?: CreateBotOptions
): Bot<BotContext> {
  const resolvedToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (botOptions) {
    return createBot(resolvedToken, botOptions);
  }
  if (!cachedBot || cachedToken !== resolvedToken) {
    cachedBot = createBot(resolvedToken);
    cachedToken = resolvedToken;
  }
  return cachedBot;
}

/**
 * Clears the cached singleton bot instance (intended for isolated unit tests).
 */
export function resetWebhookBotCache(): void {
  cachedBot = null;
  cachedToken = undefined;
}

/**
 * Validates method, webhook secret header, and JSON update payload before dispatching to grammY.
 */
export async function processTelegramWebhookRequest(
  req: WebhookHttpRequest,
  deps: WebhookProcessorDependencies = {}
): Promise<WebhookHttpResponse> {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    return {
      statusCode: 405,
      body: { ok: false, error: 'Method Not Allowed' },
    };
  }

  const expectedSecret = deps.secretToken ?? process.env.TELEGRAM_WEBHOOK_SECRET;
  const guardResult = handleWebhookSecretGuard(
    { headers: req.headers },
    expectedSecret
  );

  if (!guardResult.authorized) {
    return {
      statusCode: guardResult.statusCode,
      body: {
        ok: false,
        error:
          guardResult.statusCode === 500
            ? 'Webhook server configuration error.'
            : guardResult.error || 'Forbidden',
      },
    };
  }

  let parsedUpdate: Update;
  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!raw || typeof raw !== 'object' || typeof (raw as Update).update_id !== 'number') {
      return {
        statusCode: 400,
        body: { ok: false, error: 'Invalid Telegram Update payload.' },
      };
    }
    parsedUpdate = raw as Update;
  } catch {
    return {
      statusCode: 400,
      body: { ok: false, error: 'Malformed JSON body.' },
    };
  }

  try {
    const bot = deps.bot || getOrCreateWebhookBot(deps.botToken, deps.botOptions);
    if (!bot.isInited()) {
      await bot.init();
    }
    await bot.handleUpdate(parsedUpdate);
    return { statusCode: 200, body: { ok: true } };
  } catch (err: any) {
    console.error(
      'Telegram webhook update processing failed:',
      sanitizeLogData({
        updateId: parsedUpdate.update_id,
        error: err?.message || 'Unknown error',
      })
    );
    return {
      statusCode: 500,
      body: { ok: false, error: 'Failed to process Telegram update.' },
    };
  }
}

/**
 * Web Fetch API adapter used by Next.js App Router POST /api/bot/webhook.
 */
export async function handleTelegramWebhookFetch(
  request: Request,
  deps: WebhookProcessorDependencies = {}
): Promise<Response> {
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json(
      { ok: false, error: 'Failed to read request body.' },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json(
      { ok: false, error: 'Payload too large.' },
      { status: 413 }
    );
  }

  const result = await processTelegramWebhookRequest(
    {
      method: request.method,
      headers,
      body: rawBody,
    },
    deps
  );

  return Response.json(result.body, { status: result.statusCode });
}

/**
 * Standalone Node HTTP server for webhook mode outside Next.js (e.g. dedicated bot process).
 */
export function createWebhookHttpServer(
  deps: WebhookProcessorDependencies = {}
): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Payload too large.' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      const result = await processTelegramWebhookRequest(
        {
          method: req.method,
          headers: req.headers,
          body: bodyStr,
        },
        deps
      );
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });

    req.on('error', (err) => {
      console.error(
        'Webhook HTTP request stream error:',
        sanitizeLogData({ error: err?.message || 'Stream error' })
      );
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Malformed HTTP request.' }));
      }
    });
  });
}
