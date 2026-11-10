// HU-ASMS: Representative Group Pre-Creation Service (Phase 12)
// Strictly enforces Phase 08 group management invariants: capacity bounds, section scope, and pending status

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertRepresentativeSectionScope, type UserSessionContext } from '../auth/roles';

export interface CreateProjectGroupInput {
  sectionId: string;
  projectId: string;
  groupCode: string;
  leaderStudentId: string;
  memberStudentIds: string[];
}

export interface CreateGroupResult {
  success: boolean;
  groupId?: string;
  error?: string;
}

export async function executeCreateProjectGroup(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  input: CreateProjectGroupInput
): Promise<CreateGroupResult> {
  try {
    if (!context || !context.profile) {
      return { success: false, error: 'Authentication required.' };
    }

    // 1. Strict Scope Assertion: Rep must be assigned to this section
    assertRepresentativeSectionScope(context, input.sectionId);

    if (!input.groupCode || input.groupCode.trim().length === 0) {
      return { success: false, error: 'Group code/number is required.' };
    }

    const trimmedCode = input.groupCode.trim();

    // 2. Fetch project and file rules
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('*, file_rules:project_file_rules(*)')
      .eq('id', input.projectId)
      .single();

    if (projErr || !project) {
      return { success: false, error: 'Project record not found.' };
    }

    if (project.submission_type !== 'group' && project.submission_type !== 'both') {
      return { success: false, error: 'This project does not accept group submissions.' };
    }

    // 3. Check group capacity bounds
    const minSize = project.file_rules?.min_group_size || 2;
    const maxSize = project.file_rules?.max_group_size || 5;

    if (input.memberStudentIds.length < minSize || input.memberStudentIds.length > maxSize) {
      return {
        success: false,
        error: `Group size violation: Must assign between ${minSize} and ${maxSize} members. Received ${input.memberStudentIds.length}.`,
      };
    }

    // 4. Verify leader is included in members
    if (!input.memberStudentIds.includes(input.leaderStudentId)) {
      return { success: false, error: 'The designated group leader must be included in the assigned members list.' };
    }

    // 5. Check duplicate group code within this project and section
    const { data: existingGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('project_id', input.projectId)
      .eq('section_id', input.sectionId)
      .eq('group_code', trimmedCode)
      .maybeSingle();

    if (existingGroup) {
      return {
        success: false,
        error: `Group "${trimmedCode}" already exists for this project in your section. Group numbers must be unique per section.`,
      };
    }

    // 6. Verify all members belong to this section and are approved
    const { data: enrolledStudents, error: studErr } = await supabase
      .from('students')
      .select('id, section_id, registration_status, full_name')
      .in('id', input.memberStudentIds);

    if (studErr || !enrolledStudents || enrolledStudents.length !== input.memberStudentIds.length) {
      return { success: false, error: 'One or more assigned students could not be found.' };
    }

    for (const student of enrolledStudents) {
      if (student.section_id !== input.sectionId) {
        return {
          success: false,
          error: `Cross-section violation: Student "${student.full_name}" is not enrolled in this section.`,
        };
      }
      if (student.registration_status === 'suspended') {
        return {
          success: false,
          error: `Suspended student violation: Student "${student.full_name}" is currently suspended.`,
        };
      }
    }

    // 7. Verify single group per project rule for each student
    const { data: existingMemberships } = await supabase
      .from('group_members')
      .select('student_id, group:groups!inner(project_id, group_code)')
      .eq('group.project_id', input.projectId)
      .in('student_id', input.memberStudentIds)
      .neq('confirmation_status', 'removed');

    if (existingMemberships && existingMemberships.length > 0) {
      const conflictingStudentId = existingMemberships[0].student_id;
      const conflictingStudent = enrolledStudents.find((s) => s.id === conflictingStudentId);
      return {
        success: false,
        error: `Student "${conflictingStudent?.full_name || 'Student'}" is already assigned to another group for this project.`,
      };
    }

    // 8. Create Group (Status: 'pending' until all members independently confirm)
    const { data: group, error: insertGroupErr } = await supabase
      .from('groups')
      .insert({
        project_id: input.projectId,
        section_id: input.sectionId,
        group_code: trimmedCode,
        group_leader_id: input.leaderStudentId,
        status: 'pending',
        created_by: context.profile.id,
      })
      .select()
      .single();

    if (insertGroupErr || !group) {
      return { success: false, error: `Failed to create group: ${insertGroupErr?.message}` };
    }

    // 9. Create Member Assignments (Status: 'pending')
    const membersToInsert = input.memberStudentIds.map((studentId) => ({
      group_id: group.id,
      student_id: studentId,
      confirmation_status: 'pending',
      is_group_leader: studentId === input.leaderStudentId,
    }));

    const { error: insertMembersErr } = await supabase
      .from('group_members')
      .insert(membersToInsert);

    if (insertMembersErr) {
      return { success: false, error: `Failed to assign group members: ${insertMembersErr.message}` };
    }

    // 10. Audit Log
    await supabase.from('audit_logs').insert({
      actor_id: context.profile.id,
      actor_role: 'representative',
      action: 'GROUP_PRECREATED',
      entity_type: 'group',
      entity_id: group.id,
      metadata: {
        section_id: input.sectionId,
        project_id: input.projectId,
        group_code: trimmedCode,
        members_count: input.memberStudentIds.length,
      },
    });

    return { success: true, groupId: group.id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unexpected group creation error.' };
  }
}
