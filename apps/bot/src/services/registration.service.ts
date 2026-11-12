// HU-ASMS: Student Registration & Identity Verification Service (Phase 04 + Critical Blockers Phase A)
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@hu-asms/database';
import type {
  Student,
  RegistrationRequest,
  RegistrationRequestType,
  Department,
  AcademicYear,
  Section,
} from '@hu-asms/types';
import { sanitizeHuStudentId, isValidHuStudentId } from '@hu-asms/validation';

export interface RegistrationSubmissionInput {
  hu_student_id: string;
  full_name: string;
  department_id: string;
  academic_year_id: string;
  section_id: string;
  telegram_user_id: number;
  telegram_username?: string | null;
  phone?: string | null;
}

export interface ClaimOrRecoveryInput extends RegistrationSubmissionInput {
  request_type: Extract<RegistrationRequestType, 'roster_claim' | 'account_recovery'>;
  recovery_reason: string;
}

export interface StudentLookupResult {
  status:
    | 'not_found'
    | 'linked_to_current_user'
    | 'linked_to_another_user'
    | 'unlinked_roster_verification_required'
    | 'pending_approval'
    | 'telegram_already_linked'
    | 'suspended';
  student?: Student;
  pendingRequest?: RegistrationRequest;
}

const MAX_STUDENT_TOKEN_FAILURES = 5;
const STUDENT_TOKEN_FAILURE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const sharedStudentTokenFailures = new Map<string, number[]>();

export function clearStudentTokenFailureTracking(huStudentId?: string): void {
  if (huStudentId) {
    sharedStudentTokenFailures.delete(sanitizeHuStudentId(huStudentId));
  } else {
    sharedStudentTokenFailures.clear();
  }
}

export function hashVerificationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken.trim().toUpperCase()).digest('hex');
}

export class StudentRegistrationService {
  constructor(
    private client: SupabaseClient,
    private failedAttemptStore: Map<string, number[]> = sharedStudentTokenFailures
  ) {}

  /**
   * Masks personal full name for privacy (e.g. "Abebe Kebede" -> "A**** K*****").
   * Never returned to unverified callers during identity lookup.
   */
  maskName(fullName: string): string {
    return fullName
      .split(' ')
      .map((part) => (part.length > 1 ? part[0] + '*'.repeat(Math.min(part.length - 1, 5)) : part))
      .join(' ');
  }

