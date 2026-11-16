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
import { repAnnouncementConversation } from './conversations/rep-announcement.conversation.js';
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
  // 15-Workflow Representative Operations Center
  handleRepDashboard,
  handleRepAssignedSections,
  handleRepMyStudents,
  handleRepMyProjects,
  handleRepIncomingSubmissions,
  handleRepSubmittedStudents,
  handleRepSubmittedStudentsProject,
  handleRepNotSubmittedStudents,
  handleRepMissingStudentsProject,
  handleRepIndividualAssignments,
  handleRepGroupAssignments,
  handleRepTeacherDelivery,
  handleRepTeacherDeliveryProject,
  handleRepPrepareDeliveryBatch,
  handleRepDispatchDelivery,
  handleRepAcknowledgeDelivery,
  handleRepViewDeliveryManifest,
  handleRepDeliveryHistory as handleRepDeliveryHistoryOps,
  handleRepAcademicReports,
  handleRepSwitchActiveScope,
  handleRepSwitchScopeCallback,
  handleRepHelpSupport,
  handleRepReturnToStudentMenu,
} from './handlers/rep-operations.handler.js';
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
import { decodeReportCallback, base64UrlToUuid } from './utils/callback-codec.js';
import {
  getRepresentativeMainMenuKeyboard,
  getRepresentativeOperationsCenterKeyboard,
} from './keyboards/main-menu.js';
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
    console.warn(
      '[HU-ASMS Bot] Persistent Supabase session storage unavailable. ' +
        'Falling back to in-memory sessions (conversations will not persist across cold starts). ' +
        'Configure SUPABASE_SERVICE_ROLE_KEY for durable sessions.'
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
  bot.use(createConversation(repAnnouncementConversation));

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

  // 4b. Representative Operations Center (15 Core Workflows)
  bot.hears('📊 Operations Dashboard', handleRepDashboard);
  bot.hears('🏢 My Assigned Sections', handleRepAssignedSections);
  bot.hears('👥 My Students', (ctx) => handleRepMyStudents(ctx, 1));
  bot.hears('📂 My Projects', handleRepMyProjects);
  bot.hears('📥 Incoming Submissions', handleRepIncomingSubmissions);
  bot.hears('📊 Academic Reports', handleRepAcademicReports);
  bot.hears('👤 Individual Assignments', handleRepIndividualAssignments);
  bot.hears('👥 Group Assignments', handleRepGroupAssignments);
  bot.hears('✅ Submitted Students', handleRepSubmittedStudents);
  bot.hears('❌ Not Submitted Students', handleRepNotSubmittedStudents);
  bot.hears('📦 Teacher Delivery', handleRepTeacherDelivery);
  bot.hears('📜 Delivery History', handleRepDeliveryHistoryOps);
  bot.hears('🔄 Switch Active Scope', handleRepSwitchActiveScope);
  bot.hears('❓ Help and Support', handleRepHelpSupport);
  bot.hears(['🎓 Return to Student Menu', '🏠 Back to Main Menu', '🎓 Student Menu'], handleRepReturnToStudentMenu);

  // Backward compatibility aliases for existing keyboards
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
  bot.hears('📥 Collect Submissions', handleRepIncomingSubmissions);
  bot.hears('📊 Submission Reports', handleRepAcademicReports);
  bot.hears('📦 Forward to Teacher', handleRepTeacherDelivery);
  bot.hears('📢 Post Announcement', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'announcement posting'))) return;
    await ctx.conversation.enter('repAnnouncementConversation');
  });
  bot.hears('📋 Announcement History', async (ctx) => {
    if (!(await requirePrivateChat(ctx, 'announcement history'))) return;
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) return;
    const supabase = getSupabaseAdminClient();
    const { AnnouncementService } = await import('./services/announcement.service.js');
    const repService = new RepresentativeService(supabase);
    const repData = await repService.getRepresentativeProfile(telegramUserId);
    if (!repData || repData.assignments.length === 0) {
      await ctx.reply('⚠️ You do not have any active section assignments.');
      return;
    }
    const sectionId = repData.assignments[0].section_id;
    const secName = `${repData.assignments[0].section?.academic_year?.name || ''} — ${repData.assignments[0].section?.name || ''}`;
    try {
      const annService = new AnnouncementService(supabase);
      const { announcements, total } = await annService.getAnnouncementHistory(telegramUserId, sectionId, 1, 10);
      if (announcements.length === 0) {
        await ctx.reply(`📋 *Announcement History*\nSection: *${secName}*\n\nNo announcements yet.`, { parse_mode: 'Markdown' });
        return;
      }
      let text = `📋 *Announcement History (${total})*\nSection: *${secName}*\n───────────────────────────\n\n`;
      announcements.forEach((ann: any, idx: number) => {
        const stats = ann.recipient_stats || {};
        const proj = ann.project?.title ? ` | 📂 ${ann.project.title.substring(0, 20)}` : '';
        text += `${idx + 1}. ${ann.body.substring(0, 60)}${ann.body.length > 60 ? '…' : ''}${proj}\n`;
        text += `   ✅ ${stats.sent || 0} / ⏳ ${stats.pending || 0} / ❌ ${stats.failed || 0}${ann.pdf_filename ? ' | 📎' : ''}\n\n`;
      });
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await ctx.reply(`❌ Failed to load announcement history: ${err.message}`);
    }
  });
  bot.hears('👥 View All Students', (ctx) => handleRepMyStudents(ctx, 1));
  bot.hears('🏢 My Sections', handleRepAssignedSections);
  bot.hears('📂 View All Projects', handleViewProjects);
  bot.hears('👥 View Groups', handleRepViewGroups);

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
        reply_markup: getRepresentativeOperationsCenterKeyboard(),
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

  // 4d. Representative Operations Center Callback Handlers (Compact Base64URL routes)
  bot.callbackQuery(/^ro_st:(\d+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_st:(\d+):([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const page = parseInt(match[1], 10);
    const sectionId = base64UrlToUuid(match[2]);
    await ctx.answerCallbackQuery();
    await handleRepMyStudents(ctx, page, sectionId);
  });

  bot.callbackQuery(/^ro_sc:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_sc:([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const sectionId = base64UrlToUuid(match[1]);
    await handleRepSwitchScopeCallback(ctx, sectionId);
  });

  bot.callbackQuery(/^ro_sub:(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_sub:(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const page = parseInt(match[1], 10);
    const sectionId = base64UrlToUuid(match[2]);
    const projectId = base64UrlToUuid(match[3]);
    await ctx.answerCallbackQuery();
    await handleRepSubmittedStudentsProject(ctx, sectionId, projectId, page);
  });

  bot.callbackQuery(/^ro_mis:(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_mis:(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const page = parseInt(match[1], 10);
    const sectionId = base64UrlToUuid(match[2]);
    const projectId = base64UrlToUuid(match[3]);
    await ctx.answerCallbackQuery();
    await handleRepMissingStudentsProject(ctx, sectionId, projectId, page);
  });

  bot.callbackQuery(/^ro_del:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_del:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const sectionId = base64UrlToUuid(match[1]);
    const projectId = base64UrlToUuid(match[2]);
    await ctx.answerCallbackQuery();
    await handleRepTeacherDeliveryProject(ctx, sectionId, projectId);
  });

  bot.callbackQuery(/^ro_d_prep:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_d_prep:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const sectionId = base64UrlToUuid(match[1]);
    const projectId = base64UrlToUuid(match[2]);
    await ctx.answerCallbackQuery();
    await handleRepPrepareDeliveryBatch(ctx, sectionId, projectId);
  });

  bot.callbackQuery(/^ro_d_sent:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_d_sent:([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const deliveryId = base64UrlToUuid(match[1]);
    await ctx.answerCallbackQuery();
    await handleRepDispatchDelivery(ctx, deliveryId);
  });

  bot.callbackQuery(/^ro_d_ack:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_d_ack:([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const deliveryId = base64UrlToUuid(match[1]);
    await ctx.answerCallbackQuery();
    await handleRepAcknowledgeDelivery(ctx, deliveryId);
  });

  bot.callbackQuery(/^ro_d_man:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isPrivateTelegramChat(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Private chat required.', show_alert: true });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ro_d_man:([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const deliveryId = base64UrlToUuid(match[1]);
    await ctx.answerCallbackQuery();
    await handleRepViewDeliveryManifest(ctx, deliveryId);
  });

  bot.callbackQuery(/^ro_pjs:([A-Za-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRepMyProjects(ctx);
  });

  bot.callbackQuery(/^ro_rep:([A-Za-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRepAcademicReports(ctx);
  });

  bot.callbackQuery(/^ro_del_lst:([A-Za-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRepDeliveryHistoryOps(ctx);
  });

  bot.callbackQuery(/^ro_sc_menu$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRepSwitchActiveScope(ctx);
  });

  bot.callbackQuery(/^ro_noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
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
