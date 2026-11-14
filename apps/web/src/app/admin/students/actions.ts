// HU-ASMS: System Owner Student Approval, Rejection & Verification Token Server Actions
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext, assertSystemOwner } from '../../../lib/auth/roles';
import { assertDistributedRateLimit } from '../../../lib/security/rate-limiter';
import {
  executeApproveRegistration,
  executeIssueStudentVerificationToken,
  executeIssueStudentVerificationTokenForHuId,
  executeRejectRegistration,
  type IssueVerificationTokenResult,
} from '../../../lib/admin/student-approval-service';
import { TelegramNotificationService } from '../../../lib/notifications/telegram-notification-service';

export async function approveRegistration(formData: FormData): Promise<void> {
  const rawRequestId = formData.get('requestId');
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : '';
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-reg-review:${context.userId}` : 'web:admin-reg-review:unauth',
    context?.userId ? 30 : 15,
    60000,
    'student registration review'
  );

  // Pre-fetch request data before status changes so student details are available for notification
  const { data: req } = await supabase
    .from('registration_requests')
    .select('*, department:departments(name), academic_year:academic_years(name), section:sections(name)')
    .eq('id', requestId)
    .maybeSingle();

  const result = await executeApproveRegistration(supabase, context, requestId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to approve student registration.');
  }

  // Dispatch outbound Telegram approval notification (non-blocking for DB commit)
  if (req && req.telegram_user_id) {
    try {
      const notifService = new TelegramNotificationService(supabase);
      await notifService.sendStudentApprovalNotification({
        telegramUserId: Number(req.telegram_user_id),
        fullName: req.full_name,
        huStudentId: req.hu_student_id,
        departmentName: req.department?.name,
        academicScope: `${req.academic_year?.name || 'Year'} — ${req.section?.name || 'Section'}`,
        requestId,
      });
    } catch (notifErr) {
      console.error('Failed to dispatch student approval notification (non-blocking):', notifErr);
    }
  }

  revalidatePath('/admin/students');
  revalidatePath('/admin');
}

export async function rejectRegistration(formData: FormData): Promise<void> {
  const rawRequestId = formData.get('requestId');
  const rawReason = formData.get('reason');
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : '';
  const reason = typeof rawReason === 'string' && rawReason.trim().length > 0 ? rawReason.trim() : 'Identity verification mismatch';
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-reg-review:${context.userId}` : 'web:admin-reg-review:unauth',
    context?.userId ? 30 : 15,
    60000,
    'student registration review'
  );

  const { data: req } = await supabase
    .from('registration_requests')
    .select('*, department:departments(name), academic_year:academic_years(name), section:sections(name)')
    .eq('id', requestId)
    .maybeSingle();

  const result = await executeRejectRegistration(supabase, context, requestId, reason);
  if (!result.success) {
    throw new Error(result.error || 'Failed to reject student registration.');
  }

  // Dispatch outbound Telegram rejection notification
  if (req && req.telegram_user_id) {
    try {
      const notifService = new TelegramNotificationService(supabase);
      await notifService.sendStudentRejectionNotification({
        telegramUserId: Number(req.telegram_user_id),
        fullName: req.full_name,
        huStudentId: req.hu_student_id,
        reason,
        requestId,
      });
    } catch (notifErr) {
      console.error('Failed to dispatch student rejection notification (non-blocking):', notifErr);
    }
  }

  revalidatePath('/admin/students');
  revalidatePath('/admin');
}

export async function retryNotificationAction(formData: FormData): Promise<void> {
  const rawNotificationId = formData.get('notificationId');
  const notificationId = typeof rawNotificationId === 'string' ? rawNotificationId : '';
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);
  assertSystemOwner(context);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-notif-retry:${context.userId}` : 'web:admin-notif-retry:unauth',
    10,
    60000,
    'notification retry'
  );

  const notifService = new TelegramNotificationService(supabase);
  const result = await notifService.retryNotification(notificationId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to retry Telegram delivery.');
  }

  revalidatePath('/admin/students');
  revalidatePath('/admin/representatives');
  revalidatePath('/admin');
}

export interface IssueVerificationTokenActionInput {
  studentId?: string;
  huStudentId?: string;
  purpose: 'roster_claim' | 'account_recovery';
  expiresHours?: number;
}

export async function issueStudentVerificationTokenAction(
  input: IssueVerificationTokenActionInput
): Promise<IssueVerificationTokenResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);

    await assertDistributedRateLimit(
      context?.userId ? `web:admin-token-issue:${context.userId}` : 'web:admin-token-issue:unauth',
      context?.userId ? 20 : 10,
      60000,
      'student verification token issuance'
    );

    const expiresHours =
      typeof input.expiresHours === 'number' && Number.isFinite(input.expiresHours)
        ? input.expiresHours
        : 24;

    const result =
      typeof input.studentId === 'string' && input.studentId.trim().length > 0
        ? await executeIssueStudentVerificationToken(supabase, context, {
            studentId: input.studentId,
            purpose: input.purpose,
            expiresHours,
          })
        : await executeIssueStudentVerificationTokenForHuId(supabase, context, {
            huStudentId: input.huStudentId || '',
            purpose: input.purpose,
            expiresHours,
          });

    if (result.success) {
      revalidatePath('/admin/students');
      revalidatePath('/admin');
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to issue verification token.',
    };
  }
}
