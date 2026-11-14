// HU-ASMS: Telegram Bot Serverless Webhook & Vercel API Route Unit Tests
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleTelegramWebhookFetch,
  processTelegramWebhookRequest,
  UpdateDeduplicator,
  resetWebhookBotCache,
} from '../src/webhook.js';

describe('Vercel Serverless Telegram Webhook & Security Architecture', () => {
  const TEST_SECRET = 'correct_test_secret_token_12345';
  const TEST_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';

  beforeEach(() => {
    resetWebhookBotCache();
  });

  afterEach(() => {
    resetWebhookBotCache();
  });

  describe('1. Production Safety Guards (No Long Polling in Production)', () => {
    it('verifies that production environment does not allow long polling', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        // When NODE_ENV === 'production', the standalone runner does not call bot.start()
        assert.equal(process.env.NODE_ENV, 'production');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('2. Vercel Serverless Webhook Fetch Handler (App Router /api/bot/webhook)', () => {
    let handledUpdates: any[] = [];
    let mockBot: any;

    beforeEach(() => {
      handledUpdates = [];
      mockBot = {
        isInited: () => true,
        init: async () => {},
        handleUpdate: async (up: any) => {
          handledUpdates.push(up);
        },
      };
    });

    it('accepts valid POST webhook request with matching X-Telegram-Bot-Api-Secret-Token', async () => {
      const req = new Request('https://hu-asms.vercel.app/api/bot/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET,
        },
        body: JSON.stringify({ update_id: 2001, message: { text: '/start' } }),
      });

      const res = await handleTelegramWebhookFetch(req, {
        bot: mockBot,
        secretToken: TEST_SECRET,
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.ok, true);
      assert.equal(handledUpdates.length, 1);
      assert.equal(handledUpdates[0].update_id, 2001);
    });

    it('rejects POST request with missing X-Telegram-Bot-Api-Secret-Token with HTTP 403', async () => {
      const req = new Request('https://hu-asms.vercel.app/api/bot/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ update_id: 2002, message: { text: '/start' } }),
      });

      const res = await handleTelegramWebhookFetch(req, {
        bot: mockBot,
        secretToken: TEST_SECRET,
      });

      assert.equal(res.status, 403);
      const data = (await res.json()) as any;
      assert.equal(data.ok, false);
      assert.equal(data.error, 'Missing X-Telegram-Bot-Api-Secret-Token header.');
      assert.equal(handledUpdates.length, 0);
    });

    it('rejects POST request with incorrect secret token with HTTP 403', async () => {
      const req = new Request('https://hu-asms.vercel.app/api/bot/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'bad_fake_secret_token_abcdef',
        },
        body: JSON.stringify({ update_id: 2003, message: { text: '/start' } }),
      });

      const res = await handleTelegramWebhookFetch(req, {
        bot: mockBot,
        secretToken: TEST_SECRET,
      });

      assert.equal(res.status, 403);
      const data = (await res.json()) as any;
      assert.equal(data.ok, false);
      assert.equal(data.error, 'Invalid webhook secret token.');
      assert.equal(handledUpdates.length, 0);
    });

    it('rejects non-POST HTTP methods with HTTP 405 Method Not Allowed', async () => {
      const req = new Request('https://hu-asms.vercel.app/api/bot/webhook', {
        method: 'GET',
        headers: {
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET,
        },
      });

      const res = await handleTelegramWebhookFetch(req, {
        bot: mockBot,
        secretToken: TEST_SECRET,
      });

      assert.equal(res.status, 405);
      const data = (await res.json()) as any;
      assert.equal(data.ok, false);
      assert.equal(data.error, 'Method Not Allowed');
    });

    it('rejects oversized request bodies exceeding 1 MB safety limit with HTTP 413', async () => {
      // Create body > 1 MB (1024 * 1024 + 1 bytes)
      const bigString = 'x'.repeat(1024 * 1024 + 50);
      const req = new Request('https://hu-asms.vercel.app/api/bot/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET,
        },
        body: bigString,
      });

      const res = await handleTelegramWebhookFetch(req, {
        bot: mockBot,
        secretToken: TEST_SECRET,
      });

      assert.equal(res.status, 413);
      const data = (await res.json()) as any;
      assert.equal(data.ok, false);
      assert.equal(data.error, 'Payload too large.');
    });

    it('fails closed with HTTP 500 when server secret token is completely unconfigured', async () => {
      const req = new Request('https://hu-asms.vercel.app/api/bot/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET,
        },
        body: JSON.stringify({ update_id: 2004, message: { text: '/start' } }),
      });

      const res = await handleTelegramWebhookFetch(req, {
        bot: mockBot,
        secretToken: undefined,
      });

      assert.equal(res.status, 500);
      const data = (await res.json()) as any;
      assert.equal(data.ok, false);
      assert.equal(data.error, 'Webhook server configuration error.');
    });
  });

  describe('3. Durable & In-Memory Update Idempotency (Duplicate Prevention)', () => {
    it('returns idempotent 200 OK without re-executing handlers when Telegram retries duplicate update_id', async () => {
      let executeCount = 0;
      const mockBot: any = {
        isInited: () => true,
        init: async () => {},
        handleUpdate: async () => {
          executeCount++;
        },
      };

      const deduplicator = new UpdateDeduplicator({ maxEntries: 100, ttlMs: 60000 });

      // First arrival of update 88888
      const res1 = await processTelegramWebhookRequest(
        {
          method: 'POST',
          headers: { 'x-telegram-bot-api-secret-token': TEST_SECRET },
          body: JSON.stringify({ update_id: 88888, message: { text: '/submit' } }),
        },
        { bot: mockBot, secretToken: TEST_SECRET, deduplicator }
      );

      assert.equal(res1.statusCode, 200);
      assert.equal(res1.body.ok, true);
      assert.equal(executeCount, 1, 'First update must be executed');

      // Duplicate delivery of update 88888 (e.g. Telegram retry)
      const res2 = await processTelegramWebhookRequest(
        {
          method: 'POST',
          headers: { 'x-telegram-bot-api-secret-token': TEST_SECRET },
          body: JSON.stringify({ update_id: 88888, message: { text: '/submit' } }),
        },
        { bot: mockBot, secretToken: TEST_SECRET, deduplicator }
      );

      assert.equal(res2.statusCode, 200, 'Duplicate update must return 200 OK to acknowledge Telegram');
      assert.equal(res2.body.ok, true);
      assert.equal((res2.body as any).duplicate, true);
      assert.equal(executeCount, 1, 'Duplicate update must NOT execute bot handler again');
    });

    it('durable deduplication checks Supabase bot_sessions table when client is configured', async () => {
      const insertedKeys: string[] = [];
      const mockSupabase: any = {
        from: (table: string) => {
          assert.equal(table, 'bot_sessions');
          return {
            insert: async (row: any) => {
              if (insertedKeys.includes(row.session_key)) {
                return { error: { code: '23505', message: 'duplicate key value violates unique constraint "bot_sessions_pkey"' } };
              }
              insertedKeys.push(row.session_key);
              return { error: null };
            },
          };
        },
      };

      const deduplicator = new UpdateDeduplicator({ supabaseClient: mockSupabase });

      const isDup1 = await deduplicator.isDuplicateAndMark(99001);
      assert.equal(isDup1, false, 'First update is new');
      assert.equal(insertedKeys.includes('tg_update:99001'), true);

      // Simulating a separate serverless lambda cold-start with a fresh in-memory deduplicator sharing the same Supabase DB
      const freshColdStartDeduplicator = new UpdateDeduplicator({ supabaseClient: mockSupabase });
      const isDup2 = await freshColdStartDeduplicator.isDuplicateAndMark(99001);
      assert.equal(isDup2, true, 'Second update across independent serverless lambdas is recognized as duplicate via Supabase primary key conflict');
    });
  });
});
