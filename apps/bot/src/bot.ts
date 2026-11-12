// HU-ASMS: Telegram Bot Core Setup (grammY)
import { Bot, session, type StorageAdapter } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { BotContext, SessionData } from './types/context.js';
import {
  createRateLimiterMiddleware,
  type RateLimitOptions,
} from './middleware/rate-limit.middleware.js';
import {
  PersistentMemorySessionStorage,
  SupabaseSessionStorage,
} from './storage/supabase-session-storage.js';
import { sanitizeLogData } from './utils/error-handler.js';
import { registrationConversation } from './conversations/registration.conversation.js';
import { correctionConversation } from './conversations/correction.conversation.js';
import { individualSubmissionConversation } from './conversations/submission.conversation.js';
import { groupSubmissionConversation } from './conversations/group-submission.conversation.js';
import { handleStartCommand } from './commands/start.js';
import { handleProfileCommand } from './commands/profile.js';
import { handleCorrectionCommand } from './commands/correction.js';
import { handleHelpCommand } from './commands/help.js';
import {
  handleAssignedSections,
  handleViewStudents,
  handleViewProjects,
  handleSubmissionReports,
  renderProjectReport,
  displaySectionRoster,
} from './handlers/representative.handler.js';
import {
  handleStudentMyProjects,
  handleProjectDetailsCallback,
} from './handlers/student.project.handler.js';
import {
  handleMyGroups,
  handleMembershipAction,
} from './handlers/group.handler.js';
import { RepresentativeService } from './services/representative.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { requirePrivateChat } from './utils/chat-guard.js';

/**
 * Isolates grammY session & conversation state per user even inside shared group chats.
 * In private chats (`chat.id === from.id`), returns the single Telegram user ID key.
 */
export function resolveBotSessionKey(ctx: {
  chat?: { id?: number };
  from?: { id?: number };
}): string | undefined {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (chatId !== undefined && userId !== undefined) {
    return chatId === userId ? String(userId) : `${chatId}:${userId}`;
  }
  if (userId !== undefined) return String(userId);
  if (chatId !== undefined) return String(chatId);
  return undefined;
}

export interface CreateBotOptions {
  rateLimit?: Partial<RateLimitOptions>;
  botInfo?: UserFromGetMe;
  sessionStorage?: StorageAdapter<SessionData>;
}

function resolveSessionStorage(
  explicitStorage?: StorageAdapter<SessionData>
): StorageAdapter<SessionData> {
  if (explicitStorage) {
    return explicitStorage;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    return new SupabaseSessionStorage(getSupabaseAdminClient());
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Persistent Supabase session storage is required in production. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return new PersistentMemorySessionStorage();
}

export function createBot(token?: string, options?: CreateBotOptions): Bot<BotContext> {
  const botToken = token || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to initialize the Telegram bot.');
  }

  const bot = new Bot<BotContext>(
    botToken,
    options?.botInfo ? { botInfo: options.botInfo } : undefined
  );

  // 0. Rate Limiting Middleware (distributed Postgres sliding window in production)
  bot.use(
    createRateLimiterMiddleware({
      windowMs: 10000,
      maxRequests: 10,
      ...options?.rateLimit,
    })
  );

  // 1. Persistent Session Middleware (stores session + @grammyjs/conversations replay state)
  const sessionStorage = resolveSessionStorage(options?.sessionStorage);
  bot.use(
    session({
      initial: (): SessionData => ({}),
      storage: sessionStorage,
      getSessionKey: (ctx) => resolveBotSessionKey(ctx),
    })
  );

  // 2. Conversation Plugin & Registered Conversations
  bot.use(conversations());
  bot.use(createConversation(registrationConversation));
  bot.use(createConversation(correctionConversation));
  bot.use(createConversation(individualSubmissionConversation));
  bot.use(createConversation(groupSubmissionConversation));

  // 3. Command Handlers
  bot.command('start', handleStartCommand);
  bot.command('profile', handleProfileCommand);
  bot.command('correction', handleCorrectionCommand);
  bot.command('help', handleHelpCommand);
  bot.command('submit', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'assignment submission'))) return;
    await ctx.conversation.enter('individualSubmissionConversation');
  });
  bot.command('submit_group', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'group submission'))) return;
    await ctx.conversation.enter('groupSubmissionConversation');
  });
  bot.command('reports', handleSubmissionReports);

  // 4. Quick Action Button Listeners (Matching Custom Keyboards)
  bot.hears(['👤 My Profile', '📚 My Academic Information'], handleProfileCommand);
  bot.hears('❓ Help & Support', handleHelpCommand);
  bot.hears('📋 My Projects', handleStudentMyProjects);
  bot.hears(['👥 My Groups', '👥 View Groups'], handleMyGroups);
  bot.command('groups', handleMyGroups);
  bot.hears('📤 Submit Assignment', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'assignment submission'))) return;
    await ctx.conversation.enter('individualSubmissionConversation');
  });
  bot.hears(['🚀 Submit Group Project', '👥 Submit Group Assignment'], async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'group submission'))) return;
    await ctx.conversation.enter('groupSubmissionConversation');
  });

  // Representative Quick Action Buttons
  bot.hears('🏢 My Assigned Sections', handleAssignedSections);
  bot.hears('👥 View All Students', handleViewStudents);
  bot.hears('📂 View All Projects', handleViewProjects);
  bot.hears('📊 Submission Reports', handleSubmissionReports);

  // Representative Callback Queries
  bot.callbackQuery(/^grp_confirm_/, async (ctx) => {
    const groupId = ctx.callbackQuery.data.replace('grp_confirm_', '');
    await handleMembershipAction(ctx, groupId, 'confirmed');
  });

  bot.callbackQuery(/^grp_decline_/, async (ctx) => {
    const groupId = ctx.callbackQuery.data.replace('grp_decline_', '');
    await handleMembershipAction(ctx, groupId, 'declined');
  });

  bot.callbackQuery(/^view_proj_/, async (ctx) => {
    const projectId = ctx.callbackQuery.data.replace('view_proj_', '');
    await ctx.answerCallbackQuery();
    await handleProjectDetailsCallback(ctx, projectId);
  });

  bot.callbackQuery(/^rep_roster_/, async (ctx) => {
    const sectionId = ctx.callbackQuery.data.replace('rep_roster_', '');
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;

    await ctx.answerCallbackQuery();
    const supabase = getSupabaseAdminClient();
    const repService = new RepresentativeService(supabase);
    await displaySectionRoster(ctx, repService, telegramUserId, sectionId, 'Selected Section');
  });

  bot.callbackQuery(/^rep_report_/, async (ctx) => {
    const raw = ctx.callbackQuery.data.replace('rep_report_', '');
    const [sectionId, projectId] = raw.split('_');
    await ctx.answerCallbackQuery();
    await renderProjectReport(ctx, sectionId, projectId);
  });

  // 5. Global Error Boundary (redacted logging to prevent token/secret exposure)
  bot.catch((err) => {
    const ctx = err.ctx;
    const rawError: any = err.error;
    const safeError = sanitizeLogData({
      updateId: ctx?.update?.update_id,
      message: rawError?.message || String(rawError),
      code: rawError?.code,
    });
    console.error('Error while handling Telegram update:', safeError);
  });

  return bot;
}
