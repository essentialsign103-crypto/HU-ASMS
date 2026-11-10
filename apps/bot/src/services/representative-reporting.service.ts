// HU-ASMS: Representative Reporting & Monitoring Service (Phase 10)
// High-fidelity, section-isolated reporting on individual/group submissions, missing rosters, and team snapshots

import type { SupabaseClient } from '@hu-asms/database';
import type {
  Profile,
  RepresentativeAssignment,
  Student,
  Project,
  Group,
  Submission,
  SubmissionFile,
  SubmissionMember,
} from '@hu-asms/types';
import { UnauthorizedSectionScopeError } from './representative.service.js';

export interface SectionSummaryReport {
  sectionId: string;
  sectionName: string;
  academicYearName: string;
  totalStudentsEnrolled: number;
  totalActiveProjects: number;
  projectsSummary: Array<{
    projectId: string;
    projectTitle: string;
    submissionType: 'individual' | 'group' | 'both';
    deadline: string;
    isPastDeadline: boolean;
    submittedCount: number;
    totalExpectedCount: number;
    completionPercentage: number;
  }>;
}

export interface DetailedIndividualStudentReportItem {
  student: Student;
  submittedAt: string;
  version: number;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  submissionId: string;
  isResubmission: boolean;
}

export interface MissingStudentReportItem {
  student: Student;
  huStudentId: string;
  fullName: string;
  registrationStatus: string;
  isTelegramLinked: boolean;
}

export interface DetailedIndividualReport {
  project: Project;
  section: { id: string; name: string; academicYearName: string };
  totalEligibleStudents: number;
  submittedCount: number;
  missingCount: number;
  completionPercentage: number;
  isPastDeadline: boolean;
  submittedStudents: DetailedIndividualStudentReportItem[];
  missingStudents: MissingStudentReportItem[];
}

export interface DetailedGroupReportItem {
  group: Group;
  submittedAt: string;
  version: number;
  submittedByStudentName: string;
  submittedByHuStudentId: string;
  fileName: string;
  fileSizeBytes: number;
  submissionId: string;
  creditedMembers: Array<{
    studentId: string;
    huStudentId: string;
    studentName: string;
    isSubmitter: boolean;
  }>;
}

export interface MissingGroupReportItem {
  group: Group;
  groupCode: string;
  groupLeaderName: string;
  groupStatus: string;
  totalMembersCount: number;
  confirmedMembersCount: number;
  pendingMembersCount: number;
  declinedMembersCount: number;
  pendingMemberNames: string[];
  declinedMemberNames: string[];
}

export interface DetailedGroupReport {
  project: Project;
  section: { id: string; name: string; academicYearName: string };
  totalGroups: number;
  submittedGroupsCount: number;
  missingGroupsCount: number;
  completionPercentage: number;
  isPastDeadline: boolean;
  submittedGroups: DetailedGroupReportItem[];
  missingGroups: MissingGroupReportItem[];
}

export class RepresentativeReportingService {
  constructor(private client: SupabaseClient) {}

  /**
   * Retrieves the representative profile and active assigned sections.
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
   * Strictly asserts that the representative is authorized for the targeted section.
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
   * Generates a high-level summary report of all projects targeted to a section.
   */
  async getSectionSummaryReport(
    telegramUserId: number,
    sectionId: string
  ): Promise<SectionSummaryReport> {
    await this.assertSectionScope(telegramUserId, sectionId);

    // 1. Fetch section and academic year
    const { data: section, error: secErr } = await this.client
      .from('sections')
      .select('*, academic_year:academic_years(*)')
      .eq('id', sectionId)
      .single();

    if (secErr || !section) {
      throw new Error('Section record not found.');
    }

    // 2. Fetch enrolled students
    const { data: students, error: studErr } = await this.client
      .from('students')
      .select('id')
      .eq('section_id', sectionId);

    if (studErr) throw studErr;
    const totalStudents = (students || []).length;

    // 3. Fetch projects targeted to this section or academic year
    const { data: projects, error: projErr } = await this.client
      .from('projects')
      .select(`
        *,
        targets:project_targets!inner(*)
      `)
      .eq('is_active', true)
      .or(`academic_year_id.eq.${section.academic_year_id}`, { foreignTable: 'targets' })
      .or(`section_id.is.null,section_id.eq.${sectionId}`, { foreignTable: 'targets' })
      .order('deadline', { ascending: true });

    if (projErr) throw projErr;

    const now = new Date();
    const projectsSummary: SectionSummaryReport['projectsSummary'] = [];

    for (const proj of projects || []) {
      const isPastDeadline = now > new Date(proj.deadline);
      let submittedCount = 0;
      let expectedCount = totalStudents;

      if (proj.submission_type === 'individual') {
        const { count, error: countErr } = await this.client
          .from('submissions')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', proj.id)
          .eq('section_id', sectionId)
          .eq('submission_type', 'individual')
          .eq('status', 'active');

        if (!countErr && typeof count === 'number') {
          submittedCount = count;
        }
      } else {
        // Group or both: expected count is total groups in this section
        const { data: grps, error: grpErr } = await this.client
          .from('groups')
          .select('id')
          .eq('project_id', proj.id)
          .eq('section_id', sectionId);

        if (!grpErr && grps) {
          expectedCount = grps.length;
        }

        const { count, error: countErr } = await this.client
          .from('submissions')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', proj.id)
          .eq('section_id', sectionId)
          .eq('submission_type', 'group')
          .eq('status', 'active');

        if (!countErr && typeof count === 'number') {
          submittedCount = count;
        }
      }

      const completionPercentage = expectedCount > 0
        ? Math.round((submittedCount / expectedCount) * 100)
        : 0;

      projectsSummary.push({
        projectId: proj.id,
        projectTitle: proj.title,
        submissionType: proj.submission_type,
        deadline: proj.deadline,
        isPastDeadline,
        submittedCount,
        totalExpectedCount: expectedCount,
        completionPercentage,
      });
    }

    return {
      sectionId: section.id,
      sectionName: section.name,
      academicYearName: section.academic_year?.name || 'Academic Year',
      totalStudentsEnrolled: totalStudents,
      totalActiveProjects: (projects || []).length,
      projectsSummary,
    };
  }

