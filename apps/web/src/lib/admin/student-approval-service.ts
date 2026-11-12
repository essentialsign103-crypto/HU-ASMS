// HU-ASMS: System Owner Student Registration Approval & Rejection Service
// Execution model: Invokes atomic PostgreSQL RPCs (`approve_student_registration` and
// `reject_student_registration`) when `.rpc()` is present on the Supabase client so row locking
// (`FOR UPDATE`), locked student creation, request status transition, and `audit_logs` emission
// commit in one ACID transaction. Retains a compensating PostgREST fallback ONLY for unit-test
// mocks that omit `.rpc()`. See supabase/migrations/20261111000002_track_b_atomic_rpcs_and_db_parity.sql.
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidHuStudentId, isValidUuid, sanitizeHuStudentId } from '@hu-asms/validation';
import { assertSystemOwner, type UserSessionContext } from '../auth/roles';
import { assertRateLimit } from '../security/rate-limiter';

export interface RegistrationReviewResult {
  success: boolean;
  studentId?: string;
  error?: string;
}

export interface IssueVerificationTokenInput {
  studentId: string;
  purpose: 'roster_claim' | 'account_recovery';
  expiresHours?: number;
}

export interface IssueVerificationTokenResult {
  success: boolean;
  token?: string;
  expiresAt?: string;
  studentId?: string;
  huStudentId?: string;
  fullName?: string;
  purpose?: 'roster_claim' | 'account_recovery';
  error?: string;
}

export interface TargetStudentSummary {
  id: string;
  hu_student_id: string;
  full_name: string;
  telegram_user_id: number | null;
  telegram_username?: string | null;
  registration_status: string;
  department?: { name?: string | null } | null;
  academic_year?: { name?: string | null } | null;
  section?: { name?: string | null } | null;
}

/**
 * Resolves the authoritative target student record for a pending claim or account-recovery
 * request, prioritizing `target_student_id` over `hu_student_id` lookup.
 */
export function resolveTargetStudentForRequest<T extends TargetStudentSummary>(
  req: {
    request_type?: string | null;
    target_student_id?: string | null;
    hu_student_id?: string | null;
    target_student?: T | null;
  },
  byId: Map<string, T>,
  byHuId: Map<string, T>
): T | null {
  if (req.target_student) {
    return req.target_student;
  }
  if (req.target_student_id && byId.has(req.target_student_id)) {
    return byId.get(req.target_student_id) || null;
  }
  const normalizedHuId = req.hu_student_id ? sanitizeHuStudentId(req.hu_student_id) : '';
  if (normalizedHuId && byHuId.has(normalizedHuId)) {
    return byHuId.get(normalizedHuId) || null;
  }
  return null;
}

const DEFAULT_REJECTION_REASON = 'Identity verification mismatch';

function enforceReviewSecurity(
  context: UserSessionContext | null,
  requestId: string
): void {
  if (!context || !context.profile) {
    assertRateLimit('admin-reg-review:unauth', 15, 60000, 'student registration review');
    assertSystemOwner(context);
    return;
  }

  assertRateLimit(`admin-reg-review:${context.userId}`, 30, 60000, 'student registration review');
  assertSystemOwner(context);

  if (!isValidUuid(requestId)) {
    throw new Error('Invalid registration request identifier.');
  }
}

async function compensateCreatedStudent(
  supabase: SupabaseClient,
  studentId: string
): Promise<boolean> {
  try {
    const client = supabase as any;
    const tableApi = client?.from?.('students');
    if (typeof tableApi?.delete !== 'function') {
      return false;
    }
    const res = await tableApi.delete().eq('id', studentId);
    return !res?.error;
  } catch {
    return false;
  }
}

/**
 * Approves a pending student registration request, locks identity, and audits reviewer attribution.
 */
