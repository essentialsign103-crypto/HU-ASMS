// HU-ASMS: Phase A Remediation Regression Tests
// Verifies menu routing completeness, /cancel escape, compressed-photo upload guidance, and private-chat enforcement.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { Update, UserFromGetMe } from 'grammy/types';

import { createBot } from '../src/bot.js';
import {
  getStudentMainMenuKeyboard,
  getRepresentativeMainMenuKeyboard,
} from '../src/keyboards/main-menu.js';
import { waitForSubmissionDocument } from '../src/utils/submission-conversation-helpers.js';
import { handleStudentMyProjects, handleStudentSubmissionHistory } from '../src/handlers/student.project.handler.js';
import { handleMyGroups, handleMembershipAction } from '../src/handlers/group.handler.js';
import {
  handleAssignedSections,
  handleViewStudents,
  handleViewProjects,
  handleSubmissionReports,
  handleRepViewGroups,
  handleRepForwardToTeacher,
  handleRepDeliveryHistory,
} from '../src/handlers/representative.handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botRoot = path.resolve(__dirname, '..');

const TEST_BOT_INFO: UserFromGetMe = {
  id: 999000222,
  is_bot: true,
  first_name: 'HUASMS Phase A Test Bot',
  username: 'hu_asms_phase_a_bot',
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

function makeBotWithCapture() {
  const sentMessages: Array<{ chatId: number | string; text: string }> = [];
  const answeredCallbacks: Array<{ text?: string; showAlert?: boolean }> = [];

  const bot = createBot('123456:TEST_TOKEN_PHASE_A_ONLY', {
    botInfo: TEST_BOT_INFO,
    rateLimit: { maxRequests: 50, windowMs: 10000 },
  });

  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, any>;
    if (method === 'sendMessage') {
      sentMessages.push({ chatId: p.chat_id, text: String(p.text || '') });
      return {
        ok: true,
        result: {
          message_id: sentMessages.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: 'private', first_name: 'Test' },
          text: p.text,
        } as any,
      };
    }
    if (method === 'answerCallbackQuery') {
      answeredCallbacks.push({ text: p.text, showAlert: p.show_alert });
    }
    return { ok: true, result: true as any };
  });

  return { bot, sentMessages, answeredCallbacks };
}

function makeTextUpdate(
  updateId: number,
  userId: number,
  text: string,
  chatType: 'private' | 'group' = 'private',
  chatId = chatType === 'private' ? userId : -100999
): Update {
  const isCommand = text.startsWith('/');
  const cmdLen = text.split(/\s+/)[0].length;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: chatType, first_name: 'Student' } as any,
      from: { id: userId, is_bot: false, first_name: 'Student' },
      text,
      ...(isCommand ? { entities: [{ offset: 0, length: cmdLen, type: 'bot_command' }] } : {}),
    },
  };
}

