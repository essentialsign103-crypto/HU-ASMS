// HU-ASMS: Individual Submission Interactive Conversation (Phase 07)
import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { IndividualSubmissionService, SubmissionError } from '../services/submission.service.js';
import { NotificationService } from '../services/notification.service.js';
import { getSupabaseAdminClient, DatabaseService } from '@hu-asms/database';
import { formatDateUTC, formatFileSize, BOT_MESSAGES } from '@hu-asms/shared';

export async function individualSubmissionConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Telegram account cannot be identified.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const db = new DatabaseService(supabase);
  const notificationService = new NotificationService(supabase, (chatId, msg) =>
    ctx.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' })
  );
  const submissionService = new IndividualSubmissionService(supabase, notificationService);

  // 1. Resolve student identity
  const student = await conversation.external(() =>
    db.findStudentByTelegramId(telegramUserId)
  );

  if (!student) {
    await ctx.reply('⚠️ Please register your official student identity first using /start.');
    return;
  }

  if (student.registration_status === 'suspended') {
    await ctx.reply('⛔ Your student account is currently suspended. Submissions are disabled.');
    return;
  }

  // 2. Query eligible open individual projects
  const projects = await conversation.external(() =>
    db.getEligibleProjects(student.academic_year_id, student.section_id)
  );

  const individualProjects = projects.filter(
    (p) => p.submission_type === 'individual' || p.submission_type === 'both'
  );

  if (individualProjects.length === 0) {
    await ctx.reply(
      `📭 *No Active Assignments*\n\n` +
        `There are currently no open individual assignments for *${student.academic_year?.name} — ${student.section?.name}*.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 3. Present project selection inline keyboard
  const keyboard = new InlineKeyboard();
  individualProjects.forEach((proj) => {
    keyboard.text(
      `${proj.title.substring(0, 30)}...`,
      `sub_proj_${proj.id}`
    ).row();
  });
  keyboard.text('❌ Cancel', 'sub_cancel');

  await ctx.reply(
    `📤 *Select Assignment to Submit*\n` +
      `Your Academic Scope: *${student.academic_year?.name} — ${student.section?.name}*\n\n` +
      `Please choose an open assignment:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  const selection = await conversation.waitForCallbackQuery(/^sub_/);
  if (selection.callbackQuery.data === 'sub_cancel') {
    await selection.answerCallbackQuery({ text: 'Submission cancelled' });
    await ctx.reply('Submission process cancelled.');
    return;
  }

  const selectedProjectId = selection.callbackQuery.data.replace('sub_proj_', '');
  const project = individualProjects.find((p) => p.id === selectedProjectId);
  if (!project) {
    await selection.answerCallbackQuery({ text: 'Project not found' });
    await ctx.reply('Project not found or expired.');
    return;
  }
  await selection.answerCallbackQuery();

  // 4. Check existing submission status
  const existingSub = await conversation.external(() =>
    db.getActiveIndividualSubmission(project.id, student.id)
  );

  if (existingSub && !project.resubmission_allowed) {
    await ctx.reply(BOT_MESSAGES.ALREADY_SUBMITTED_INDIVIDUAL(project.title), {
      parse_mode: 'Markdown',
    });
    return;
  }

  const allowedFormats = project.file_rules?.allowed_extensions?.map((e) => `.${e}`).join(', ') || '.pdf';
  const maxSize = project.file_rules?.max_file_size_bytes
    ? formatFileSize(project.file_rules.max_file_size_bytes)
    : '20 MB';

  let promptText =
    `📤 *Upload Assignment File*\n` +
    `───────────────────────────\n` +
    `• *Project:* ${project.title}\n` +
    `• *Course:* ${project.course?.title || 'Academic Course'}\n` +
    `• *Teacher:* ${project.teacher?.full_name || 'Assigned Teacher'}\n` +
    `• *Deadline:* ${formatDateUTC(project.deadline)}\n` +
    `• *Accepted Formats:* \`${allowedFormats}\`\n` +
    `• *Maximum File Size:* ${maxSize}\n`;

  if (existingSub) {
    promptText += `\n⚠️ *Notice:* You already submitted Version ${existingSub.version}. Submitting a new file will create *Version ${existingSub.version + 1}* while preserving your historical submission.\n`;
  }

  promptText += `\n📎 *Please send your document now as a Telegram file attachment:*`;

  await ctx.reply(promptText, { parse_mode: 'Markdown' });

  // 5. Wait for document upload
  const fileMsg = await conversation.waitFor(':document');
  const doc = fileMsg.message?.document;

  if (!doc) {
    await ctx.reply('❌ No valid document received. Please restart via /submit.');
    return;
  }

  const filename = doc.file_name || 'assignment.pdf';
  const mimeType = doc.mime_type || 'application/pdf';
  const fileSize = doc.file_size || 0;

  await ctx.reply('⏳ *Processing and securing your submission...*', { parse_mode: 'Markdown' });

  try {
    const result = await conversation.external(() =>
      submissionService.submitIndividualAssignment({
        telegramUserId,
        projectId: project.id,
        file: {
          originalFilename: filename,
          mimeType,
          sizeBytes: fileSize,
          telegramFileId: doc.file_id,
        },
      })
    );

    const versionLabel = result.isResubmission ? ` (Version ${result.version} - Resubmission)` : '';
    await ctx.reply(
      `🎉 *Submission Successfully Received!*${versionLabel}\n\n` +
        `• *Project:* ${project.title}\n` +
        `• *Section:* ${student.academic_year?.name} — ${student.section?.name}\n` +
        `• *File:* \`${filename}\` (${formatFileSize(fileSize)})\n` +
        `• *Submission Version:* ${result.version}\n` +
        `• *Timestamp:* ${new Date().toUTCString()}\n\n` +
        `✅ Your academic section representative has been automatically notified and will review your materials.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: unknown) {
    if (err instanceof SubmissionError) {
      await ctx.reply(`❌ *Submission Rejected:* ${err.message}`, { parse_mode: 'Markdown' });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ An unexpected error occurred: ${msg}`);
    }
  }
}
