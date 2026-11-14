// HU-ASMS: Representative Submission & Registration Notification Service (Phase 05 / Remediation)
import type { SupabaseClient } from '@hu-asms/database';
import { formatFileSize, formatDateUTC } from '@hu-asms/shared';
import type { BotContext } from '../types/context.js';

export interface DispatchNotificationOptions {
  recipientTelegramId: number;
  recipientType: 'student' | 'representative' | 'owner';
  message: string;
  payload?: Record<string, unknown>;
  eventType?: string;
}

export interface NotificationDispatchResult {
  success: boolean;
  notificationId?: string;
  error?: string;
}

export class NotificationService {
  constructor(
    private client: SupabaseClient,
    private botSender?: (chatId: number, message: string) => Promise<unknown>
  ) {}

  /**
   * Internal sender: uses supplied botSender callback or falls back to direct Telegram Bot API fetch.
   */
  private async sendRawTelegram(chatId: number, message: string): Promise<void> {
    if (this.botSender) {
      await this.botSender(chatId, message);
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('Telegram bot token not configured for direct dispatch.');
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(data?.description || `Telegram API error: ${res.statusText}`);
    }
  }

  /**
   * Core idempotent notification dispatch and persistence helper.
   */
  async dispatchNotification(options: DispatchNotificationOptions): Promise<NotificationDispatchResult> {
    let sendSuccess = false;
    let sendError: string | null = null;

    if (this.botSender || process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await this.sendRawTelegram(options.recipientTelegramId, options.message);
        sendSuccess = true;
      } catch (err: any) {
        sendError = err instanceof Error ? err.message : String(err);
        console.error(`Telegram notification delivery failed to ${options.recipientTelegramId}:`, err);
      }
    }

    const payload = {
      ...(options.payload || {}),
      event_type: options.eventType || 'generic',
    };

    const { data, error: insertErr } = await this.client
      .from('notifications')
      .insert({
        recipient_telegram_id: options.recipientTelegramId,
        recipient_type: options.recipientType,
        message: options.message,
        payload,
        status: sendSuccess ? 'sent' : sendError ? 'failed' : 'pending',
        sent_at: sendSuccess ? new Date().toISOString() : null,
        error_message: sendError,
      })
      .select('id')
      .maybeSingle();

    if (insertErr) {
      console.error('Failed to persist notification record:', insertErr);
    }

