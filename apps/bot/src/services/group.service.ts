// HU-ASMS: Group Management & Membership Verification Service (Phase 08)
// Handles pre-created groups, independent membership confirmation, and dynamic verification

import type { SupabaseClient } from '@hu-asms/database';
import type {
  Group,
  GroupMember,
  Student,
  Project,
} from '@hu-asms/types';
import { sanitizeHuStudentId } from '@hu-asms/validation';

export class GroupManagementError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'GroupManagementError';
  }
}

export interface CreateGroupDTO {
  projectId: string;
  sectionId: string;
  groupCode: string; // e.g. "Group 01"
  groupLeaderHuId?: string; // Leader / authorized submitter
  memberHuStudentIds: string[];
  createdByProfileId?: string;
}

export interface GroupDetailsWithMembers extends Group {
  project: Project;
  members: Array<GroupMember & { student: Student }>;
}

export class GroupManagementService {
  constructor(private client: SupabaseClient) {}

  /**
   * Creates a project group in the database before submissions begin.
   * Enforces:
   * 1. Project exists and allows group submissions.
   * 2. Project is targeted to the specified section.
   * 3. Group code is unique within (project_id, section_id).
   * 4. Member counts respect project min/max bounds.
   * 5. All member students are verified, registered, and belong to this section.
   * 6. A student cannot be in multiple groups for the same project.
   */
  async createGroup(dto: CreateGroupDTO): Promise<GroupDetailsWithMembers> {
    const groupCode = dto.groupCode.trim();
    if (!groupCode) {
      throw new GroupManagementError('Group code/name is required.', 'INVALID_GROUP_CODE');
    }

    // 1. Fetch and validate project
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .select('*, file_rules:project_file_rules(*), targets:project_targets(*)')
      .eq('id', dto.projectId)
      .maybeSingle();

    if (projErr || !project) {
      throw new GroupManagementError('Project not found.', 'PROJECT_NOT_FOUND');
    }

    if (project.submission_type === 'individual') {
      throw new GroupManagementError(
        'Project is configured for individual submissions only.',
        'INVALID_PROJECT_TYPE'
      );
    }

    // Verify project is targeted to this section
    const targets = project.targets || [];
    const isTargeted = targets.some(
      (t: any) => !t.section_id || t.section_id === dto.sectionId
    );
    if (!isTargeted) {
      throw new GroupManagementError(
        'Project is not targeted to the specified academic section.',
        'SECTION_NOT_TARGETED'
      );
    }

    // 2. Validate member capacity
    const fileRules = project.file_rules;
    const minSize = fileRules?.min_group_size ?? 2;
    const maxSize = fileRules?.max_group_size ?? 10;

    const uniqueHuIds = Array.from(new Set(dto.memberHuStudentIds.map(sanitizeHuStudentId)));
    if (uniqueHuIds.length < minSize) {
      throw new GroupManagementError(
        `Group has ${uniqueHuIds.length} member(s), but project requires at least ${minSize}.`,
        'GROUP_TOO_SMALL'
      );
    }
    if (uniqueHuIds.length > maxSize) {
      throw new GroupManagementError(
        `Group has ${uniqueHuIds.length} member(s), which exceeds project maximum of ${maxSize}.`,
        'GROUP_TOO_LARGE'
      );
    }

    // 3. Resolve and validate all member students
    const resolvedStudents: Student[] = [];
    for (const huId of uniqueHuIds) {
      const { data: student, error: studErr } = await this.client
        .from('students')
        .select('*')
        .eq('hu_student_id', huId)
        .maybeSingle();

      if (studErr || !student) {
        throw new GroupManagementError(
          `Student with HU ID "${huId}" not found in registered roster.`,
          'STUDENT_NOT_FOUND'
        );
      }

      if (student.registration_status !== 'approved' && student.registration_status !== 'locked') {
        throw new GroupManagementError(
          `Student "${student.full_name}" (${huId}) does not have an approved academic identity.`,
          'STUDENT_NOT_APPROVED'
        );
      }

      // Check section match
      if (student.section_id !== dto.sectionId) {
        throw new GroupManagementError(
          `Student "${student.full_name}" (${huId}) belongs to a different section and cannot be assigned cross-section.`,
          'CROSS_SECTION_FORBIDDEN'
        );
      }

      resolvedStudents.push(student);
    }

    // 4. Resolve group leader
    let leaderStudentId: string | null = null;
    if (dto.groupLeaderHuId) {
      const leaderHu = sanitizeHuStudentId(dto.groupLeaderHuId);
      const matchLeader = resolvedStudents.find((s) => s.hu_student_id === leaderHu);
      if (!matchLeader) {
        throw new GroupManagementError(
          `Designated group leader "${dto.groupLeaderHuId}" is not in the assigned member list.`,
          'LEADER_NOT_IN_MEMBERS'
        );
      }
      leaderStudentId = matchLeader.id;
    } else {
      leaderStudentId = resolvedStudents[0].id;
    }

    // 5. Check duplicate group code within this project and section
    const { data: existingGroup } = await this.client
      .from('groups')
      .select('id')
      .eq('project_id', dto.projectId)
      .eq('section_id', dto.sectionId)
      .eq('group_code', groupCode)
      .maybeSingle();

    if (existingGroup) {
      throw new GroupManagementError(
        `Group "${groupCode}" already exists for this project and section.`,
        'DUPLICATE_GROUP_CODE'
      );
    }

    // 6. Check that none of the students are already in an active group for this project
    for (const student of resolvedStudents) {
      const { data: existingMembership } = await this.client
        .from('group_members')
        .select('*, group:groups!inner(*)')
        .eq('student_id', student.id)
        .eq('group.project_id', dto.projectId)
        .neq('confirmation_status', 'removed')
        .maybeSingle();

      if (existingMembership) {
        throw new GroupManagementError(
          `Student "${student.full_name}" (${student.hu_student_id}) is already assigned to another group for this project.`,
          'STUDENT_ALREADY_IN_GROUP'
        );
      }
    }

    // 7. Insert Group master record (status begins as 'pending')
    const { data: group, error: insertGrpErr } = await this.client
      .from('groups')
      .insert({
        project_id: dto.projectId,
        section_id: dto.sectionId,
        group_code: groupCode,
        group_leader_id: leaderStudentId,
        status: 'pending',
        created_by: dto.createdByProfileId || null,
      })
      .select('*, project:projects(*)')
      .single();

    if (insertGrpErr) throw insertGrpErr;

    // 8. Insert Member records (confirmation_status begins as 'pending')
    const memberPayloads = resolvedStudents.map((s) => ({
      group_id: group.id,
      student_id: s.id,
      is_group_leader: s.id === leaderStudentId,
      confirmation_status: 'pending',
    }));

    const { data: members, error: insertMembersErr } = await this.client
      .from('group_members')
      .insert(memberPayloads)
      .select('*, student:students(*)');

    if (insertMembersErr) throw insertMembersErr;

    return {
      ...group,
      members: members || [],
    };
  }

