// HU-ASMS: Representative Management & Scope Authorization Service (Phase 05)
import type { SupabaseClient } from '@hu-asms/database';
import type {
  Profile,
  RepresentativeAssignment,
  Student,
  Project,
  Group,
  Submission,
} from '@hu-asms/types';

export class UnauthorizedSectionScopeError extends Error {
  constructor(sectionId: string, telegramUserId: number) {
    super(`Access denied: Telegram user ${telegramUserId} is not authorized for section ${sectionId}.`);
    this.name = 'UnauthorizedSectionScopeError';
  }
}

export interface IndividualSubmissionReport {
  project: Project;
  totalEligibleStudents: number;
  submittedCount: number;
  missingCount: number;
  submittedStudents: Array<{
    student: Student;
    submittedAt: string;
    version: number;
    fileName: string;
    fileSizeBytes: number;
  }>;
  missingStudents: Student[];
}

export interface GroupSubmissionReport {
  project: Project;
  totalGroups: number;
  submittedGroupsCount: number;
  missingGroupsCount: number;
  submittedGroups: Array<{
    group: Group;
    submittedAt: string;
    submittedByStudentName: string;
    fileName: string;
    fileSizeBytes: number;
  }>;
  missingGroups: Array<{
    group: Group;
    pendingMembersCount: number;
    confirmedMembersCount: number;
  }>;
}

export class RepresentativeService {
  constructor(private client: SupabaseClient) {}