  /**
   * Generates a detailed individual submission and missing roster report.
   */
  async getDetailedIndividualReport(
    telegramUserId: number,
    sectionId: string,
    projectId: string
  ): Promise<DetailedIndividualReport> {
    await this.assertSectionScope(telegramUserId, sectionId);

    // 1. Fetch project details
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .select('*, course:courses(*), teacher:teachers(*), file_rules:project_file_rules(*)')
      .eq('id', projectId)
      .single();

    if (projErr || !project) throw new Error('Project not found.');

    // 2. Fetch section details
    const { data: section, error: secErr } = await this.client
      .from('sections')
      .select('*, academic_year:academic_years(*)')
      .eq('id', sectionId)
      .single();

    if (secErr || !section) throw new Error('Section not found.');

    // 3. Fetch all enrolled students in section
    const { data: students, error: studErr } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('section_id', sectionId)
      .order('full_name', { ascending: true });

    if (studErr) throw studErr;
    const enrolledStudents = students || [];

    // 4. Fetch active submissions for this project and section
    const { data: submissions, error: subErr } = await this.client
      .from('submissions')
      .select('*, files:submission_files(*)')
      .eq('project_id', projectId)
      .eq('section_id', sectionId)
      .eq('submission_type', 'individual')
      .eq('status', 'active');

    if (subErr) throw subErr;

    const subMap = new Map<string, (typeof submissions)[0]>();
    (submissions || []).forEach((sub) => {
      if (sub.student_id) {
        subMap.set(sub.student_id, sub);
      }
    });

    const submittedStudents: DetailedIndividualStudentReportItem[] = [];
    const missingStudents: MissingStudentReportItem[] = [];

    enrolledStudents.forEach((student) => {
      const sub = subMap.get(student.id);
      if (sub) {
        const file = sub.files?.[0];
        submittedStudents.push({
          student,
          submittedAt: sub.created_at,
          version: sub.version || 1,
          fileName: file?.original_filename || 'Unknown Document',
          fileSizeBytes: file?.file_size_bytes || 0,
          mimeType: file?.mime_type || 'application/octet-stream',
          submissionId: sub.id,
          isResubmission: (sub.version || 1) > 1,
        });
      } else {
        missingStudents.push({
          student,
          huStudentId: student.hu_student_id,
          fullName: student.full_name,
          registrationStatus: student.registration_status,
          isTelegramLinked: Boolean(student.telegram_user_id),
        });
      }
    });

    const totalEligible = enrolledStudents.length;
    const submittedCount = submittedStudents.length;
    const missingCount = missingStudents.length;
    const completionPercentage = totalEligible > 0
      ? Math.round((submittedCount / totalEligible) * 100)
      : 0;

    return {
      project,
      section: {
        id: section.id,
        name: section.name,
        academicYearName: section.academic_year?.name || 'Academic Year',
      },
      totalEligibleStudents: totalEligible,
      submittedCount,
      missingCount,
      completionPercentage,
      isPastDeadline: new Date() > new Date(project.deadline),
      submittedStudents,
      missingStudents,
    };
  }

