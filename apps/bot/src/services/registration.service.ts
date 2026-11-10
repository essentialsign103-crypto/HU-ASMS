// HU-ASMS: Student Registration & Identity Verification Service (Phase 04)
import type { SupabaseClient } from '@hu-asms/database';
import type {
  Student,
  RegistrationRequest,
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

export interface StudentLookupResult {
  status:
    | 'not_found'
    | 'linked_to_current_user'
    | 'linked_to_another_user'
    | 'unlinked_roster_record'
    | 'pending_approval'
    | 'suspended';
  student?: Student;
  pendingRequest?: RegistrationRequest;
  maskedInfo?: {
    maskedName: string;
    departmentName: string;
  };
}

export class StudentRegistrationService {
  constructor(private client: SupabaseClient) {}

  /**
   * Masks personal full name for privacy (e.g. "Abebe Kebede" -> "A**** K*****")
   * to protect student identity against unauthorized query attempts.
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
   * Evaluates student lookup during /start flow
   */
  async lookupStudentIdentity(
    rawHuStudentId: string,
    currentTelegramId: number
  ): Promise<StudentLookupResult> {
    const huStudentId = sanitizeHuStudentId(rawHuStudentId);

    if (!isValidHuStudentId(huStudentId)) {
      throw new Error(`Invalid HU Student ID format: "${rawHuStudentId}". Example format: HU/10294/14 or HU-2024-001`);
    }

    // 1. Check existing student in master table
    const { data: student, error: studentErr } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('hu_student_id', huStudentId)
      .maybeSingle();

    if (studentErr) throw studentErr;

    if (student) {
      if (student.registration_status === 'suspended') {
        return { status: 'suspended', student };
      }

      if (student.telegram_user_id === currentTelegramId) {
        return { status: 'linked_to_current_user', student };
      }

      if (student.telegram_user_id && student.telegram_user_id !== currentTelegramId) {
        // Do NOT expose personal or academic details to unverified Telegram user!
        return {
          status: 'linked_to_another_user',
          maskedInfo: {
            maskedName: this.maskName(student.full_name),
            departmentName: student.department?.name || 'Academic Department',
          },
        };
      }

      // Record exists in roster but Telegram account is not yet linked
      return { status: 'unlinked_roster_record', student };
    }

    // 2. Check pending registration requests
    const { data: pendingReq, error: reqErr } = await this.client
      .from('registration_requests')
      .select('*')
      .eq('hu_student_id', huStudentId)
      .eq('status', 'pending')
      .maybeSingle();

    if (reqErr) throw reqErr;

    if (pendingReq) {
      return { status: 'pending_approval', pendingRequest: pendingReq };
    }

    // 3. Not found anywhere -> Eligible for first-time registration
    return { status: 'not_found' };
  }

  /**
   * Binds an unlinked roster record to the current verified Telegram account
   */
  async linkRosterStudentToTelegram(
    studentId: string,
    telegramUserId: number,
    telegramUsername?: string | null
  ): Promise<Student> {
    const { data, error } = await this.client
      .from('students')
      .update({
        telegram_user_id: telegramUserId,
        telegram_username: telegramUsername || null,
        registration_status: 'locked',
        is_locked: true,
      })
      .eq('id', studentId)
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Submits a first-time registration request for System Owner verification
   */
  async submitFirstTimeRegistration(input: RegistrationSubmissionInput): Promise<RegistrationRequest> {
    const huStudentId = sanitizeHuStudentId(input.hu_student_id);

    // Re-check duplicate prevention
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