  /**
   * Retrieves the representative profile and all active assigned sections
   * strictly identified by their numeric Telegram account ID.
   */
  async getRepresentativeProfile(telegramUserId: number): Promise<{
    profile: Profile;
    assignments: RepresentativeAssignment[];
  } | null> {
    const { data: profile, error: profErr } = await this.client
      .from('profiles')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
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

  /**
   * Security Guard: Strictly asserts that the Telegram user has active
   * representative permissions for the targeted section.
   */
  async assertSectionScope(telegramUserId: number, sectionId: string): Promise<void> {
    const repData = await this.getRepresentativeProfile(telegramUserId);
    if (!repData) {
      throw new UnauthorizedSectionScopeError(sectionId, telegramUserId);
    }

    const hasAccess = repData.assignments.some(
      (a) => a.section_id === sectionId && a.is_active
    );

    if (!hasAccess) {
      throw new UnauthorizedSectionScopeError(sectionId, telegramUserId);
    }
  }

  /**
   * Lists all students enrolled in a section.
   * Enforces scope check: Representative must be assigned to this section.
   */
  async getSectionStudents(telegramUserId: number, sectionId: string): Promise<Student[]> {
    await this.assertSectionScope(telegramUserId, sectionId);

    const { data, error } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('section_id', sectionId)
      .order('full_name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Lists all academic projects targeted at a section.
   * Enforces scope check.
   */
  async getSectionProjects(telegramUserId: number, sectionId: string): Promise<Project[]> {
    await this.assertSectionScope(telegramUserId, sectionId);

    // Get section to know its academic year
    const { data: section } = await this.client
      .from('sections')
      .select('academic_year_id')
      .eq('id', sectionId)
      .single();

    if (!section) return [];

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
      .or(`academic_year_id.eq.${section.academic_year_id}`, { foreignTable: 'targets' })
      .or(`section_id.is.null,section_id.eq.${sectionId}`, { foreignTable: 'targets' })
      .order('deadline', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Generates a project submission report for an individual project.
   * Identifies submitted vs missing students with HU IDs.
   */
  async getIndividualSubmissionReport(
    telegramUserId: number,
    sectionId: string,
    projectId: string
  ): Promise<IndividualSubmissionReport> {
    await this.assertSectionScope(telegramUserId, sectionId);

    // 1. Fetch project details
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .select('*, course:courses(*), teacher:teachers(*), file_rules:project_file_rules(*)')
      .eq('id', projectId)
      .single();

    if (projErr || !project) throw new Error('Project not found.');

    // 2. Fetch all eligible students in section
    const students = await this.getSectionStudents(telegramUserId, sectionId);

    // 3. Fetch active submissions for this project and section
    const { data: submissions, error: subErr } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', projectId)
      .eq('section_id', sectionId)
      .eq('status', 'active');

    if (subErr) throw subErr;

    const subMap = new Map<string, (typeof submissions)[0]>();
    (submissions || []).forEach((sub) => {
      if (sub.student_id) {
        subMap.set(sub.student_id, sub);
      }
    });

    const submittedStudents: IndividualSubmissionReport['submittedStudents'] = [];
    const missingStudents: Student[] = [];

    students.forEach((student) => {
      const sub = subMap.get(student.id);
      if (sub) {
        const file = sub.files?.[0];
        submittedStudents.push({
          student,
          submittedAt: sub.created_at,
          version: sub.version,
          fileName: file?.original_filename || 'Unknown Document',
          fileSizeBytes: file?.file_size_bytes || 0,
        });
      } else {
        missingStudents.push(student);
      }
    });

    return {
      project,
      totalEligibleStudents: students.length,
      submittedCount: submittedStudents.length,
      missingCount: missingStudents.length,
      submittedStudents,
      missingStudents,
    };
  }

  /**
   * Generates a project submission report for a group project.
   * Identifies submitted vs missing groups with members and confirmation status.
   */
  async getGroupSubmissionReport(
    telegramUserId: number,
    sectionId: string,
    projectId: string
  ): Promise<GroupSubmissionReport> {
    await this.assertSectionScope(telegramUserId, sectionId);

    // 1. Fetch project details
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .select('*, course:courses(*), teacher:teachers(*), file_rules:project_file_rules(*)')
      .eq('id', projectId)
      .single();

    if (projErr || !project) throw new Error('Project not found.');

    // 2. Fetch all groups for this project and section with members
    const { data: groups, error: grpErr } = await this.client
      .from('groups')
      .select('*, leader:students!groups_group_leader_id_fkey(*), members:group_members(*, student:students(*))')
      .eq('project_id', projectId)
      .eq('section_id', sectionId)
      .order('group_code', { ascending: true });

    if (grpErr) throw grpErr;

    // 3. Fetch active submissions for this project and section
    const { data: submissions, error: subErr } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', projectId)
      .eq('section_id', sectionId)
      .eq('submission_type', 'group')
      .eq('status', 'active');

    if (subErr) throw subErr;

    const subMap = new Map<string, (typeof submissions)[0]>();
    (submissions || []).forEach((sub) => {
      if (sub.group_id) {
        subMap.set(sub.group_id, sub);
      }
    });

    const submittedGroups: GroupSubmissionReport['submittedGroups'] = [];
    const missingGroups: GroupSubmissionReport['missingGroups'] = [];

    (groups || []).forEach((group) => {
      const sub = subMap.get(group.id);
      if (sub) {
        const file = sub.files?.[0];
        submittedGroups.push({
          group,
          submittedAt: sub.created_at,
          submittedByStudentName: group.leader?.full_name || 'Group Submitter',
          fileName: file?.original_filename || 'Unknown Document',
          fileSizeBytes: file?.file_size_bytes || 0,
        });
      } else {
        const pendingCount = (group.members || []).filter(
          (m: any) => m.confirmation_status !== 'confirmed'
        ).length;
        const confirmedCount = (group.members || []).filter(
          (m: any) => m.confirmation_status === 'confirmed'
        ).length;

        missingGroups.push({
          group,
          pendingMembersCount: pendingCount,
          confirmedMembersCount: confirmedCount,
        });
      }
    });

    return {
      project,
      totalGroups: (groups || []).length,
      submittedGroupsCount: submittedGroups.length,
      missingGroupsCount: missingGroups.length,
      submittedGroups,
      missingGroups,
    };
  }
}