  /**
   * Generates a detailed group submission report with team snapshots and missing member breakdowns.
   */
  async getDetailedGroupReport(
    telegramUserId: number,
    sectionId: string,
    projectId: string
  ): Promise<DetailedGroupReport> {
    await this.assertSectionScope(telegramUserId, sectionId);

    // 1. Fetch project details
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .select('*, course:courses(*), teacher:teachers(*), file_rules:project_file_rules(*)')
      .eq('id', projectId)
      .single();

    if (projErr || !project) throw new Error('Project not found.');

    // 2. Fetch section details
    const { data: section, error: secErr } = await this.client
      .from('sections')
      .select('*, academic_year:academic_years(*)')
      .eq('id', sectionId)
      .single();

    if (secErr || !section) throw new Error('Section not found.');

    // 3. Fetch all pre-created groups in this section for this project
    const { data: groups, error: grpErr } = await this.client
      .from('groups')
      .select(`
        *,
        leader:students!groups_group_leader_id_fkey(*),
        members:group_members(*, student:students(*))
      `)
      .eq('project_id', projectId)
      .eq('section_id', sectionId)
      .order('group_code', { ascending: true });

    if (grpErr) throw grpErr;
    const sectionGroups = groups || [];

    // 4. Fetch active group submissions for this project and section
    const { data: submissions, error: subErr } = await this.client
      .from('submissions')
      .select(`
        *,
        files:submission_files(*),
        snapshots:submission_members(*)
      `)
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

    const submittedGroups: DetailedGroupReportItem[] = [];
    const missingGroups: MissingGroupReportItem[] = [];

    sectionGroups.forEach((group) => {
      const sub = subMap.get(group.id);
      if (sub) {
        const file = sub.files?.[0];
        const creditedMembers = (sub.snapshots || []).map((sn: any) => ({
          studentId: sn.student_id,
          huStudentId: sn.hu_student_id,
          studentName: sn.student_name,
          isSubmitter: Boolean(sn.is_submitter),
        }));

        submittedGroups.push({
          group,
          submittedAt: sub.created_at,
          version: sub.version || 1,
          submittedByStudentName: group.leader?.full_name || 'Group Submitter',
          submittedByHuStudentId: group.leader?.hu_student_id || 'UNKNOWN',
          fileName: file?.original_filename || 'Unknown Document',
          fileSizeBytes: file?.file_size_bytes || 0,
          submissionId: sub.id,
          creditedMembers,
        });
      } else {
        const members = group.members || [];
        const confirmedMembers = members.filter((m: any) => m.confirmation_status === 'confirmed');
        const pendingMembers = members.filter((m: any) => m.confirmation_status === 'pending');
        const declinedMembers = members.filter((m: any) => m.confirmation_status === 'declined');

        missingGroups.push({
          group,
          groupCode: group.group_code,
          groupLeaderName: group.leader?.full_name || 'No Leader Assigned',
          groupStatus: group.status,
          totalMembersCount: members.length,
          confirmedMembersCount: confirmedMembers.length,
          pendingMembersCount: pendingMembers.length,
          declinedMembersCount: declinedMembers.length,
          pendingMemberNames: pendingMembers.map((m: any) => m.student?.full_name || 'Unknown Student'),
          declinedMemberNames: declinedMembers.map((m: any) => m.student?.full_name || 'Unknown Student'),
        });
      }
    });

    const totalGroups = sectionGroups.length;
    const submittedCount = submittedGroups.length;
    const missingCount = missingGroups.length;
    const completionPercentage = totalGroups > 0
      ? Math.round((submittedCount / totalGroups) * 100)
      : 0;

    return {
      project,
      section: {
        id: section.id,
        name: section.name,
        academicYearName: section.academic_year?.name || 'Academic Year',
      },
      totalGroups,
      submittedGroupsCount: submittedCount,
      missingGroupsCount: missingCount,
      completionPercentage,
      isPastDeadline: new Date() > new Date(project.deadline),
      submittedGroups,
      missingGroups,
    };
  }

  /**
   * Generates a comprehensive structured JSON export of the section submission state.
   */
  async exportSectionReportJson(
    telegramUserId: number,
    sectionId: string,
    projectId: string
  ): Promise<Record<string, unknown>> {
    await this.assertSectionScope(telegramUserId, sectionId);

    const { data: project } = await this.client
      .from('projects')
      .select('submission_type')
      .eq('id', projectId)
      .single();

    if (!project) throw new Error('Project not found.');

    if (project.submission_type === 'individual') {
      const indReport = await this.getDetailedIndividualReport(telegramUserId, sectionId, projectId);
      return {
        exportedAt: new Date().toISOString(),
        reportType: 'individual',
        ...indReport,
      };
    } else {
      const grpReport = await this.getDetailedGroupReport(telegramUserId, sectionId, projectId);
      return {
        exportedAt: new Date().toISOString(),
        reportType: 'group',
        ...grpReport,
      };
    }
  }
}