  /**
   * Independent Membership Confirmation:
   * A student independently confirms or declines their membership in a group.
   * Strictly enforces that student can only confirm for themselves.
   */
  async confirmMembership(
    telegramUserId: number,
    groupId: string,
    action: 'confirmed' | 'declined',
    note?: string
  ): Promise<{
    membership: GroupMember;
    groupStatus: 'pending' | 'verified';
    isGroupVerified: boolean;
  }> {
    // 1. Resolve student by Telegram ID
    const { data: student, error: studErr } = await this.client
      .from('students')
      .select('id, full_name, hu_student_id')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();

    if (studErr || !student) {
      throw new GroupManagementError(
        'Student identity not found. Please register via /start.',
        'UNREGISTERED_STUDENT'
      );
    }

    // 2. Find member record for this student and group
    const { data: memberRecord, error: memErr } = await this.client
      .from('group_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('student_id', student.id)
      .maybeSingle();

    if (memErr || !memberRecord) {
      throw new GroupManagementError(
        'You are not assigned as a member of this group.',
        'NOT_GROUP_MEMBER'
      );
    }

    // 3. Update membership confirmation status
    const { data: updatedMember, error: updateErr } = await this.client
      .from('group_members')
      .update({
        confirmation_status: action,
        confirmed_at: new Date().toISOString(),
        notes: note || null,
      })
      .eq('id', memberRecord.id)
      .select('*, student:students(*)')
      .single();

    if (updateErr) throw updateErr;

    // 4. Re-evaluate group verification status
    // Fetch all members of this group
    const { data: allMembers } = await this.client
      .from('group_members')
      .select('confirmation_status')
      .eq('group_id', groupId);

    const membersList = allMembers || [];
    const totalCount = membersList.length;
    const confirmedCount = membersList.filter((m) => m.confirmation_status === 'confirmed').length;
    const anyDeclined = membersList.some((m) => m.confirmation_status === 'declined');

    let newStatus: 'pending' | 'verified' = 'pending';
    if (!anyDeclined && totalCount > 0 && confirmedCount === totalCount) {
      newStatus = 'verified';
    }

    await this.client
      .from('groups')
      .update({ status: newStatus })
      .eq('id', groupId);

    return {
      membership: updatedMember,
      groupStatus: newStatus,
      isGroupVerified: newStatus === 'verified',
    };
  }

  /**
   * Fetches all groups for a registered student with membership statuses
   */
  async getStudentGroups(telegramUserId: number): Promise<Array<{
    group: Group;
    project: Project;
    membership: GroupMember;
    allMembers: Array<GroupMember & { student: Student }>;
  }>> {
    const { data: student } = await this.client
      .from('students')
      .select('id')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();

    if (!student) return [];

    const { data: memberships, error } = await this.client
      .from('group_members')
      .select(`
        *,
        group:groups(
          *,
          project:projects(*),
          members:group_members(*, student:students(*))
        )
      `)
      .eq('student_id', student.id)
      .neq('confirmation_status', 'removed');

    if (error || !memberships) return [];

    return memberships.map((m: any) => ({
      group: m.group,
      project: m.group.project,
      membership: m,
      allMembers: m.group.members || [],
    }));
  }

  /**
   * Retrieves full group details by group ID
   */
  async getGroupDetails(groupId: string): Promise<GroupDetailsWithMembers | null> {
    const { data, error } = await this.client
      .from('groups')
      .select(`
        *,
        project:projects(*),
        members:group_members(*, student:students(*))
      `)
      .eq('id', groupId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }
}
