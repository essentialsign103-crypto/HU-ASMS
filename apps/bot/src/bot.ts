// HU-ASMS: Telegram Bot Core Setup (grammY)
import { Bot, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { BotContext, SessionData } from './types/context.js';
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

export function createBot(token?: string): Bot<BotContext> {
  const botToken = token || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to initialize the Telegram bot.');
  }

  const bot = new Bot<BotContext>(botToken);

  // 1. Session Middleware
  bot.use(
    session({
      initial: (): SessionData => ({}),
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
    await ctx.conversation.enter('individualSubmissionConversation');
  });
  bot.command('submit_group', async (ctx) => {
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
    await ctx.conversation.enter('individualSubmissionConversation');
  });
  bot.hears(['🚀 Submit Group Project', '👥 Submit Group Assignment'], async (ctx) => {
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

  // 5. Global Error Boundary
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`, err.error);
  });

  return bot;
}
