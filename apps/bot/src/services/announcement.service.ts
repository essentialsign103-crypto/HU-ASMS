// HU-ASMS: Representative Announcement Service (Issue 3 — Announcement Center)
// Implements section-scoped announcements using the schema defined in
// supabase/migrations/20261115000001_representative_announcements.sql
// Authorization: representative's Telegram ID → active representative_assignment → section_id.

import type { SupabaseClient } from '@hu-asms/database';
import { RepresentativeService } from './representative.service.js';
import { SYSTEM_CONSTANTS } from '@hu-asms/shared';
import { validateSubmissionFile } from '@hu-asms/validation';

export interface CreateAnnouncementInput {
  sectionId: string;
  academicYearId: string;
  projectId?: string | null;
  courseId?: string | null;
  title: string;
  content: string;
  pdfBuffer?: Buffer;
  pdfFilename?: string;
  pdfMimeType?: string;
  pdfSizeBytes?: number;
}

export interface AnnouncementResult {
  success: boolean;
  announcementId?: string;
  dispatchedCount?: number;
  failedCount?: number;
  error?: string;
}

export class AnnouncementService {
  constructor(
    private client: SupabaseClient,
    private botSender?: (chatId: number, message: string) => Promise<unknown>
  ) {}

  /**
   * Creates and dispatches a section announcement.
   * Verifies representative scope before creating. PDF is uploaded to private Storage.
   */
  async createAndDispatch(
    telegramUserId: number,
    representativeProfileId: string,
    input: CreateAnnouncementInput
  ): Promise<AnnouncementResult> {
    // 1. Verify section scope
    const repService = new RepresentativeService(this.client);
    await repService.assertSectionScope(telegramUserId, input.sectionId);

    // 2. Validate fields
    const title = input.title.trim();
    const content = input.content.trim();

    if (title.length < 3 || title.length > 200) {
      return { success: false, error: 'Title must be 3–200 characters.' };
    }
    if (content.length < 5 || content.length > 4000) {
      return { success: false, error: 'Announcement content must be 5–4000 characters.' };
    }

    // 3. Upload PDF if provided
    let attachmentUrl: string | null = null;
    let attachmentFileName: string | null = null;
    let attachmentSize: number | null = null;
    let attachmentMime: string | null = null;

    if (input.pdfBuffer && input.pdfFilename) {
      const fileCheck = validateSubmissionFile({
        filename: input.pdfFilename,
        mimeType: input.pdfMimeType || 'application/pdf',
        sizeBytes: input.pdfSizeBytes || input.pdfBuffer.byteLength,
        allowedExtensions: ['pdf'],
        allowedMimeTypes: ['application/pdf'],
        maxSizeBytes: SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES,
      });

      if (!fileCheck.valid) {
        return { success: false, error: `PDF validation failed: ${fileCheck.error}` };
      }

      const safeName = input.pdfFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `announcements/${Date.now()}_${safeName}`;

      const { error: uploadErr } = await this.client.storage
        .from(SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME)
        .upload(path, input.pdfBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadErr) {
        return { success: false, error: `PDF upload failed: ${uploadErr.message}` };
      }

      attachmentUrl = path;
      attachmentFileName = input.pdfFilename;
      attachmentSize = input.pdfBuffer.byteLength;
      attachmentMime = 'application/pdf';
    }

    // 4. Insert announcement record
    const { data: announcement, error: annErr } = await this.client
      .from('announcements')
      .insert({
        sender_id: representativeProfileId,
        sender_role: 'representative',
        academic_year_id: input.academicYearId,
        section_id: input.sectionId,
        course_id: input.courseId || null,
        project_id: input.projectId || null,
        title,
        content,
        priority: 'normal',
        attachment_url: attachmentUrl,
        attachment_file_name: attachmentFileName,
        attachment_file_size_bytes: attachmentSize,
        attachment_mime_type: attachmentMime,
      })
      .select()
      .single();

    if (annErr || !announcement) {
      if (attachmentUrl) {
        await this.client.storage
          .from(SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME)
          .remove([attachmentUrl])
          .catch(() => {});
      }
      return { success: false, error: annErr?.message || 'Failed to create announcement.' };
    }

    // 5. Get eligible students
    const students = await repService.getSectionStudents(telegramUserId, input.sectionId);
    const eligible = students.filter(
      (s) =>
        (s.registration_status === 'approved' || s.registration_status === 'locked') &&
        s.telegram_user_id
    );

    if (eligible.length === 0) {
      return {
        success: true,
        announcementId: announcement.id,
        dispatchedCount: 0,
        failedCount: 0,
      };
    }

    // 6. Create recipient records
    const recipientPayloads = eligible.map((s) => ({
      announcement_id: announcement.id,
      student_id: s.id,
      status: 'unread',
    }));

    const { error: recipErr } = await this.client
      .from('announcement_recipients')
      .insert(recipientPayloads);

    if (recipErr) {
      console.error('[HU-ASMS Announcement] Recipient creation failed:', recipErr.message);
      return {
        success: true,
        announcementId: announcement.id,
        dispatchedCount: 0,
        failedCount: eligible.length,
      };
    }

    // 7. Dispatch Telegram notifications
    const message = this.buildMessage(title, content, attachmentFileName);
    let dispatched = 0;
    let failed = 0;

    for (const student of eligible) {
      const tgId = student.telegram_user_id!;
      let sendSuccess = false;
      let sendError: string | null = null;

      try {
        if (this.botSender) {
          await this.botSender(tgId, message);
          sendSuccess = true;
        } else {
          const token = process.env.TELEGRAM_BOT_TOKEN;
          if (token) {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: tgId, text: message, parse_mode: 'Markdown' }),
            });
            if (res.ok) {
              sendSuccess = true;
            } else {
              const errData = (await res.json().catch(() => ({}))) as Record<string, any>;
              sendError = errData?.description || `HTTP ${res.status}`;
            }
          } else {
            sendError = 'Bot token not configured';
          }
        }
      } catch (err: any) {
        sendError = err instanceof Error ? err.message : String(err);
      }

      // Update delivery status
      await this.client
        .from('announcement_recipients')
        .update({
          status: sendSuccess ? 'delivered' : 'failed',
          delivered_at: sendSuccess ? new Date().toISOString() : null,
        })
        .eq('announcement_id', announcement.id)
        .eq('student_id', student.id);

      if (sendSuccess) dispatched++;
      else failed++;
    }

    return {
      success: true,
      announcementId: announcement.id,
      dispatchedCount: dispatched,
      failedCount: failed,
    };
  }

  /**
   * Returns announcement history for a section (paginated, newest first).
   */
  async getAnnouncementHistory(
    telegramUserId: number,
    sectionId: string,
    page: number = 1,
    pageSize: number = 10
  ): Promise<{ announcements: any[]; total: number }> {
    const repService = new RepresentativeService(this.client);
    await repService.assertSectionScope(telegramUserId, sectionId);

    const offset = (page - 1) * pageSize;

    const { data, error, count } = await this.client
      .from('announcements')
      .select(
        '*, project:projects(title), section:sections(name, academic_year:academic_years(name))',
        { count: 'exact' }
      )
      .eq('section_id', sectionId)
      .order('sent_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const announcements = data || [];
    for (const ann of announcements) {
      const { data: stats } = await this.client
        .from('announcement_recipients')
        .select('status')
        .eq('announcement_id', ann.id);

      const r = stats || [];
      ann.recipient_stats = {
        total: r.length,
        delivered: r.filter((x: any) => x.status === 'delivered').length,
        unread: r.filter((x: any) => x.status === 'unread').length,
        failed: r.filter((x: any) => x.status === 'failed').length,
      };
    }

    return { announcements, total: count || 0 };
  }

  /**
   * Retries failed deliveries for an announcement (safe to call multiple times).
   */
  async retryFailedDeliveries(
    telegramUserId: number,
    sectionId: string,
    announcementId: string
  ): Promise<{ retried: number; succeeded: number; failed: number }> {
    const repService = new RepresentativeService(this.client);
    await repService.assertSectionScope(telegramUserId, sectionId);

    const { data: ann } = await this.client
      .from('announcements')
      .select('title, content, attachment_file_name, section_id')
      .eq('id', announcementId)
      .eq('section_id', sectionId)
      .maybeSingle();

    if (!ann) throw new Error('Announcement not found or not in your section.');

    const { data: failed } = await this.client
      .from('announcement_recipients')
      .select('id, student_id, telegram_user_id:students!inner(telegram_user_id)')
      .eq('announcement_id', announcementId)
      .eq('status', 'failed');

    if (!failed || failed.length === 0) return { retried: 0, succeeded: 0, failed: 0 };

    const message = this.buildMessage(ann.title, ann.content, ann.attachment_file_name);
    let succeeded = 0;
    let failedCount = 0;

    for (const r of failed) {
      const tgId = (r as any).telegram_user_id?.telegram_user_id;
      if (!tgId) { failedCount++; continue; }

      let ok = false;
      try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tgId, text: message, parse_mode: 'Markdown' }),
          });
          ok = res.ok;
        }
      } catch { ok = false; }

      await this.client
        .from('announcement_recipients')
        .update({ status: ok ? 'delivered' : 'failed', delivered_at: ok ? new Date().toISOString() : null })
        .eq('id', r.id);

      if (ok) succeeded++;
      else failedCount++;
    }

    return { retried: failed.length, succeeded, failed: failedCount };
  }

  private buildMessage(title: string, content: string, attachmentName?: string | null): string {
    const maxContent = 4096 - title.length - 60;
    const truncated = content.length > maxContent
      ? content.substring(0, maxContent) + '…'
      : content;

    return (
      `📢 *Section Announcement*\n` +
      `───────────────────────────\n` +
      `*${title}*\n\n` +
      truncated +
      (attachmentName ? `\n\n📎 Attachment: \`${attachmentName}\`` : '')
    );
  }
}