function makeCallbackUpdate(
  updateId: number,
  userId: number,
  data: string,
  chatType: 'private' | 'group' = 'private',
  chatId = chatType === 'private' ? userId : -100999
): Update {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb_${updateId}`,
      from: { id: userId, is_bot: false, first_name: 'Student' },
      chat_instance: 'ci_phase_a',
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: chatType, first_name: 'Student' } as any,
        text: 'menu',
      },
    } as any,
  };
}

describe('Phase A — Menu Wiring, /cancel, Photo Guidance & Private-Chat Security', () => {
  it('wires every visible Student and Representative menu button cleanly in bot.ts', () => {
    const studentButtons = getStudentMainMenuKeyboard()
      .build()
      .flat()
      .map((btn: any) => btn.text)
      .filter(Boolean);
    const repButtons = getRepresentativeMainMenuKeyboard()
      .build()
      .flat()
      .map((btn: any) => btn.text)
      .filter(Boolean);

    const botSource = fs.readFileSync(path.join(botRoot, 'src/bot.ts'), 'utf8');

    for (const label of [...studentButtons, ...repButtons]) {
      assert.ok(
        botSource.includes(`'${label}'`),
        `Visible keyboard button "${label}" must be wired in src/bot.ts`
      );
    }

    assert.match(botSource, /bot\.hears\('👥 My Groups',\s*handleMyGroups\)/);
    assert.match(botSource, /bot\.hears\('👥 View Groups',\s*handleRepViewGroups\)/);
    assert.match(botSource, /bot\.command\('cancel'/);
    assert.match(botSource, /bot\.command\('support',\s*handleHelpCommand\)/);
  });

  it('handles /cancel cleanly both when idle and when escaping an active conversation', async () => {
    const { bot, sentMessages } = makeBotWithCapture();
    await bot.handleUpdate(makeTextUpdate(6101, 44101, '/cancel'));
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /No active operation to cancel/i);

    await bot.handleUpdate(makeTextUpdate(6102, 44101, '/support'));
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[1].text, /\/cancel/);

    // Also verify /cancel registered before createConversation exits an active waitFor(':text') loop
    const replies: string[] = [];
    const convBot = new Bot<any>('123456:TEST_TOKEN_CONV_CANCEL', { botInfo: TEST_BOT_INFO });
    convBot.api.config.use(async (_prev, method, payload) => {
      const p = payload as Record<string, any>;
      if (method === 'sendMessage') {
        replies.push(String(p.text || ''));
        return {
          ok: true,
          result: {
            message_id: replies.length,
            date: Math.floor(Date.now() / 1000),
            chat: { id: p.chat_id, type: 'private', first_name: 'Student' },
            text: p.text,
          } as any,
        };
      }
      return { ok: true, result: true as any };
    });

    async function dummyConversation(conversation: any, ctx: any) {
      await ctx.reply('Send your text step:');
      await conversation.waitFor(':text');
      await ctx.reply('SHOULD_NOT_REACH_AFTER_CANCEL');
    }

    convBot.use(session({ initial: () => ({}) }));
    convBot.use(conversations());
    convBot.command('cancel', async (ctx: any) => {
      const active = await ctx.conversation.active();
      assert.ok(Object.keys(active).length > 0);
      await ctx.conversation.exit();
      await ctx.reply('CANCELLED_ACTIVE_CONVERSATION');
    });
    convBot.use(createConversation(dummyConversation));
    convBot.command('begin', async (ctx: any) => {
      await ctx.conversation.enter('dummyConversation');
    });

    await convBot.handleUpdate(makeTextUpdate(6201, 44201, '/begin'));
    await convBot.handleUpdate(makeTextUpdate(6202, 44201, '/cancel'));
    await convBot.handleUpdate(makeTextUpdate(6203, 44201, 'late input'));

    assert.equal(replies.includes('Send your text step:'), true);
    assert.equal(replies.includes('CANCELLED_ACTIVE_CONVERSATION'), true);
    assert.equal(replies.includes('SHOULD_NOT_REACH_AFTER_CANCEL'), false);
  });

  it('guides students when sending a compressed photo or plain text before accepting a document', async () => {
    const replies: string[] = [];
    const uploadedDocs: string[] = [];

    const docBot = new Bot<any>('123456:TEST_TOKEN_DOC_WAIT', { botInfo: TEST_BOT_INFO });
    docBot.api.config.use(async (_prev, method, payload) => {
      const p = payload as Record<string, any>;
      if (method === 'sendMessage') {
        replies.push(String(p.text || ''));
        return {
          ok: true,
          result: {
            message_id: replies.length,
            date: Math.floor(Date.now() / 1000),
            chat: { id: p.chat_id, type: 'private', first_name: 'Student' },
            text: p.text,
          } as any,
        };
      }
      return { ok: true, result: true as any };
    });

    async function uploadFlow(conversation: any, ctx: any) {
      await ctx.reply('Attach file now');
      const doc = await waitForSubmissionDocument(conversation, ctx);
      if (doc) {
        uploadedDocs.push(doc.file_name || 'unnamed');
        await ctx.reply(`ACCEPTED:${doc.file_name}`);
      }
    }

    docBot.use(session({ initial: () => ({}) }));
    docBot.use(conversations());
    docBot.use(createConversation(uploadFlow));
    docBot.command('upload', async (ctx: any) => {
      await ctx.conversation.enter('uploadFlow');
    });

    const userId = 44301;
    await docBot.handleUpdate(makeTextUpdate(7001, userId, '/upload'));

    // Compressed photo update -> receives clear Photo guidance
    await docBot.handleUpdate({
      update_id: 7002,
      message: {
        message_id: 7002,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: 'private', first_name: 'Student' },
        from: { id: userId, is_bot: false, first_name: 'Student' },
        photo: [{ file_id: 'ph1', file_unique_id: 'phu1', width: 800, height: 600 }],
      },
    } as any);

    // Plain text update -> receives Document File Required guidance
    await docBot.handleUpdate(makeTextUpdate(7003, userId, 'here is my assignment'));

    // Valid Document update -> accepted
    await docBot.handleUpdate({
      update_id: 7004,
      message: {
        message_id: 7004,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: 'private', first_name: 'Student' },
        from: { id: userId, is_bot: false, first_name: 'Student' },
        document: {
          file_id: 'doc1',
          file_unique_id: 'docu1',
          file_name: 'lab-report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        },
      },
    } as any);

    assert.match(replies[1], /Compressed Photo Unsupported/);
    assert.match(replies[2], /Document File Required/);
    assert.equal(uploadedDocs[0], 'lab-report.pdf');
    assert.equal(replies.includes('ACCEPTED:lab-report.pdf'), true);
  });

  it('blocks non-private group chat access across sensitive student, group, and representative handlers & callbacks', async () => {
    const groupReplies: string[] = [];
    const callbackAlerts: Array<{ text?: string; show_alert?: boolean }> = [];

    const makeGroupCtx = () =>
      ({
        chat: { id: -100777, type: 'group' },
        from: { id: 55101 },
        reply: async (text: string) => {
          groupReplies.push(text);
        },
        answerCallbackQuery: async (opts: any) => {
          callbackAlerts.push(opts || {});
        },
      }) as any;

    await handleStudentMyProjects(makeGroupCtx());
    await handleStudentSubmissionHistory(makeGroupCtx());
    await handleMyGroups(makeGroupCtx());
    await handleMembershipAction(makeGroupCtx(), 'grp-1', 'confirmed');
    await handleAssignedSections(makeGroupCtx());
    await handleViewStudents(makeGroupCtx());
    await handleViewProjects(makeGroupCtx());
    await handleSubmissionReports(makeGroupCtx());
    await handleRepViewGroups(makeGroupCtx());
    await handleRepForwardToTeacher(makeGroupCtx());
    await handleRepDeliveryHistory(makeGroupCtx());

    assert.equal(groupReplies.length, 11);
    for (const msg of groupReplies) {
      assert.match(msg, /Private Chat Required/);
    }
    assert.equal(callbackAlerts.length, 1);
    assert.equal(callbackAlerts[0].show_alert, true);

    const { bot, sentMessages, answeredCallbacks } = makeBotWithCapture();
    await bot.handleUpdate(makeCallbackUpdate(8001, 55102, 'view_proj_123', 'group'));
    await bot.handleUpdate(makeCallbackUpdate(8002, 55102, 'rep_roster_sec1', 'group'));
    await bot.handleUpdate(makeCallbackUpdate(8003, 55102, 'rep_report_sec1_proj1', 'group'));
    await bot.handleUpdate(makeCallbackUpdate(8004, 55102, 'grp_confirm_grp1', 'group'));
    await bot.handleUpdate(makeCallbackUpdate(8005, 55102, 'grp_decline_grp1', 'group'));

    assert.equal(answeredCallbacks.length, 5);
    assert.equal(sentMessages.length, 5);
    for (const m of sentMessages) {
      assert.match(m.text, /Private Chat Required/);
    }
  });
});