export async function executeApproveRegistration(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  requestId: string
): Promise<RegistrationReviewResult> {
  try {
    enforceReviewSecurity(context, requestId);
    const cleanRequestId = requestId.trim();

    if (typeof (supabase as any).rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('approve_student_registration', {
        p_request_id: cleanRequestId,
        p_notes: null,
      });

      if (rpcErr) {
        return {
          success: false,
          error: rpcErr.message || 'Unable to approve student registration.',
        };
      }

      const payload = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const studentId = typeof payload?.student_id === 'string' ? payload.student_id : undefined;
      if (!studentId) {
        return {
          success: false,
          error: 'Approval RPC completed without returning the created student identifier.',
        };
      }

      return { success: true, studentId };
    }

    // Legacy sequential fallback ONLY for lightweight test mocks omitting `.rpc()`.
    const { data: req, error: fetchErr } = await supabase
      .from('registration_requests')
      .select('*')
      .eq('id', cleanRequestId)
      .single();

    if (fetchErr || !req) {
      return { success: false, error: 'Registration request not found.' };
    }

    if (req.status !== 'pending') {
      return {
        success: false,
        error: `Registration request has already been processed (${req.status}).`,
      };
    }

    const requestType = (req.request_type as string | undefined) || 'new_registration';

    let approvedStudentId: string | undefined;
    let previousStudentBinding: {
      id: string;
      telegram_user_id: number | null;
      telegram_username: string | null;
      registration_status: string;
      is_locked: boolean;
    } | null = null;

    if (requestType === 'new_registration') {
      const { data: insertedStudent, error: insertErr } = await supabase
        .from('students')
        .insert({
          hu_student_id: req.hu_student_id,
          full_name: req.full_name,
          department_id: req.department_id,
          academic_year_id: req.academic_year_id,
          section_id: req.section_id,
          telegram_user_id: req.telegram_user_id,
          telegram_username: req.telegram_username,
          registration_status: 'locked',
          is_locked: true,
        })
        .select('id')
        .single();

      if (insertErr || !insertedStudent) {
        return {
          success: false,
          error: insertErr?.message || 'Failed to create locked student record.',
        };
      }
      approvedStudentId = insertedStudent.id;
    } else if (requestType === 'roster_claim' || requestType === 'account_recovery') {
      const targetQuery = supabase
        .from('students')
        .select('id, telegram_user_id, telegram_username, registration_status, is_locked')
        .eq(req.target_student_id ? 'id' : 'hu_student_id', req.target_student_id || req.hu_student_id);
      const { data: targetStudent, error: targetErr } = await targetQuery.maybeSingle();

      if (targetErr || !targetStudent) {
        return {
          success: false,
          error: 'Target student record not found for identity linking.',
        };
      }

      if (targetStudent.registration_status === 'suspended') {
        return {
          success: false,
          error: 'Target student account is suspended and cannot be claimed or recovered.',
        };
      }

      if (requestType === 'roster_claim' && targetStudent.telegram_user_id !== null && targetStudent.telegram_user_id !== undefined) {
        return {
          success: false,
          error: 'Duplicate student conflict: Target student record is already linked to a Telegram account.',
        };
      }

      const { data: dupTelegram } = await supabase
        .from('students')
        .select('id')
        .eq('telegram_user_id', req.telegram_user_id)
        .maybeSingle();

      if (dupTelegram && dupTelegram.id !== targetStudent.id) {
        return {
          success: false,
          error: 'Duplicate student conflict: Telegram account is already linked to another student.',
        };
      }

      previousStudentBinding = {
        id: targetStudent.id,
        telegram_user_id: targetStudent.telegram_user_id ?? null,
        telegram_username: targetStudent.telegram_username ?? null,
        registration_status: targetStudent.registration_status,
        is_locked: Boolean(targetStudent.is_locked),
      };

      const { error: bindErr } = await supabase
        .from('students')
        .update({
          telegram_user_id: req.telegram_user_id,
          telegram_username: req.telegram_username,
          registration_status: 'locked',
          is_locked: true,
        })
        .eq('id', targetStudent.id);

      if (bindErr) {
        return {
          success: false,
          error: bindErr.message || 'Failed to bind verified Telegram account to student record.',
        };
      }
      approvedStudentId = targetStudent.id;
    } else {
      return {
        success: false,
        error: `Unsupported registration request type: ${requestType}`,
      };
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('registration_requests')
      .update({
        status: 'approved',
        reviewed_by: context!.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', cleanRequestId)
      .eq('status', 'pending')
      .select('id');

    if (updateErr || !Array.isArray(updatedRows) || updatedRows.length === 0) {
      let rolledBack = false;
      if (requestType === 'new_registration' && approvedStudentId) {
        rolledBack = await compensateCreatedStudent(supabase, approvedStudentId);
      } else if (previousStudentBinding) {
        const { error: revertErr } = await supabase
          .from('students')
          .update({
            telegram_user_id: previousStudentBinding.telegram_user_id,
            telegram_username: previousStudentBinding.telegram_username,
            registration_status: previousStudentBinding.registration_status,
            is_locked: previousStudentBinding.is_locked,
          })
          .eq('id', previousStudentBinding.id);
        rolledBack = !revertErr;
      }

      if (updateErr) {
        return {
          success: false,
          error: rolledBack
            ? `${updateErr.message} (student creation rolled back)`
            : `${updateErr.message} (warning: orphaned student ${approvedStudentId} requires reconciliation)`,
        };
      }
      return {
        success: false,
        error: rolledBack
          ? 'Registration request is no longer pending or was concurrently processed.'
          : `Registration request is no longer pending (warning: orphaned student ${approvedStudentId} requires reconciliation).`,
      };
    }

    return { success: true, studentId: approvedStudentId };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to approve student registration.',
    };
  }
}

/**
 * Rejects a pending student registration request with reviewer attribution and notes.
 */
export async function executeRejectRegistration(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  requestId: string,
  reason?: string | null
): Promise<RegistrationReviewResult> {
  try {
    enforceReviewSecurity(context, requestId);
    const cleanRequestId = requestId.trim();
    const cleanReason =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim().slice(0, 500)
        : DEFAULT_REJECTION_REASON;

    if (typeof (supabase as any).rpc === 'function') {
      const { error: rpcErr } = await supabase.rpc('reject_student_registration', {
        p_request_id: cleanRequestId,
        p_reason: cleanReason,
      });

      if (rpcErr) {
        return {
          success: false,
          error: rpcErr.message || 'Unable to reject student registration.',
        };
      }

      return { success: true };
    }

    // Legacy sequential fallback ONLY for lightweight test mocks omitting `.rpc()`.
    const { data: req, error: fetchErr } = await supabase
      .from('registration_requests')
      .select('id, status')
      .eq('id', cleanRequestId)
      .single();

    if (fetchErr || !req) {
      return { success: false, error: 'Registration request not found.' };
    }

    if (req.status !== 'pending') {
      return {
        success: false,
        error: `Registration request has already been processed (${req.status}).`,
      };
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('registration_requests')
      .update({
        status: 'rejected',
        admin_notes: cleanReason,
        reviewed_by: context!.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', cleanRequestId)
      .eq('status', 'pending')
      .select('id');

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return {
        success: false,
        error: 'Registration request is no longer pending or was concurrently processed.',
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to reject student registration.',
    };
  }
}

/**
 * Issues a single-use, hashed verification or account-recovery code for a student record.
 * Only active System Owners may generate verification codes; only the SHA-256 hash is stored.
 */
export async function executeIssueStudentVerificationToken(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  input: IssueVerificationTokenInput
): Promise<IssueVerificationTokenResult> {
  try {
    enforceReviewSecurity(context, input.studentId);
    const cleanStudentId = input.studentId.trim();

    if (input.purpose !== 'roster_claim' && input.purpose !== 'account_recovery') {
      return { success: false, error: 'Invalid verification token purpose.' };
    }

    const { data: student, error: fetchErr } = await supabase
      .from('students')
      .select('id, hu_student_id, full_name, telegram_user_id, registration_status')
      .eq('id', cleanStudentId)
      .single();

    if (fetchErr || !student) {
      return { success: false, error: 'Student record not found.' };
    }

    if (student.registration_status === 'suspended') {
      return {
        success: false,
        error: 'Cannot issue verification tokens for a suspended student account.',
      };
    }

    if (input.purpose === 'roster_claim' && student.telegram_user_id !== null && student.telegram_user_id !== undefined) {
      return {
        success: false,
        error: 'Student already has a linked Telegram account; issue an account_recovery token instead.',
      };
    }

    const rawCode = randomBytes(8).toString('hex').toUpperCase();
    const tokenHash = createHash('sha256').update(rawCode).digest('hex');
    const ttlHours = Math.min(Math.max(Number(input.expiresHours ?? 24) || 24, 1), 168);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase.from('student_verification_tokens').insert({
      student_id: student.id,
      token_hash: tokenHash,
      purpose: input.purpose,
      issued_by: context!.userId,
      expires_at: expiresAt,
    });

    if (insertErr) {
      return {
        success: false,
        error: insertErr.message || 'Failed to store verification token hash.',
      };
    }

    return {
      success: true,
      token: rawCode,
      expiresAt,
      studentId: student.id,
      huStudentId: student.hu_student_id,
      fullName: (student as any).full_name,
      purpose: input.purpose,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to issue verification token.',
    };
  }
}

/**
 * Issues a single-use verification or account-recovery token by HU Student ID.
 * Enforces System Owner authorization, rate limiting, and active non-suspended roster checks.
 */
export async function executeIssueStudentVerificationTokenForHuId(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  input: {
    huStudentId: string;
    purpose: 'roster_claim' | 'account_recovery';
    expiresHours?: number;
  }
): Promise<IssueVerificationTokenResult> {
  try {
    if (!context || !context.profile) {
      assertRateLimit('admin-reg-review:unauth', 15, 60000, 'student verification token issuance');
      assertSystemOwner(context);
    } else {
      assertRateLimit(
        `admin-reg-review:${context.userId}`,
        30,
        60000,
        'student verification token issuance'
      );
      assertSystemOwner(context);
    }

    const sanitizedId = sanitizeHuStudentId(input.huStudentId || '');
    if (!isValidHuStudentId(sanitizedId)) {
      return { success: false, error: 'Invalid HU Student ID format.' };
    }

    const { data: student, error: fetchErr } = await supabase
      .from('students')
      .select('id')
      .eq('hu_student_id', sanitizedId)
      .maybeSingle();

    if (fetchErr || !student) {
      return { success: false, error: `No enrolled student record found for ${sanitizedId}.` };
    }

    return executeIssueStudentVerificationToken(supabase, context, {
      studentId: student.id,
      purpose: input.purpose,
      expiresHours: input.expiresHours,
    });
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to issue verification token.',
    };
  }
}
