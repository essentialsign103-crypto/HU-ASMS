// HU-ASMS: Telegram Serverless Webhook Processor & Vercel Adapter (Phase 14 & Final Vercel Architecture)
// Enforces X-Telegram-Bot-Api-Secret-Token verification, durable Supabase update deduplication, and safe serverless execution

import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot, type CreateBotOptions } from './bot.js';
import { handleWebhookSecretGuard } from './middleware/webhook-security.middleware.js';
import { sanitizeLogData } from './utils/error-handler.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
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

export interface UpdateDeduplicatorOptions {
  maxEntries?: number;
  ttlMs?: number;
  supabaseClient?: any;
}

/**
 * Serverless-safe update deduplicator.
 * Persists update_ids durably in Supabase `public.bot_sessions` across stateless Vercel invocations,
 * with an in-memory cache for fast sub-millisecond duplicate rejections.
 */
export class UpdateDeduplicator {
  private inMemoryIds: Map<number, number>;
  private maxEntries: number;
  private ttlMs: number;
  private supabaseClient?: any;

  constructor(options: UpdateDeduplicatorOptions = {}) {
    this.inMemoryIds = new Map();
    this.maxEntries = options.maxEntries ?? 10000;
    this.ttlMs = options.ttlMs ?? 86400000; // 24 hours
    this.supabaseClient = options.supabaseClient;
  }

  /**
   * Checks if update_id has already been processed or is duplicate.
   * If not, marks it as processed durably.
   * Returns true if DUPLICATE, false if NEW.
   */
  async isDuplicateAndMark(updateId: number): Promise<boolean> {
    const now = Date.now();

    // 1. In-memory check (fast-path for warm serverless lambdas)
    if (this.inMemoryIds.has(updateId)) {
      return true;
    }

    // 2. Durable Supabase check (serverless-safe cross-instance idempotency)
    const client = this.supabaseClient;
    if (client && typeof client.from === 'function') {
      try {
        const sessionKey = `tg_update:${updateId}`;
        const expiresAt = new Date(now + this.ttlMs).toISOString();

        // Attempt insert. If updateId already exists, primary key conflict 23505 occurs
        const { error } = await client.from('bot_sessions').insert({
          session_key: sessionKey,
          session_data: { update_id: updateId, received_at: new Date(now).toISOString() },
          expires_at: expiresAt,
        });

        if (error) {
          // If duplicate key error (23505), update has already been accepted and processed
          if (
            error.code === '23505' ||
            error.message?.includes('duplicate key') ||
            error.message?.includes('bot_sessions_pkey')
          ) {
            this.inMemoryIds.set(updateId, now);
            return true;
          }
          console.warn('[HU-ASMS Webhook] Durable deduplication check warning:', error.message);
        }
      } catch (err: any) {
        console.warn('[HU-ASMS Webhook] Durable deduplication exception:', err?.message || err);
      }
    }

    // 3. Mark in-memory
    if (this.inMemoryIds.size >= this.maxEntries) {
      const cutoff = now - this.ttlMs;
      for (const [id, ts] of this.inMemoryIds) {
        if (ts < cutoff || this.inMemoryIds.size >= this.maxEntries) {
          this.inMemoryIds.delete(id);
        }
      }
    }

    this.inMemoryIds.set(updateId, now);
    return false;
  }

  clear(): void {
    this.inMemoryIds.clear();
  }

  size(): number {
    return this.inMemoryIds.size;
  }
}

function resolveDurableDeduplicator(): UpdateDeduplicator {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    try {
      return new UpdateDeduplicator({ supabaseClient: getSupabaseAdminClient() });
    } catch {
      // Fallback to in-memory if DB client is not initialized
    }
  }

  return new UpdateDeduplicator();
}

export const defaultUpdateDeduplicator = resolveDurableDeduplicator();

export interface WebhookProcessorDependencies {
  bot?: Bot<BotContext>;
  botToken?: string;
  secretToken?: string;
  botOptions?: CreateBotOptions;
  deduplicator?: UpdateDeduplicator;
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
 * Clears the cached singleton bot instance and update deduplicator (intended for isolated unit tests).
 */
export function resetWebhookBotCache(): void {
  cachedBot = null;
  cachedToken = undefined;
  defaultUpdateDeduplicator.clear();
}

/**
 * Validates method, webhook secret header, and JSON update payload before dispatching to grammY.
 * Deduplicates update_ids to prevent replaying or duplicate actions on Telegram retries.
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

  const expectedSecret = 'secretToken' in deps ? deps.secretToken : process.env.TELEGRAM_WEBHOOK_SECRET;
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

  // Idempotency: Prevent duplicate execution if Telegram retries the same update_id
  const deduplicator = deps.deduplicator || defaultUpdateDeduplicator;
  const isDuplicate = await deduplicator.isDuplicateAndMark(parsedUpdate.update_id);
  if (isDuplicate) {
    return {
      statusCode: 200,
      body: { ok: true, duplicate: true, update_id: parsedUpdate.update_id },
    };
  }

  // Separate bot setup (init) from update processing so we can return
  // the right HTTP status to Telegram:
  //   • Infrastructure failures (token missing, Supabase unreachable) → 500 (Telegram retries)
  //   • Update processing errors (bad handler, session issues) → 200 (Telegram moves on)
  let bot;
  try {
    bot = deps.bot || getOrCreateWebhookBot(deps.botToken, deps.botOptions);
    if (!bot.isInited()) {
      await bot.init();
    }
  } catch (initErr: any) {
    // Clear the broken cached bot so the next request creates a fresh one
    if (!deps.bot) {
      cachedBot = null;
      cachedToken = undefined;
    }
    console.error(
      '[HU-ASMS Webhook] Bot initialisation failed — returning 500 for Telegram retry:',
      sanitizeLogData({
        updateId: parsedUpdate.update_id,
        errorClass: initErr?.constructor?.name ?? 'Error',
        error: initErr?.message ?? String(initErr),
      })
    );
    return {
      statusCode: 500,
      body: { ok: false, error: 'Failed to process Telegram update.' },
    };
  }

  // Once the bot is initialised, any error from handleUpdate is an application-level
  // error (middleware threw, handler crashed, session write failed, etc.).
  // Return 200 so Telegram does not keep retrying the same update.
  try {
    await bot.handleUpdate(parsedUpdate);
    return { statusCode: 200, body: { ok: true } };
  } catch (err: any) {
    // Invoke the registered error handler (bot.catch) if reachable
    try {
      if (typeof (bot as any).errorHandler === 'function') {
        await (bot as any).errorHandler(err);
      }
    } catch {
      // Swallow — the original error is what matters
    }
    console.error(
      '[HU-ASMS Webhook] Update processing error (returning 200 to prevent Telegram retry):',
      sanitizeLogData({
        updateId: parsedUpdate.update_id,
        errorClass: err?.constructor?.name ?? 'unknown',
        hasCtx: Boolean((err as any)?.ctx),
        message: err?.message ?? String(err),
        innerMessage: (err as any)?.error?.message ?? null,
      })
    );
    // Always return 200 for update processing errors — Telegram has already delivered
    // the update and retrying would cause duplicate processing
    return { statusCode: 200, body: { ok: true } };
  }
}

/**
 * Web Fetch API adapter used by Next.js App Router POST /api/bot/webhook on Vercel.
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
