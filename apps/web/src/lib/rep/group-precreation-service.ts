// HU-ASMS: Representative Group Pre-Creation Service (Phase 12 / Track B Local Hardening)
// Strictly enforces Phase 08 group management invariants: capacity bounds, section scope, pending status,
// and single active/pending group membership matching PostgreSQL trigger `enforce_single_group_per_project`.
// Architectural Limitation: `groups`, `group_members`, and `audit_logs` execute via sequential PostgREST calls
// with compensating delete on partial failure; full transaction atomicity requires a dedicated RPC.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertRepresentativeSectionScope,
  getActiveAssignedSectionIds,
  isRepresentativeRole,
  isSystemOwnerRole,
  type UserSessionContext,
} from '../auth/roles';
import { assertRateLimit } from '../security/rate-limiter';
import { writeScopedAuditLog } from './audit-helper';
import { validateGroupCreationUuids } from './input-validation';

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

function isProjectTargetedToSection(
  targets: Array<{ academic_year_id?: string | null; section_id?: string | null }> | null | undefined,
  sectionId: string,
  sectionAcademicYearId: string
): boolean {
  if (!Array.isArray(targets) || targets.length === 0) {
    return false;
  }
  return targets.some(
    (t) =>
      t.section_id === sectionId ||
      ((t.section_id === null || t.section_id === undefined) &&
        t.academic_year_id === sectionAcademicYearId)
  );
}

