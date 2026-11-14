// HU-ASMS: Server-Side Telegram Notification Dispatcher & Queue Service
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StudentApprovalNotificationParams {
  telegramUserId: number;
  fullName: string;
  huStudentId: string;
  departmentName?: string;
  academicScope?: string;
  requestId?: string;
}

export interface StudentRejectionNotificationParams {
  telegramUserId: number;
  fullName: string;
  huStudentId: string;
  reason: string;
  requestId?: string;
}

export interface RepresentativeActivationNotificationParams {
  telegramUserId: number;
  fullName: string;
  scopeName: string;
  assignmentId?: string;
}

export interface RepresentativeDeactivationNotificationParams {
  telegramUserId: number;
  fullName: string;
  scopeName: string;
  assignmentId?: string;
}

export interface NotificationResult {
  success: boolean;
  notificationId?: string;
  error?: string;
}

export class TelegramNotificationService {
  constructor(
    private supabase: SupabaseClient,
    private botSender?: (chatId: number, message: string) => Promise<unknown>
  ) {}

  private redactToken(text: string): string {
    return text.replace(/\/bot[0-9]+:[a-zA-Z0-9_-]+/g, '/bot[REDACTED]');
  }

  private async sendRawTelegram(chatId: number, message: string): Promise<void> {
    if (this.botSender) {
      await this.botSender(chatId, message);
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('Telegram bot token is not configured on server.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const description = body?.description || `Telegram API responded with HTTP ${res.status}`;
        throw new Error(this.redactToken(description));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendStudentApprovalNotification(
    params: StudentApprovalNotificationParams
  ): Promise<NotificationResult> {
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
      `\nYou can now use this bot to submit assignments and track academic projects.\n` +
      `Send /start to open your student menu.`;

    return this.persistAndDispatch({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'student',
      message,
      payload: {
        event: 'student_registration_approved',
        hu_student_id: params.huStudentId,
        request_id: params.requestId,
      },
      eventType: 'student_approval',
      idempotencyKey: params.requestId ? `approval:${params.requestId}` : undefined,
    });
  }

  async sendStudentRejectionNotification(
    params: StudentRejectionNotificationParams
  ): Promise<NotificationResult> {
    const message =
      `⚠️ *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Registration Request Rejected*\n\n` +
      `Hello, *${params.fullName}*. Your registration request for HU ID \`${params.huStudentId}\` was reviewed and rejected.\n\n` +
      `• *Reason:* ${params.reason}\n\n` +
      `If you believe this was an error, please verify your credentials and run /start to submit a corrected request, or contact your department administrator.`;

    return this.persistAndDispatch({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'student',
      message,
      payload: {
        event: 'student_registration_rejected',
        hu_student_id: params.huStudentId,
        reason: params.reason,
        request_id: params.requestId,
      },
      eventType: 'student_rejection',
      idempotencyKey: params.requestId ? `rejection:${params.requestId}` : undefined,
    });
  }

  async sendRepresentativeActivationNotification(
    params: RepresentativeActivationNotificationParams
  ): Promise<NotificationResult> {
    const message =
      `🎖️ *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Representative Privileges Activated!*\n\n` +
      `Congratulations, *${params.fullName}*!\n` +
      `You have been designated as the Academic Section Representative for:\n` +
      `• *Scope:* ${params.scopeName}\n\n` +
      `Your representative permissions are now active across:\n` +
      `1. *Telegram Bot (@HU_ASMS_Bot):* Send /start to access representative actions, view class rosters, and inspect project submissions.\n` +
      `2. *Representative Web Portal:* Access the delivery package builder and submission reports.`;

    return this.persistAndDispatch({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'representative',
      message,
      payload: {
        event: 'representative_activated',
        scope: params.scopeName,
        assignment_id: params.assignmentId,
      },
      eventType: 'rep_activation',
    });
  }

  async sendRepresentativeDeactivationNotification(
    params: RepresentativeDeactivationNotificationParams
  ): Promise<NotificationResult> {
    const message =
      `ℹ️ *Haramaya University Academic System*\n` +
      `───────────────────────────\n` +
      `*Representative Assignment Concluded*\n\n` +
      `Hello, *${params.fullName}*. Your representative assignment for:\n` +
      `• *Scope:* ${params.scopeName}\n` +
      `has been deactivated by the System Owner.\n\n` +
      `Your student privileges remain active. Thank you for your academic service.`;

    return this.persistAndDispatch({
      recipientTelegramId: params.telegramUserId,
      recipientType: 'representative',
      message,
      payload: {
        event: 'representative_deactivated',
        scope: params.scopeName,
        assignment_id: params.assignmentId,
      },
      eventType: 'rep_deactivation',
    });
  }

  async retryNotification(notificationId: string): Promise<NotificationResult> {
    const { data: notif, error: fetchErr } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .maybeSingle();

    if (fetchErr || !notif) {
      return { success: false, error: 'Notification record not found.' };
    }

    if (notif.status === 'sent') {
      return { success: true, notificationId };
    }

    let sendSuccess = false;
    let sendError: string | null = null;

    try {
      await this.sendRawTelegram(Number(notif.recipient_telegram_id), notif.message);
      sendSuccess = true;
    } catch (err: any) {
      sendError = this.redactToken(err instanceof Error ? err.message : String(err));
    }

    const nextRetryCount = (typeof notif.retry_count === 'number' ? notif.retry_count : 0) + 1;

    await this.supabase
      .from('notifications')
      .update({
        status: sendSuccess ? 'sent' : 'failed',
        sent_at: sendSuccess ? new Date().toISOString() : null,
        error_message: sendError,
        retry_count: nextRetryCount,
      })
      .eq('id', notificationId);

    return {
      success: sendSuccess,
      notificationId,
      error: sendError || undefined,
    };
  }

  private async persistAndDispatch(params: {
    recipientTelegramId: number;
    recipientType: 'student' | 'representative' | 'owner';
    message: string;
    payload: Record<string, unknown>;
    eventType: string;
    idempotencyKey?: string;
  }): Promise<NotificationResult> {
    // 1. Idempotency check: prevent duplicate sent messages
    if (params.idempotencyKey) {
      const { data: existing } = await this.supabase
        .from('notifications')
        .select('id, status')
        .eq('recipient_telegram_id', params.recipientTelegramId)
        .eq('payload->>idempotency_key', params.idempotencyKey)
        .eq('status', 'sent')
        .maybeSingle();

      if (existing) {
        return { success: true, notificationId: existing.id };
      }
    }

    // 2. Attempt delivery
    let sendSuccess = false;
    let sendError: string | null = null;

    try {
      await this.sendRawTelegram(params.recipientTelegramId, params.message);
      sendSuccess = true;
    } catch (err: any) {
      sendError = this.redactToken(err instanceof Error ? err.message : String(err));
      console.error(`Failed to send Telegram notification to ${params.recipientTelegramId}:`, sendError);
    }

    // 3. Persist outcome
    const fullPayload = {
      ...params.payload,
      idempotency_key: params.idempotencyKey,
      event_type: params.eventType,
    };

    const { data: inserted, error: insertErr } = await this.supabase
      .from('notifications')
      .insert({
        recipient_telegram_id: params.recipientTelegramId,
        recipient_type: params.recipientType,
        message: params.message,
        payload: fullPayload,
        status: sendSuccess ? 'sent' : 'failed',
        sent_at: sendSuccess ? new Date().toISOString() : null,
        error_message: sendError,
        retry_count: 0,
      })
      .select('id')
      .maybeSingle();

    if (insertErr) {
      console.error('Failed to insert notification log row:', insertErr);
    }

    return {
      success: sendSuccess,
      notificationId: inserted?.id,
      error: sendError || undefined,
    };
  }
}
