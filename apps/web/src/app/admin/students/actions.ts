// HU-ASMS: System Owner Student Approval, Rejection & Verification Token Server Actions
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { assertDistributedRateLimit } from '../../../lib/security/rate-limiter';
import {
  executeApproveRegistration,
  executeIssueStudentVerificationToken,
  executeIssueStudentVerificationTokenForHuId,
  executeRejectRegistration,
  type IssueVerificationTokenResult,
} from '../../../lib/admin/student-approval-service';

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

  const result = await executeApproveRegistration(supabase, context, requestId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to approve student registration.');
  }

  revalidatePath('/admin/students');
  revalidatePath('/admin');
}

export async function rejectRegistration(formData: FormData): Promise<void> {
  const rawRequestId = formData.get('requestId');
  const rawReason = formData.get('reason');
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : '';
  const reason = typeof rawReason === 'string' ? rawReason : undefined;
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-reg-review:${context.userId}` : 'web:admin-reg-review:unauth',
    context?.userId ? 30 : 15,
    60000,
    'student registration review'
  );

  const result = await executeRejectRegistration(supabase, context, requestId, reason);
  if (!result.success) {
    throw new Error(result.error || 'Failed to reject student registration.');
  }

  revalidatePath('/admin/students');
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