async function compensateCreatedGroup(
  supabase: SupabaseClient,
  groupId: string
): Promise<boolean> {
  try {
    const client = supabase as any;
    const tableApi = client?.from?.('groups');
    if (typeof tableApi?.delete !== 'function') {
      return false;
    }
    const res = await tableApi.delete().eq('id', groupId);
    return !res?.error;
  } catch {
    return false;
  }
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

    if (context.profile.is_active !== true) {
      return { success: false, error: 'Forbidden: Active staff profile required.' };
    }

    const isVerifiedOwner = context.isOwner && isSystemOwnerRole(context.profile.role);
    const isVerifiedRep =
      context.isRepresentative && isRepresentativeRole(context.profile.role);

    if (!isVerifiedOwner && !isVerifiedRep) {
      return { success: false, error: 'Forbidden: Representative privileges required.' };
    }

    if (!isVerifiedOwner && getActiveAssignedSectionIds(context).length === 0) {
      return {
        success: false,
        error: 'Forbidden: No active section assignment is configured for your account.',
      };
    }

    assertRateLimit(`rep-group:${context.userId}`, 20, 60000, 'project group creation');

    const uuidError = validateGroupCreationUuids(input);
    if (uuidError) {
      return { success: false, error: uuidError };
    }

    const cleanSectionId = input.sectionId.trim();
    const cleanProjectId = input.projectId.trim();
    const cleanLeaderId = input.leaderStudentId.trim();
    const cleanMemberIds = input.memberStudentIds.map((id) => id.trim());

    // 1. Strict Scope Assertion: Rep must be assigned to this section
    assertRepresentativeSectionScope(context, cleanSectionId);

    if (!input.groupCode || input.groupCode.trim().length === 0) {
      return { success: false, error: 'Group code/number is required.' };
    }

    const trimmedCode = input.groupCode.trim();
    if (trimmedCode.length > 50) {
      return { success: false, error: 'Group code/number must be 50 characters or fewer.' };
    }

    if (new Set(cleanMemberIds).size !== cleanMemberIds.length) {
      return {
        success: false,
        error: 'Duplicate student identifiers are not allowed in group membership.',
      };
    }

    // 2. Verify section exists and resolve academic_year_id for target checks
    const { data: section, error: secErr } = await supabase
      .from('sections')
      .select('id, academic_year_id')
      .eq('id', cleanSectionId)
      .single();

    if (secErr || !section) {
      return { success: false, error: 'Academic section record not found.' };
    }

    // 3. Fetch project, file rules, and targets
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('*, file_rules:project_file_rules(*), targets:project_targets(academic_year_id, section_id)')
      .eq('id', cleanProjectId)
      .single();

    if (projErr || !project) {
      return { success: false, error: 'Project record not found.' };
    }

    if (project.is_active === false) {
      return { success: false, error: 'Cannot create groups for an inactive project.' };
    }

    if (project.submission_type !== 'group' && project.submission_type !== 'both') {
      return { success: false, error: 'This project does not accept group submissions.' };
    }

    if (!isProjectTargetedToSection(project.targets, cleanSectionId, section.academic_year_id)) {
      return {
        success: false,
        error: 'Security Violation: Project is not targeted to the specified academic section.',
      };
    }

    // 4. Check group capacity bounds
    const fileRules = Array.isArray(project.file_rules)
      ? project.file_rules[0]
      : project.file_rules;
    // Align missing-rule defaults with bot `group.service.ts` and PostgreSQL triggers (min=2, max=10).
    const minSize = fileRules?.min_group_size ?? 2;
    const maxSize = fileRules?.max_group_size ?? 10;

    if (cleanMemberIds.length < minSize || cleanMemberIds.length > maxSize) {
      return {
        success: false,
        error: `Group size violation: Must assign between ${minSize} and ${maxSize} members. Received ${cleanMemberIds.length}.`,
      };
    }

    // 5. Verify leader is included in members
    if (!cleanMemberIds.includes(cleanLeaderId)) {
      return { success: false, error: 'The designated group leader must be included in the assigned members list.' };
    }

    // 6. Check duplicate group code within this project and section
    const { data: existingGroup, error: existingGrpErr } = await supabase
      .from('groups')
      .select('id')
      .eq('project_id', cleanProjectId)
      .eq('section_id', cleanSectionId)
      .eq('group_code', trimmedCode)
      .maybeSingle();

    if (existingGrpErr) {
      return { success: false, error: `Failed to verify group uniqueness: ${existingGrpErr.message}` };
    }

    if (existingGroup) {
      return {
        success: false,
        error: `Group "${trimmedCode}" already exists for this project in your section. Group numbers must be unique per section.`,
      };
    }

    // 7. Verify all members belong to this section and have an approved/locked identity
    const { data: enrolledStudents, error: studErr } = await supabase
      .from('students')
      .select('id, section_id, registration_status, full_name')
      .in('id', cleanMemberIds);

    if (studErr || !enrolledStudents || enrolledStudents.length !== cleanMemberIds.length) {
      return { success: false, error: 'One or more assigned students could not be found.' };
    }

    for (const student of enrolledStudents) {
      if (student.section_id !== cleanSectionId) {
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
      if (student.registration_status !== 'approved' && student.registration_status !== 'locked') {
        return {
          success: false,
          error: `Unapproved student violation: Student "${student.full_name}" does not have an approved academic identity.`,
        };
      }
    }

    // 8. Verify single group per project rule matching PostgreSQL `enforce_single_group_per_project`:
    // Only 'pending' and 'confirmed' memberships conflict; 'declined' and 'removed' allow reassignment.
    const { data: existingMemberships, error: membershipErr } = await supabase
      .from('group_members')
      .select('student_id, confirmation_status, group:groups!inner(project_id, group_code)')
      .eq('group.project_id', cleanProjectId)
      .in('student_id', cleanMemberIds)
      .in('confirmation_status', ['pending', 'confirmed']);

    if (membershipErr) {
      return {
        success: false,
        error: `Failed to verify existing group memberships: ${membershipErr.message}`,
      };
    }

    if (existingMemberships && existingMemberships.length > 0) {
      const conflictingStudentId = existingMemberships[0].student_id;
      const conflictingStudent = enrolledStudents.find((s) => s.id === conflictingStudentId);
      return {
        success: false,
        error: `Student "${conflictingStudent?.full_name || 'Student'}" is already assigned to another group for this project.`,
      };
    }

    // 9. Create Group (Status: 'pending' until all members independently confirm)
    const { data: group, error: insertGroupErr } = await supabase
      .from('groups')
      .insert({
        project_id: cleanProjectId,
        section_id: cleanSectionId,
        group_code: trimmedCode,
        group_leader_id: cleanLeaderId,
        status: 'pending',
        created_by: context.profile.id,
      })
      .select()
      .single();

    if (insertGroupErr || !group) {
      return { success: false, error: `Failed to create group: ${insertGroupErr?.message}` };
    }

    // 10. Create Member Assignments (Status: 'pending')
    const membersToInsert = cleanMemberIds.map((studentId) => ({
      group_id: group.id,
      student_id: studentId,
      confirmation_status: 'pending',
      is_group_leader: studentId === cleanLeaderId,
    }));

    const { error: insertMembersErr } = await supabase
      .from('group_members')
      .insert(membersToInsert);

    if (insertMembersErr) {
      const rolledBack = await compensateCreatedGroup(supabase, group.id);
      return {
        success: false,
        error: rolledBack
          ? `Failed to assign group members: ${insertMembersErr.message} (group creation rolled back)`
          : `Failed to assign group members: ${insertMembersErr.message} (warning: orphaned group ${group.id} requires reconciliation)`,
      };
    }

    // 11. Audit Log
    try {
      await writeScopedAuditLog(supabase, {
        actorId: context.profile.id,
        actorRole: context.isOwner ? 'system_owner' : 'representative',
        action: 'GROUP_PRECREATED',
        entityType: 'group',
        entityId: group.id,
        metadata: {
          section_id: cleanSectionId,
          project_id: cleanProjectId,
          group_code: trimmedCode,
          members_count: cleanMemberIds.length,
        },
      });
    } catch (auditErr: any) {
      const rolledBack = await compensateCreatedGroup(supabase, group.id);
      const msg = auditErr?.message || 'Audit log recording failed.';
      return {
        success: false,
        error: rolledBack
          ? `${msg} (group creation rolled back)`
          : `${msg} (warning: un-audited group ${group.id} requires reconciliation)`,
      };
    }

    return { success: true, groupId: group.id };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unexpected group creation error.' };
  }
}