    return {
      success: sendSuccess,
      notificationId: data?.id,
      error: sendError || undefined,
    };
  }

  /**
   * Dispatches an instant Telegram notification to the assigned representative(s)
   * when a student completes a submission.
   */
  async notifyRepresentativeOfSubmission(params: {
    sectionId: string;
    projectTitle: string;
    scopeName: string;
    studentOrGroupName: string;
    huStudentId?: string;
    fileName: string;
    fileSizeBytes: number;
    submissionType: 'individual' | 'group';
  }): Promise<{ dispatchedCount: number }> {
    // 1. Resolve active representatives for this specific section
    const { data: assignments, error } = await this.client
      .from('representative_assignments')
      .select('*, profile:profiles!representative_assignments_profile_id_fkey(telegram_user_id, full_name, is_active)')
      .eq('section_id', params.sectionId)
      .eq('is_active', true)
      .eq('profile.is_active', true);

    if (error || !assignments || assignments.length === 0) {
      return { dispatchedCount: 0 };
    }

    const typeLabel = params.submissionType === 'group' ? '👥 Group Submission' : '👤 Individual Submission';
    const idLine = params.huStudentId ? `• HU Student ID: \`${params.huStudentId}\`\n` : '';

    const alertMessage =
      `🔔 *New Academic Submission Alert*\n` +
      `───────────────────────────\n` +
      `• *Type:* ${typeLabel}\n` +
      `• *Project:* ${params.projectTitle}\n` +
      `• *Scope:* ${params.scopeName}\n` +
      `• *Submitter:* ${params.studentOrGroupName}\n` +
      idLine +
      `• *File:* \`${params.fileName}\` (${formatFileSize(params.fileSizeBytes)})\n` +
      `• *Received:* ${formatDateUTC(new Date())}\n` +
      `───────────────────────────\n` +
      `_Log in to the bot or dashboard to review and prepare delivery to teacher._`;

    let dispatchedCount = 0;

    for (const assignment of assignments) {
      const repTelegramId = assignment.profile?.telegram_user_id;
      if (!repTelegramId) continue;

      let sendSuccess = false;
      let sendError: string | null = null;

      if (this.botSender || process.env.TELEGRAM_BOT_TOKEN) {
        try {
          await this.sendRawTelegram(repTelegramId, alertMessage);
          sendSuccess = true;
        } catch (sendErr: any) {
          sendError = sendErr instanceof Error ? sendErr.message : String(sendErr);
          console.error(`Failed to send Telegram message to rep ${repTelegramId}:`, sendErr);
        }
      }

      // Persist status reflecting true delivery outcome
      await this.client.from('notifications').insert({
        recipient_telegram_id: repTelegramId,
        recipient_type: 'representative',
        message: alertMessage,
        payload: {
          section_id: params.sectionId,
          project_title: params.projectTitle,
          submission_type: params.submissionType,
        },
        status: sendSuccess ? 'sent' : sendError ? 'failed' : 'pending',
        sent_at: sendSuccess ? new Date().toISOString() : null,
        error_message: sendError,
      });

      if (sendSuccess || (!sendError && !this.botSender && !process.env.TELEGRAM_BOT_TOKEN)) {
        dispatchedCount++;
      }
    }

    return { dispatchedCount };
  }

  /**
   * Notifies a student via Telegram upon administrative registration approval.
   */
  async notifyStudentOfApproval(params: {
    telegramUserId: number;
    fullName: string;
    huStudentId: string;
    departmentName?: string;
    academicScope?: string;
    requestId?: string;
  }): Promise<NotificationDispatchResult> {
    const scopeLine = params.academicScope ? `• *Academic Scope:* ${params.academicScope}\n` : '';
    const deptLine = params.departmentName ? `• *Department:* ${params.departmentName}\n` : '';

    const message =
      `🎉 *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Registration Approved!*\n\n` +
      `Welcome, *${params.fullName}*! Your student identity has been verified and permanently locked.\n\n` +
      `• *HU Student ID:* \`${params.huStudentId}\`\n` +
      deptLine +
      scopeLine +
      `\nYou can now use this bot to submit assignments and track projects.\n` +
      `Send /start to open your student menu.`;

    return this.dispatchNotification({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'student',
      message,
      payload: {
        event: 'student_registration_approved',
        hu_student_id: params.huStudentId,
        request_id: params.requestId,
      },
      eventType: 'registration_approval',
    });
  }

  /**
   * Notifies a student via Telegram upon administrative registration rejection.
   */
  async notifyStudentOfRejection(params: {
    telegramUserId: number;
    fullName: string;
    huStudentId: string;
    reason: string;
    requestId?: string;
  }): Promise<NotificationDispatchResult> {
    const message =
      `⚠️ *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Registration Request Rejected*\n\n` +
      `Hello, *${params.fullName}*. Your registration request for HU ID \`${params.huStudentId}\` was reviewed and rejected.\n\n` +
      `• *Reason:* ${params.reason}\n\n` +
      `If you believe this was an error, please verify your credentials and run /start to submit a corrected request, or contact your department administrator.`;

    return this.dispatchNotification({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'student',
      message,
      payload: {
        event: 'student_registration_rejected',
        hu_student_id: params.huStudentId,
        reason: params.reason,
        request_id: params.requestId,
      },
      eventType: 'registration_rejection',
    });
  }

  /**
   * Notifies an assigned representative upon activation.
   */
  async notifyRepresentativeOfActivation(params: {
    telegramUserId: number;
    fullName: string;
    sectionName: string;
    academicYearName: string;
    assignmentId?: string;
  }): Promise<NotificationDispatchResult> {
    const scope = `${params.academicYearName} — ${params.sectionName}`;
    const message =
      `🎖️ *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Representative Privileges Activated!*\n\n` +
      `Congratulations, *${params.fullName}*!\n` +
      `You have been designated as the Academic Section Representative for:\n` +
      `• *Scope:* ${scope}\n\n` +
      `Your representative permissions are now active across:\n` +
      `1. *Telegram Bot (@HU_ASMS_Bot):* Send /start to access representative actions, view class rosters, and inspect project submissions.\n` +
      `2. *Representative Web Portal:* Access the delivery package builder and submission reports.`;

    return this.dispatchNotification({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'representative',
      message,
      payload: {
        event: 'representative_activated',
        scope,
        assignment_id: params.assignmentId,
      },
      eventType: 'representative_activation',
    });
  }

  /**
   * Notifies an assigned representative upon deactivation.
   */
  async notifyRepresentativeOfDeactivation(params: {
    telegramUserId: number;
    fullName: string;
    sectionName: string;
    academicYearName: string;
    assignmentId?: string;
  }): Promise<NotificationDispatchResult> {
    const scope = `${params.academicYearName} — ${params.sectionName}`;
    const message =
      `ℹ️ *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Representative Assignment Concluded*\n\n` +
      `Hello, *${params.fullName}*. Your representative assignment for:\n` +
      `• *Scope:* ${scope}\n` +
      `has been deactivated by the System Owner.\n\n` +
      `Your student privileges remain active. Thank you for your academic service.`;

    return this.dispatchNotification({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'representative',
      message,
      payload: {
        event: 'representative_deactivated',
        scope,
        assignment_id: params.assignmentId,
      },
      eventType: 'representative_deactivation',
    });
  }
}
