// HU-ASMS: Representative Submission & Registration Notification Service (Phase 05)
import type { SupabaseClient } from '@hu-asms/database';
import { formatFileSize, formatDateUTC } from '@hu-asms/shared';
import type { BotContext } from '../types/context.js';

export interface DispatchNotificationOptions {
  recipientTelegramId: number;
  message: string;
  payload?: Record<string, unknown>;
}

export class NotificationService {
  constructor(
    private client: SupabaseClient,
    private botSender?: (chatId: number, message: string) => Promise<unknown>
  ) {}

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
      .select('*, profile:profiles!inner(telegram_user_id, full_name, is_active)')
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
      const repTelegramId = assignment.profile.telegram_user_id;
      if (!repTelegramId) continue;

      // 2. Insert into database notifications queue
      await this.client.from('notifications').insert({
        recipient_telegram_id: repTelegramId,
        recipient_type: 'representative',
        message: alertMessage,
        payload: {
          section_id: params.sectionId,
          project_title: params.projectTitle,
          submission_type: params.submissionType,
        },
        status: this.botSender ? 'sent' : 'pending',
        sent_at: this.botSender ? new Date().toISOString() : null,
      });

      // 3. Send direct Telegram alert if bot sender is available
      if (this.botSender) {
        try {
          await this.botSender(repTelegramId, alertMessage);
        } catch (sendErr) {
          console.error(`Failed to send Telegram message to rep ${repTelegramId}:`, sendErr);
        }
      }

      dispatchedCount++;
    }

    return { dispatchedCount };
  }
}
