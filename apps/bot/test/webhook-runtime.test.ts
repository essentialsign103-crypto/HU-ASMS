// HU-ASMS: Phase 14 Bot Rate-Limiting & Webhook Runtime Integration Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Update, UserFromGetMe } from 'grammy/types';
import { createBot } from '../src/bot.js';
import {
  processTelegramWebhookRequest,
  handleTelegramWebhookFetch,
  createWebhookHttpServer,
} from '../src/webhook.js';

const TEST_BOT_INFO: UserFromGetMe = {
  id: 999000111,
  is_bot: true,
  first_name: 'HUASMS Test Bot',
  username: 'hu_asms_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function createTestBotWithCapture(maxRequests = 3, windowMs = 10000) {
  const sentMessages: Array<{ method: string; chatId: number | string; text: string }> = [];

  const bot = createBot('123456:TEST_TOKEN_FOR_RUNTIME_ONLY', {
    botInfo: TEST_BOT_INFO,
    rateLimit: { maxRequests, windowMs },
  });

  // Intercept outbound Telegram Bot API calls cleanly without network access
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, any>;
    if (method === 'sendMessage') {
      sentMessages.push({
        method,
        chatId: p.chat_id,
        text: p.text,
      });
      return {
        ok: true,
        result: {
          message_id: sentMessages.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: 'private', first_name: 'Student' },
          text: p.text,
        } as any,
      };
    }
    return { ok: true, result: true as any };
  });

  return { bot, sentMessages };
}

function makeHelpCommandUpdate(updateId: number, userId: number): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: 'private', first_name: 'Student' },
      from: { id: userId, is_bot: false, first_name: 'Student' },
      text: '/help',
      entities: [{ offset: 0, length: 5, type: 'bot_command' }],
    },
  };
}

describe('Phase 14 — Bot Runtime Rate-Limiting Middleware Wiring', () => {
  it('allows legitimate /help updates within limit and blocks flooding once limit is exceeded', async () => {
    const { bot, sentMessages } = createTestBotWithCapture(2, 10000);

    await bot.handleUpdate(makeHelpCommandUpdate(1001, 55501));
    await bot.handleUpdate(makeHelpCommandUpdate(1002, 55501));
    // 3rd request within window must be intercepted by createRateLimiterMiddleware BEFORE /help handler
    await bot.handleUpdate(makeHelpCommandUpdate(1003, 55501));

    assert.equal(sentMessages.length, 3);
    assert.doesNotMatch(sentMessages[0].text, /Rate limit exceeded/);
    assert.doesNotMatch(sentMessages[1].text, /Rate limit exceeded/);
    assert.match(sentMessages[2].text, /Rate limit exceeded/);
  });

  it('tracks rate limits independently per Telegram user ID', async () => {
    const { bot, sentMessages } = createTestBotWithCapture(1, 10000);

    await bot.handleUpdate(makeHelpCommandUpdate(2001, 77001));
    await bot.handleUpdate(makeHelpCommandUpdate(2002, 77002));
    await bot.handleUpdate(makeHelpCommandUpdate(2003, 77001));

    assert.equal(sentMessages.length, 3);
    assert.doesNotMatch(sentMessages[0].text, /Rate limit exceeded/);
    assert.doesNotMatch(sentMessages[1].text, /Rate limit exceeded/);
    assert.match(sentMessages[2].text, /Rate limit exceeded/);
  });
});

describe('Phase 14 — Webhook Handler Security & Dispatch Flow', () => {
  const VALID_SECRET = 'whsec_test_super_secret_token_987654';

  it('rejects requests when TELEGRAM_WEBHOOK_SECRET is unset (fail-closed 500)', async () => {
    const { bot } = createTestBotWithCapture();
    const res = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': VALID_SECRET },
        body: JSON.stringify(makeHelpCommandUpdate(3001, 88001)),
      },
      { bot, secretToken: '' }
    );

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
  });

  it('rejects requests with missing X-Telegram-Bot-Api-Secret-Token header (403)', async () => {
    const { bot } = createTestBotWithCapture();
    const res = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: {},
        body: JSON.stringify(makeHelpCommandUpdate(3002, 88002)),
      },
      { bot, secretToken: VALID_SECRET }
    );

    assert.equal(res.statusCode, 403);
    assert.match(String(res.body.error), /Missing X-Telegram-Bot-Api-Secret-Token/);
  });

  it('rejects requests with invalid webhook secret token (403)', async () => {
    const { bot } = createTestBotWithCapture();
    const res = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret-value' },
        body: JSON.stringify(makeHelpCommandUpdate(3003, 88003)),
      },
      { bot, secretToken: VALID_SECRET }
    );

    assert.equal(res.statusCode, 403);
    assert.match(String(res.body.error), /Invalid webhook secret token/);
  });

  it('rejects non-POST HTTP methods (405) and malformed JSON payloads (400)', async () => {
    const { bot } = createTestBotWithCapture();

    const getRes = await processTelegramWebhookRequest(
      {
        method: 'GET',
        headers: { 'x-telegram-bot-api-secret-token': VALID_SECRET },
        body: '',
      },
      { bot, secretToken: VALID_SECRET }
    );
    assert.equal(getRes.statusCode, 405);

    const badJsonRes = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': VALID_SECRET },
        body: '{invalid-json',
      },
      { bot, secretToken: VALID_SECRET }
    );
    assert.equal(badJsonRes.statusCode, 400);
  });

  it('routes verified Fetch POST webhook requests through bot middleware & enforces rate limit end-to-end', async () => {
    const { bot, sentMessages } = createTestBotWithCapture(1, 10000);

    const req1 = new Request('http://localhost:3000/api/bot/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': VALID_SECRET,
      },
      body: JSON.stringify(makeHelpCommandUpdate(4001, 99001)),
    });

    const req2 = new Request('http://localhost:3000/api/bot/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': VALID_SECRET,
      },
      body: JSON.stringify(makeHelpCommandUpdate(4002, 99001)),
    });

    const res1 = await handleTelegramWebhookFetch(req1, { bot, secretToken: VALID_SECRET });
    const res2 = await handleTelegramWebhookFetch(req2, { bot, secretToken: VALID_SECRET });

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(sentMessages.length, 2);
    assert.doesNotMatch(sentMessages[0].text, /Rate limit exceeded/);
    assert.match(sentMessages[1].text, /Rate limit exceeded/);
  });

  it('serves standalone HTTP webhook requests cleanly and rejects unauthorized callers over HTTP', async () => {
    const { bot, sentMessages } = createTestBotWithCapture(2, 10000);
    const server = createWebhookHttpServer({ bot, secretToken: VALID_SECRET });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}/api/bot/webhook`;

    try {
      const unauth = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeHelpCommandUpdate(5001, 66001)),
      });
      assert.equal(unauth.status, 403);
      assert.equal(sentMessages.length, 0);

      const auth = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': VALID_SECRET,
        },
        body: JSON.stringify(makeHelpCommandUpdate(5002, 66001)),
      });
      assert.equal(auth.status, 200);
      assert.equal(sentMessages.length, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
