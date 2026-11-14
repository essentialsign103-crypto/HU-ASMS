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
import { repCreateCourseConversation } from './conversations/rep-course.conversation.js';
import { repCreateProjectConversation } from './conversations/rep-project.conversation.js';
import { repManageGroupsConversation } from './conversations/rep-group.conversation.js';
import { handleStartCommand } from './commands/start.js';
import { handleProfileCommand } from './commands/profile.js';
import { handleCorrectionCommand } from './commands/correction.js';
import { handleHelpCommand } from './commands/help.js';
import {
  // Existing rep handlers (still used for backward compat callbacks)
  handleViewProjects,
  handleSubmissionReports,
  handleRepViewGroups,
  handleRepForwardToTeacher,
  handleRepDeliveryHistory,
  renderProjectReport,
  displaySectionRoster,
} from './handlers/representative.handler.js';
import {
  // New core-workflow rep handlers
  handleRepMyCourses,
  handleRepCollectSubmissions,
  handleRepMySections,
  handleRepViewAllStudents,
  handleCourseOfferingProjects,
} from './handlers/rep-academic.handler.js';
import {
  handleStudentMyProjects,
  handleStudentMyCourses,
  handleStudentCourseAssignments,
  handleStudentSubmissionHistory,
  handleProjectDetailsCallback,
} from './handlers/student.project.handler.js';
import {
  handleMyGroups,
  handleMembershipAction,
} from './handlers/group.handler.js';
import { decodeReportCallback } from './utils/callback-codec.js';
import { getRepresentativeMainMenuKeyboard } from './keyboards/main-menu.js';
import { DatabaseService } from '@hu-asms/database';
import { RepresentativeService } from './services/representative.service.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { isPrivateTelegramChat, requirePrivateChat } from './utils/chat-guard.js';

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

  // 2. Conversation Plugin & Global Escape Hatch (/cancel must precede createConversation)
  bot.use(conversations());
  bot.command('cancel', async (ctx) => {
    const active = await ctx.conversation.active();
    const hasActive = Object.keys(active).length > 0;
    await ctx.conversation.exit();
    await ctx.reply(
      hasActive
        ? '❌ *Cancelled.* Your active operation has been closed.\n\nUse /start or select a menu action whenever you are ready.'
        : 'ℹ️ No active operation to cancel. Use /start to view your menu.',
      { parse_mode: 'Markdown' }
    );
  });
  bot.use(createConversation(registrationConversation));
  bot.use(createConversation(correctionConversation));
  bot.use(createConversation(individualSubmissionConversation));
  bot.use(createConversation(groupSubmissionConversation));
  // Phase B/D: Representative academic operation conversations
  bot.use(createConversation(repCreateCourseConversation));
  bot.use(createConversation(repCreateProjectConversation));
  bot.use(createConversation(repManageGroupsConversation));

  // 3. Command Handlers
  bot.command('start', handleStartCommand);
  bot.command('profile', handleProfileCommand);
  bot.command('correction', handleCorrectionCommand);
  bot.command('help', handleHelpCommand);
  bot.command('support', handleHelpCommand);
  bot.command('submit', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'assignment submission'))) return;
    await ctx.conversation.enter('individualSubmissionConversation');
  });
  bot.command('submit_group', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'group submission'))) return;
    await ctx.conversation.enter('groupSubmissionConversation');
  });
  bot.command('reports', handleSubmissionReports);

  // 4a. Student Quick Action Button Listeners
  bot.hears('👤 My Profile', handleProfileCommand);
  // Legacy alias kept for sessions that still have the old keyboard cached
  bot.hears('📚 My Academic Information', handleProfileCommand);
  bot.hears('❓ Help & Support', handleHelpCommand);
  // New core-workflow student buttons
  bot.hears('📚 My Courses', handleStudentMyCourses);
  bot.hears('📋 My Assignments', handleStudentMyProjects);
  // Legacy alias for sessions that still have old keyboard
  bot.hears('📋 My Projects', handleStudentMyProjects);
  bot.hears('👥 My Groups', handleMyGroups);
  bot.hears('📜 Submission History', handleStudentSubmissionHistory);
  bot.command('groups', handleMyGroups);
  bot.hears('📤 Submit Assignment', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'assignment submission'))) return;
    await ctx.conversation.enter('individualSubmissionConversation');
  });
  bot.hears(['🚀 Submit Group Project', '👥 Submit Group Assignment'], async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'group submission'))) return;
    await ctx.conversation.enter('groupSubmissionConversation');
  });

  // 4b. Representative Quick Action Buttons (new core-workflow menu)
  // NOTE: '📚 My Courses' is shared with students — the student handler above fires for all users.
  // Representatives entering the rep portal see the rep keyboard which also has '📚 My Courses'
  // pointing to their course listings via the same button text; handleStudentMyCourses gracefully
  // handles both roles since it queries the section from the authenticated student record.
  bot.hears('➕ Create Course', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'course creation'))) return;
    await ctx.conversation.enter('repCreateCourseConversation');
  });
  bot.hears('📝 Create Assignment', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'assignment creation'))) return;
    await ctx.conversation.enter('repCreateProjectConversation');
  });
  bot.hears('👥 Manage Groups', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'group management'))) return;
    await ctx.conversation.enter('repManageGroupsConversation');
  });
  bot.hears('📥 Collect Submissions', handleRepCollectSubmissions);
  bot.hears('📊 Submission Reports', handleSubmissionReports);
  bot.hears('📦 Forward to Teacher', handleRepForwardToTeacher);
  bot.hears('📜 Delivery History', handleRepDeliveryHistory);
  bot.hears('👥 View All Students', handleRepViewAllStudents);
  bot.hears('🏢 My Sections', handleRepMySections);
  // Legacy rep buttons still present in some cached keyboards
  bot.hears('🏢 My Assigned Sections', handleRepMySections);
  bot.hears('📂 View All Projects', handleViewProjects);
  bot.hears('👥 View Groups', handleRepViewGroups);
  bot.hears(['🏠 Back to Main Menu', '🎓 Student Menu'], handleStartCommand);

  // Unified Mode Switcher: Enter Representative Operations Portal
  bot.hears('⭐ Representative Operations', async (ctx) => {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;
    const db = new DatabaseService(getSupabaseAdminClient());
    const repData = await db.findRepresentativeByTelegramId(telegramUserId);
    if (!repData || repData.assignments.length === 0) {
      await ctx.reply('⚠️ *Access Denied*\n\nYou do not have active section representative permissions.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    await ctx.reply(
      `⭐ *Representative Operations Portal*\n\n` +
        `You are authorized for *${repData.assignments.length}* academic section(s).\n` +
        `Select a representative capability below:`,
      {
        parse_mode: 'Markdown',
        reply_markup: getRepresentativeMainMenuKeyboard(),
      }
    );
  });

  // 4c. Callback Queries
  bot.callbackQuery(/^grp_confirm_/, async (ctx) => {
    const groupId = ctx.callbackQuery.data.replace('grp_confirm_', '');
    await handleMembershipAction(ctx, groupId, 'confirmed');
  });

  bot.callbackQuery(/^grp_decline_/, async (ctx) => {
    const groupId = ctx.callbackQuery.data.replace('grp_decline_', '');
    await handleMembershipAction(ctx, groupId, 'declined');
  });

  bot.callbackQuery(/^view_proj_/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required to view project details.', show_alert: true });
      await requirePrivateChat(ctx, 'project details');
      return;
    }
    const projectId = ctx.callbackQuery.data.replace('view_proj_', '');
    await ctx.answerCallbackQuery();
    await handleProjectDetailsCallback(ctx, projectId);
  });

  bot.callbackQuery(/^rep_roster_/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required to view section rosters.', show_alert: true });
      await requirePrivateChat(ctx, 'section student rosters');
      return;
    }
    const sectionId = ctx.callbackQuery.data.replace('rep_roster_', '');
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;
    await ctx.answerCallbackQuery();
    const supabase = getSupabaseAdminClient();
    const repService = new RepresentativeService(supabase);
    await displaySectionRoster(ctx, repService, telegramUserId, sectionId, 'Selected Section');
  });

  // Representative course offering projects (rep My Courses drill-down)
  bot.callbackQuery(/^cso_proj_/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    // Format: cso_proj_<offeringId(36)>_<sectionId(36)>
    const raw = ctx.callbackQuery.data.replace('cso_proj_', '');
    const offeringId = raw.substring(0, 36);
    const sectionId = raw.substring(37);
    if (!offeringId || !sectionId) {
      await ctx.answerCallbackQuery({ text: 'Invalid request.', show_alert: true });
      return;
    }
    await handleCourseOfferingProjects(ctx, offeringId, sectionId);
  });

  // Student course drill-down: stu_cso_<offeringId>_<sectionId>
  bot.callbackQuery(/^stu_cso_/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const raw = ctx.callbackQuery.data.replace('stu_cso_', '');
    const offeringId = raw.substring(0, 36);
    const sectionId = raw.substring(37);
    if (!offeringId || !sectionId) {
      await ctx.answerCallbackQuery({ text: 'Invalid request.', show_alert: true });
      return;
    }
    await handleStudentCourseAssignments(ctx, offeringId, sectionId);
  });

  bot.callbackQuery(/^(rr:|rep_report_)/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required to view submission reports.', show_alert: true });
      await requirePrivateChat(ctx, 'submission reports');
      return;
    }
    const decoded = decodeReportCallback(ctx.callbackQuery.data);
    if (!decoded) {
      await ctx.answerCallbackQuery({ text: 'Invalid report request.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderProjectReport(ctx, decoded.sectionId, decoded.projectId);
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
