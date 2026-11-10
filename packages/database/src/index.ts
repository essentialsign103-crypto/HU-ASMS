// HU-ASMS: Database Service Layer and Core Queries
import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Student,
  RegistrationRequest,
  Project,
  Group,
  GroupMember,
  Submission,
  Profile,
  RepresentativeAssignment,
} from '@hu-asms/types';

export * from './client.js';
export * from './university-structure.js';
export * from './academic-management.js';

export class DatabaseService {
  constructor(private client: SupabaseClient) {}

  // ---------------------------------------------------------------------------
  // 1. STUDENT IDENTITY & LOOKUP
  // ---------------------------------------------------------------------------

  /**
   * Finds a student by their registered Telegram numeric user ID
   */
  async findStudentByTelegramId(telegramId: number): Promise<Student | null> {
    const { data, error } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('telegram_user_id', telegramId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Finds a student record by their official HU Student ID
   */
  async findStudentByHuId(huStudentId: string): Promise<Student | null> {
    const { data, error } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('hu_student_id', huStudentId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Checks if an HU Student ID has a pending registration request
   */
  async findPendingRegistration(huStudentId: string): Promise<RegistrationRequest | null> {
    const { data, error } = await this.client
      .from('registration_requests')
      .select('*')
      .eq('hu_student_id', huStudentId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Submits a new first-time student registration request
   */
  async createRegistrationRequest(
    params: Omit<RegistrationRequest, 'id' | 'status' | 'admin_notes' | 'reviewed_by' | 'reviewed_at' | 'created_at' | 'updated_at'>
  ): Promise<RegistrationRequest> {
    const { data, error } = await this.client
      .from('registration_requests')
      .insert({
        hu_student_id: params.hu_student_id,
        full_name: params.full_name,
        department_id: params.department_id,
        academic_year_id: params.academic_year_id,
        section_id: params.section_id,
        telegram_user_id: params.telegram_user_id,
        telegram_username: params.telegram_username,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ---------------------------------------------------------------------------
  // 2. REPRESENTATIVE RESOLUTION & ROUTING
  // ---------------------------------------------------------------------------

  /**
   * Identifies the authorized representative(s) for a given academic section
   */
  async getSectionRepresentatives(sectionId: string): Promise<RepresentativeAssignment[]> {
    const { data, error } = await this.client
      .from('representative_assignments')
      .select('*, profile:profiles(*), section:sections(*)')
      .eq('section_id', sectionId)
      .eq('is_active', true);

    if (error) throw error;
    return data || [];
  }

  /**
   * Finds if a Telegram user is an active representative and gets their assigned sections
   */
  async findRepresentativeByTelegramId(telegramId: number): Promise<{
    profile: Profile;
    assignments: RepresentativeAssignment[];
  } | null> {
    const { data: profile, error: profErr } = await this.client
      .from('profiles')
      .select('*')
      .eq('telegram_user_id', telegramId)
      .eq('is_active', true)
      .maybeSingle();

    if (profErr || !profile) return null;

    const { data: assignments, error: assignErr } = await this.client
      .from('representative_assignments')
      .select('*, section:sections(*, academic_year:academic_years(*))')
      .eq('profile_id', profile.id)
      .eq('is_active', true);

    if (assignErr) throw assignErr;

    return {
      profile,
      assignments: assignments || [],
    };
  }

  // ---------------------------------------------------------------------------
  // 3. ACADEMIC STRUCTURE & PROJECTS
  // ---------------------------------------------------------------------------

  /**
   * Retrieves all active projects eligible for a specific academic year and section
   */
  async getEligibleProjects(academicYearId: string, sectionId: string): Promise<Project[]> {
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .from('projects')
      .select(`
        *,
        course:courses(*),
        teacher:teachers(*),
        file_rules:project_file_rules(*),
        targets:project_targets!inner(*)
      `)
      .eq('is_active', true)
      .lte('opening_date', now)
      .gte('deadline', now)
      .or(`academic_year_id.eq.${academicYearId}`, { foreignTable: 'targets' })
      .or(`section_id.is.null,section_id.eq.${sectionId}`, { foreignTable: 'targets' });

    if (error) throw error;
    return data || [];
  }

  // ---------------------------------------------------------------------------
  // 4. GROUP MANAGEMENT & MEMBERSHIP
  // ---------------------------------------------------------------------------

  /**
   * Gets a student's assigned group for a specific project
   */
  async getStudentProjectGroup(studentId: string, projectId: string): Promise<{
    group: Group;
    membership: GroupMember;
  } | null> {
    const { data, error } = await this.client
      .from('group_members')
      .select(`
        *,
        group:groups!inner(
          *,
          project:projects(*),
          members:group_members(*, student:students(*))
        )
      `)
      .eq('student_id', studentId)
      .eq('group.project_id', projectId)
      .neq('confirmation_status', 'removed')
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      group: data.group,
      membership: data,
    };
  }

  /**
   * Confirms a student's membership in a group
   */
  async confirmGroupMembership(
    memberRecordId: string,
    studentId: string
  ): Promise<GroupMember> {
    const { data, error } = await this.client
      .from('group_members')
      .update({
        confirmation_status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', memberRecordId)
      .eq('student_id', studentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ---------------------------------------------------------------------------
  // 5. SUBMISSIONS & DUPLICATE PREVENTION
  // ---------------------------------------------------------------------------

  /**
   * Checks whether an active submission already exists for an individual student
   */
  async getActiveIndividualSubmission(
    projectId: string,
    studentId: string
  ): Promise<Submission | null> {
    const { data, error } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', projectId)
      .eq('student_id', studentId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Checks whether an active submission already exists for a group
   */
  async getActiveGroupSubmission(
    projectId: string,
    groupId: string
  ): Promise<Submission | null> {
    const { data, error } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', projectId)
      .eq('group_id', groupId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Records an audit event
   */
  async logAuditEvent(entry: {
    actorId?: string;
    actorTelegramId?: number;
    actorRole?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.client.from('audit_logs').insert({
      actor_id: entry.actorId,
      actor_telegram_id: entry.actorTelegramId,
      actor_role: entry.actorRole,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      metadata: entry.metadata || {},
    });
  }
}