  /**
   * Checks if a Telegram user is already linked to an approved student record
   */
  async getStudentByTelegramId(telegramId: number): Promise<Student | null> {
    const { data, error } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('telegram_user_id', telegramId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Checks if a Telegram user has a pending registration request
   */
  async getPendingRequestByTelegramId(telegramId: number): Promise<RegistrationRequest | null> {
    const { data, error } = await this.client
      .from('registration_requests')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('telegram_user_id', telegramId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Evaluates student lookup during /start flow WITHOUT exposing personal details
   * (full name, masked name, department, academic scope, or suspension details) prior
   * to successful verification.
   */
  async lookupStudentIdentity(
    rawHuStudentId: string,
    currentTelegramId: number
  ): Promise<StudentLookupResult> {
    const huStudentId = sanitizeHuStudentId(rawHuStudentId);

    if (!isValidHuStudentId(huStudentId)) {
      throw new Error(`Invalid HU Student ID format: "${rawHuStudentId}". Example format: HU/10294/14 or HU-2024-001`);
    }

    // 1. Prevent duplicate Telegram account linking before querying arbitrary HU IDs
    const ownStudent = await this.getStudentByTelegramId(currentTelegramId);
    if (ownStudent) {
      if (ownStudent.hu_student_id === huStudentId) {
        if (ownStudent.registration_status === 'suspended') {
          return { status: 'suspended', student: ownStudent };
        }
        return { status: 'linked_to_current_user', student: ownStudent };
      }
      return { status: 'telegram_already_linked', student: ownStudent };
    }

    // 2. Check if current Telegram user already has a pending request
    const ownPending = await this.getPendingRequestByTelegramId(currentTelegramId);
    if (ownPending) {
      return { status: 'pending_approval', pendingRequest: ownPending };
    }

    // 3. Check existing student in master table (minimal projection — never expose unverified PII)
    const { data: student, error: studentErr } = await this.client
      .from('students')
      .select('id, hu_student_id, telegram_user_id, registration_status')
      .eq('hu_student_id', huStudentId)
      .maybeSingle();

    if (studentErr) throw studentErr;

    if (student) {
      if (student.telegram_user_id && student.telegram_user_id !== currentTelegramId) {
        return { status: 'linked_to_another_user' };
      }

      // Record exists in roster without a linked Telegram account:
      // NEVER expose student PII or allow claiming with HU Student ID alone.
      return { status: 'unlinked_roster_verification_required' };
    }

    // 4. Check pending registration requests (do NOT return another user's pendingRequest details)
    const { data: pendingReq, error: reqErr } = await this.client
      .from('registration_requests')
      .select('id, telegram_user_id, status')
      .eq('hu_student_id', huStudentId)
      .eq('status', 'pending')
      .maybeSingle();

    if (reqErr) throw reqErr;

    if (pendingReq) {
      return { status: 'pending_approval' };
    }

    // 5. Not found anywhere -> Eligible for first-time registration
    return { status: 'not_found' };
  }

  /**
   * Unverified direct roster linking is intentionally disabled.
   * Binding requires either a verified single-use token or System Owner approval.
   */
  async linkRosterStudentToTelegram(
    _studentId: string,
    _telegramUserId: number,
    _telegramUsername?: string | null
  ): Promise<never> {
    throw new Error(
      'Direct unverified roster linking is disabled. Use redeemVerificationToken() or System Owner approval.'
    );
  }

  private getActiveFailureTimestamps(huStudentId: string, now: number): number[] {
    const cutoff = now - STUDENT_TOKEN_FAILURE_WINDOW_MS;
    const active = (this.failedAttemptStore.get(huStudentId) || []).filter((ts) => ts > cutoff);
    if (active.length === 0) {
      this.failedAttemptStore.delete(huStudentId);
    } else {
      this.failedAttemptStore.set(huStudentId, active);
    }
    return active;
  }

  private recordLocalTokenFailure(huStudentId: string, now: number): number {
    const active = this.getActiveFailureTimestamps(huStudentId, now);
    active.push(now);
    this.failedAttemptStore.set(huStudentId, active);
    return active.length;
  }

  private async tryAuditFailedTokenAttempt(
    huStudentId: string,
    telegramUserId: number,
    action: 'STUDENT_VERIFICATION_FAILED' | 'STUDENT_VERIFICATION_LOCKED',
    reason: string,
    attemptCount: number
  ): Promise<void> {
    try {
      const tableApi = (this.client as any)?.from?.('audit_logs');
      if (typeof tableApi?.insert !== 'function') return;
      await tableApi.insert({
        actor_telegram_id: telegramUserId,
        actor_role: 'service_role',
        action,
        entity_type: 'student',
        metadata: {
          hu_student_id: huStudentId,
          reason,
          attempt_count: attemptCount,
        },
      });
    } catch {
      // Lightweight test mocks omit audit_logs; production Postgres RPC writes audit_logs atomically.
    }
  }

  /**
   * Redeems a single-use System Owner verification or recovery token atomically via RPC.
   */
  async redeemVerificationToken(
    rawHuStudentId: string,
    rawToken: string,
    telegramUserId: number,
    telegramUsername?: string | null
  ): Promise<Student> {
    const huStudentId = sanitizeHuStudentId(rawHuStudentId);
    if (!isValidHuStudentId(huStudentId)) {
      throw new Error(`Invalid HU Student ID format: "${rawHuStudentId}". Example format: HU/10294/14 or HU-2024-001`);
    }

    const now = Date.now();
    const priorFailures = this.getActiveFailureTimestamps(huStudentId, now);
    if (priorFailures.length >= MAX_STUDENT_TOKEN_FAILURES) {
      await this.tryAuditFailedTokenAttempt(
        huStudentId,
        telegramUserId,
        'STUDENT_VERIFICATION_LOCKED',
        'per_student_failure_threshold_reached',
        priorFailures.length
      );
      throw new Error(
        'Too many failed verification attempts for this Student ID. Please wait 15 minutes or contact the System Owner.'
      );
    }

    const ownStudent = await this.getStudentByTelegramId(telegramUserId);
    if (ownStudent) {
      throw new Error('This Telegram account is already linked to a registered student record.');
    }

    const cleanToken = rawToken.trim().toUpperCase();
    if (cleanToken.length < 6) {
      const count = this.recordLocalTokenFailure(huStudentId, now);
      await this.tryAuditFailedTokenAttempt(
        huStudentId,
        telegramUserId,
        count >= MAX_STUDENT_TOKEN_FAILURES
          ? 'STUDENT_VERIFICATION_LOCKED'
          : 'STUDENT_VERIFICATION_FAILED',
        'malformed_token_length',
        count
      );
      throw new Error('Invalid or expired verification code.');
    }

    const tokenHash = hashVerificationToken(cleanToken);
    if (typeof (this.client as any).rpc !== 'function') {
      throw new Error('Atomic verification RPC client is required to redeem verification tokens.');
    }

    const { data: rpcData, error: rpcErr } = await (this.client as any).rpc(
      'redeem_student_verification_token',
      {
        p_hu_student_id: huStudentId,
        p_token_hash: tokenHash,
        p_telegram_user_id: telegramUserId,
        p_telegram_username: telegramUsername || null,
      }
    );

    if (rpcErr) {
      if (rpcErr.code === '23505' || String(rpcErr.message || '').includes('already linked')) {
        throw new Error(rpcErr.message || 'This Telegram account or student ID is already linked.');
      }
      const count = this.recordLocalTokenFailure(huStudentId, now);
      await this.tryAuditFailedTokenAttempt(
        huStudentId,
        telegramUserId,
        count >= MAX_STUDENT_TOKEN_FAILURES
          ? 'STUDENT_VERIFICATION_LOCKED'
          : 'STUDENT_VERIFICATION_FAILED',
        'invalid_or_expired_token',
        count
      );
      throw new Error('Invalid or expired verification code.');
    }

    if (rpcData && typeof rpcData === 'object' && (rpcData as any).ok === false) {
      const errCode = (rpcData as any).code;
      if (errCode === 'LOCKED') {
        throw new Error(
          'Too many failed verification attempts for this Student ID. Please wait 15 minutes or contact the System Owner.'
        );
      }
      this.recordLocalTokenFailure(huStudentId, now);
      throw new Error('Invalid or expired verification code.');
    }

    this.failedAttemptStore.delete(huStudentId);

    const linkedStudent = await this.getStudentByTelegramId(telegramUserId);
    if (!linkedStudent) {
      throw new Error('Verification succeeded, but student record could not be loaded.');
    }
    return linkedStudent;
  }

  /**
   * Submits an admin-reviewed roster claim or lost-Telegram account recovery request.
   * Stores only applicant-provided fields and internal target_student_id; never leaks roster PII.
   */
  async submitVerifiedClaimOrRecoveryRequest(
    input: ClaimOrRecoveryInput
  ): Promise<RegistrationRequest> {
    const huStudentId = sanitizeHuStudentId(input.hu_student_id);
    if (!isValidHuStudentId(huStudentId)) {
      throw new Error(`Invalid HU Student ID format: "${input.hu_student_id}". Example format: HU/10294/14 or HU-2024-001`);
    }

    const cleanName = input.full_name.trim();
    if (cleanName.length < 3) {
      throw new Error('Full Name must be at least 3 characters.');
    }

    const cleanReason = input.recovery_reason.trim();
    if (cleanReason.length < 10) {
      throw new Error('Please provide a clear verification or recovery explanation (at least 10 characters).');
    }

    const ownStudent = await this.getStudentByTelegramId(input.telegram_user_id);
    if (ownStudent) {
      throw new Error('This Telegram account is already linked to a student record.');
    }

    const ownPending = await this.getPendingRequestByTelegramId(input.telegram_user_id);
    if (ownPending) {
      throw new Error('You already have a pending registration or recovery request awaiting System Owner review.');
    }

    const { data: targetStudent, error: targetErr } = await this.client
      .from('students')
      .select('id, telegram_user_id, registration_status')
      .eq('hu_student_id', huStudentId)
      .maybeSingle();

    if (targetErr) throw targetErr;
    if (!targetStudent || targetStudent.registration_status === 'suspended') {
      throw new Error('Unable to create verification request for this Student ID. Contact the System Owner.');
    }

    if (input.request_type === 'roster_claim' && targetStudent.telegram_user_id !== null) {
      throw new Error('This HU Student ID already has an associated Telegram account. Submit an Account Recovery request instead.');
    }

    if (input.request_type === 'account_recovery' && targetStudent.telegram_user_id === input.telegram_user_id) {
      throw new Error('This Telegram account is already linked to the supplied HU Student ID.');
    }

    const { data, error } = await this.client
      .from('registration_requests')
      .insert({
        hu_student_id: huStudentId,
        full_name: cleanName,
        department_id: input.department_id,
        academic_year_id: input.academic_year_id,
        section_id: input.section_id,
        telegram_user_id: input.telegram_user_id,
        telegram_username: input.telegram_username || null,
        request_type: input.request_type,
        target_student_id: targetStudent.id,
        recovery_reason: cleanReason.slice(0, 500),
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Submits a first-time registration request for System Owner verification
   */
  async submitFirstTimeRegistration(input: RegistrationSubmissionInput): Promise<RegistrationRequest> {
    const huStudentId = sanitizeHuStudentId(input.hu_student_id);
    if (!isValidHuStudentId(huStudentId)) {
      throw new Error(`Invalid HU Student ID format: "${input.hu_student_id}". Example format: HU/10294/14 or HU-2024-001`);
    }

    // Prevent duplicate Telegram linking
    const ownStudent = await this.getStudentByTelegramId(input.telegram_user_id);
    if (ownStudent) {
      throw new Error('This Telegram account is already linked to a registered student record.');
    }

    const ownPending = await this.getPendingRequestByTelegramId(input.telegram_user_id);
    if (ownPending) {
      throw new Error('You already have a pending registration request awaiting System Owner review.');
    }

    // Re-check duplicate HU ID prevention
    const { data: existingStudent } = await this.client
      .from('students')
      .select('id')
      .eq('hu_student_id', huStudentId)
      .maybeSingle();

    if (existingStudent) {
      throw new Error(`Student with HU ID "${huStudentId}" is already registered.`);
    }

    const { data: existingReq } = await this.client
      .from('registration_requests')
      .select('id')
      .eq('hu_student_id', huStudentId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingReq) {
      throw new Error(`A registration request for "${huStudentId}" is already pending administrator verification.`);
    }

    const { data, error } = await this.client
      .from('registration_requests')
      .insert({
        hu_student_id: huStudentId,
        full_name: input.full_name.trim(),
        department_id: input.department_id,
        academic_year_id: input.academic_year_id,
        section_id: input.section_id,
        telegram_user_id: input.telegram_user_id,
        telegram_username: input.telegram_username || null,
        request_type: 'new_registration',
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Submits a correction request for an already approved / locked student
   */
  async submitCorrectionRequest(
    studentId: string,
    reason: string,
    requestedChanges: Record<string, unknown>
  ): Promise<void> {
    if (!reason || reason.trim().length < 10) {
      throw new Error('Please provide a detailed reason for the correction request (at least 10 characters).');
    }

    const { error } = await this.client
      .from('identity_change_requests')
      .insert({
        student_id: studentId,
        reason: reason.trim(),
        requested_changes: requestedChanges,
        status: 'pending',
      });

    if (error) throw error;
  }

  // Reference lookups for interactive bot dropdowns/keyboards
  async getDepartments(): Promise<Department[]> {
    const { data } = await this.client.from('departments').select('*').order('name');
    return data || [];
  }

  async getAcademicYears(): Promise<AcademicYear[]> {
    const { data } = await this.client.from('academic_years').select('*').eq('is_active', true).order('year_level');
    return data || [];
  }

  async getSectionsByYear(yearId: string): Promise<Section[]> {
    const { data } = await this.client.from('sections').select('*').eq('academic_year_id', yearId).order('name');
    return data || [];
  }
}
