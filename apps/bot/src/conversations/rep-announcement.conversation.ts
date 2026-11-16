// HU-ASMS: Representative Announcement Conversation (Issue 3 — Announcement Center)
// Flow: select section → optional project → write text → optional PDF → preview → confirm → dispatch
// Authorization: verified via RepresentativeService.assertSectionScope at every step.

import { InlineKeyboard } from 'grammy';
import type { BotConversation, BotContext } from '../types/context.js';
import { getSupabaseAdminClient } from '@hu-asms/database';
import { RepresentativeService } from '../services/representative.service.js';
import { AnnouncementService } from '../services/announcement.service.js';
import { RepresentativeReportingService } from '../services/representative-reporting.service.js';
import { downloadTelegramDocument } from '../utils/telegram-file.js';
import { requirePrivateChat } from '../utils/chat-guard.js';
import { getRepresentativeMainMenuKeyboard } from '../keyboards/main-menu.js';

export async function repAnnouncementConversation(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  if (!(await requirePrivateChat(ctx, 'announcement creation'))) return;

  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply('Error: Could not identify your Telegram account.');
    return;
  }

  const supabase = getSupabaseAdminClient();
  const repService = new RepresentativeService(supabase);

  // 1. Resolve representative
  const repData = await conversation.external(() =>
    repService.getRepresentativeProfile(telegramUserId)
  );

  if (!repData || repData.assignments.length === 0) {
    await ctx.reply('⚠️ You do not have any active section assignments.');
    return;
  }

  // 2. Select section
  let selectedSectionId: string;
  let selectedSectionName: string;
  let selectedAcademicYearId: string;

  if (repData.assignments.length === 1) {
    const a = repData.assignments[0];
    selectedSectionId = a.section_id;
    selectedAcademicYearId = a.section?.academic_year_id || '';
    selectedSectionName = `${a.section?.academic_year?.name || ''} — ${a.section?.name || ''}`;
  } else {
    const keyboard = new InlineKeyboard();
    repData.assignments.forEach((a) => {
      keyboard.text(
        `${a.section?.academic_year?.name || ''} — ${a.section?.name || a.section_id}`,
        `ann_sec_${a.section_id}`
      ).row();
    });

    await ctx.reply('📢 *Post Announcement*\n\nSelect a section:', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    const secCb = await conversation.waitForCallbackQuery(/^ann_sec_/);
    selectedSectionId = secCb.callbackQuery.data.replace('ann_sec_', '');
    const a = repData.assignments.find((x) => x.section_id === selectedSectionId);
    selectedAcademicYearId = a?.section?.academic_year_id || '';
    selectedSectionName = `${a?.section?.academic_year?.name || ''} — ${a?.section?.name || ''}`;
    await secCb.answerCallbackQuery({ text: selectedSectionName });
  }

  // 3. Optional: select project (for project-specific announcements)
  const projectKeyboard = new InlineKeyboard()
    .text('📝 General Section Announcement', 'ann_proj_none')
    .row();

  // Fetch projects for this section
  const projects = await conversation.external(() =>
    repService.getSectionProjects(telegramUserId, selectedSectionId)
  );

  projects.slice(0, 6).forEach((p) => {
    projectKeyboard.text(`📂 ${p.title.substring(0, 30)}`, `ann_proj_${p.id}`).row();
  });

  await ctx.reply(
    `📢 *Post Announcement*\nSection: *${selectedSectionName}*\n\nIs this a general section announcement or for a specific project?`,
    { parse_mode: 'Markdown', reply_markup: projectKeyboard }
  );

  const projCb = await conversation.waitForCallbackQuery(/^ann_proj_/);
  let selectedProjectId: string | null = null;
  if (projCb.callbackQuery.data !== 'ann_proj_none') {
    selectedProjectId = projCb.callbackQuery.data.replace('ann_proj_', '');
  }
  await projCb.answerCallbackQuery();

  // 4. Write announcement title
  await ctx.reply(
    `📝 *Announcement Title*\n\nEnter a short title (3–200 characters):`,
    { parse_mode: 'Markdown' }
  );

  const titleMsg = await conversation.waitFor(':text');
  const announcementTitle = titleMsg.message?.text?.trim() || '';
  if (announcementTitle.length < 3 || announcementTitle.length > 200) {
    await ctx.reply('❌ Title must be 3–200 characters. Please restart.');
    return;
  }

  // 5. Write announcement content
  await ctx.reply(
    `📝 *Write Your Announcement*\n\nType the content (5–4000 characters).\nSend \`-\` to skip text and attach a PDF only.`,
    { parse_mode: 'Markdown' }
  );

  const textMsg = await conversation.waitFor(':text');
  let announcementBody = textMsg.message?.text?.trim() || '';
  if (announcementBody === '-') {
    announcementBody = ''; // Text optional, PDF required
  }

  if (announcementBody.length > 0 && announcementBody.length < 5) {
    await ctx.reply('❌ Announcement text too short. Please restart.');
    return;
  }

  if (announcementBody.length > 4000) {
    await ctx.reply('❌ Announcement text exceeds 4000 characters. Please shorten and restart.');
    return;
  }

  // 5. Optional: attach PDF
  let pdfBuffer: Buffer | undefined;
  let pdfFilename: string | undefined;
  let pdfSize: number | undefined;
  let pdfMime: string | undefined;

  if (announcementBody.length === 0 || announcementBody.length > 0) {
    const attachKeyboard = new InlineKeyboard()
      .text('📎 Attach PDF', 'ann_attach')
      .text('✅ Text Only', 'ann_skip_pdf');

    await ctx.reply(
      `Would you like to attach a PDF file?\n${announcementBody.length === 0 ? '(Required — you skipped text)' : '(Optional)'}`,
      { reply_markup: attachKeyboard }
    );

    const attachCb = await conversation.waitForCallbackQuery(['ann_attach', 'ann_skip_pdf']);
    await attachCb.answerCallbackQuery();

    if (attachCb.callbackQuery.data === 'ann_attach') {
      await ctx.reply(
        '📎 *Send your PDF file now*\n\nAttach it as a File / Document (not a photo).',
        { parse_mode: 'Markdown' }
      );

      const docMsg = await conversation.waitFor(':document');
      const doc = docMsg.message?.document;
      if (!doc) {
        await ctx.reply('❌ No document received. Please restart.');
        return;
      }

      pdfFilename = doc.file_name || 'announcement.pdf';
      pdfMime = doc.mime_type || 'application/pdf';
      pdfSize = doc.file_size || 0;

      try {
        const downloaded = await conversation.external(() =>
          downloadTelegramDocument({
            api: ctx.api,
            fileId: doc.file_id,
            maxSizeBytes: 20 * 1024 * 1024,
            declaredSizeBytes: pdfSize,
          })
        );
        pdfBuffer = downloaded.buffer;
        pdfSize = downloaded.sizeBytes;
      } catch (err: any) {
        await ctx.reply(`❌ Failed to download PDF: ${err.message}`);
        return;
      }
    } else if (announcementBody.length === 0) {
      await ctx.reply('❌ You must either provide text or attach a PDF. Please restart.');
      return;
    }
  }

  // 7. Preview
  let preview = `📋 *Announcement Preview*\n───────────────────────────\n`;
  preview += `• *Title:* ${announcementTitle}\n`;
  preview += `• *Section:* ${selectedSectionName}\n`;
  if (selectedProjectId) {
    const proj = projects.find((p) => p.id === selectedProjectId);
    preview += `• *Project:* ${proj?.title || 'N/A'}\n`;
  }
  preview += `• *Content:* ${announcementBody.length > 0 ? '_' + announcementBody.substring(0, 200) + (announcementBody.length > 200 ? '...' : '') + '_' : '(None — PDF only)'}\n`;
  if (pdfFilename) {
    preview += `• *PDF:* \`${pdfFilename}\` (${pdfSize ? (pdfSize / 1024).toFixed(0) + ' KB' : 'Unknown'})\n`;
  }
  preview += `\nPublish to all eligible students in *${selectedSectionName}*?`;

  const confirmKeyboard = new InlineKeyboard()
    .text('✅ Confirm & Publish', 'ann_confirm')
    .text('❌ Cancel', 'ann_cancel');

  await ctx.reply(preview, { parse_mode: 'Markdown', reply_markup: confirmKeyboard });

  const confirmCb = await conversation.waitForCallbackQuery(['ann_confirm', 'ann_cancel']);
  if (confirmCb.callbackQuery.data === 'ann_cancel') {
    await confirmCb.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.reply('Announcement cancelled.', { reply_markup: getRepresentativeMainMenuKeyboard() });
    return;
  }

  // 7. Create and dispatch
  await confirmCb.answerCallbackQuery({ text: 'Publishing...' });

  try {
    const annService = new AnnouncementService(supabase);
    const result = await conversation.external(() =>
      annService.createAndDispatch(telegramUserId, repData.profile.id, {
        sectionId: selectedSectionId,
        academicYearId: selectedAcademicYearId,
        projectId: selectedProjectId,
        title: announcementTitle,
        content: announcementBody || '(See attached PDF)',
        pdfBuffer,
        pdfFilename,
        pdfMimeType: pdfMime,
        pdfSizeBytes: pdfSize,
      })
    );

    if (result.success) {
      await ctx.reply(
        `✅ *Announcement Published!*\n\n` +
          `• Delivered to: *${result.dispatchedCount}* student(s)\n` +
          `${result.failedCount ? `• Failed: *${result.failedCount}* (can retry)\n` : ''}` +
          `• Announcement ID: \`${result.announcementId?.substring(0, 8)}...\`\n\n` +
          `Use *📢 Announcement History* to view delivery status.`,
        { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
      );
    } else {
      await ctx.reply(
        `❌ *Failed to publish announcement:*\n${result.error}`,
        { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
      );
    }
  } catch (err: any) {
    await ctx.reply(
      `❌ *Announcement error:*\n${err instanceof Error ? err.message : String(err)}`,
      { parse_mode: 'Markdown', reply_markup: getRepresentativeMainMenuKeyboard() }
    );
  }
}
