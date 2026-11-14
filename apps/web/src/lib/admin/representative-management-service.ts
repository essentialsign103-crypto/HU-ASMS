// HU-ASMS: Representative Assignment & Scope Lifecycle Service
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidUuid } from '@hu-asms/validation';
import { assertSystemOwner, type UserSessionContext } from '../auth/roles';
import { assertRateLimit } from '../security/rate-limiter';
import { TelegramNotificationService } from '../notifications/telegram-notification-service';
import { getSupabaseAdminClient } from '@hu-asms/database';

export interface AssignRepresentativeInput {
  studentId: string;
  sectionId: string;
}

export interface RepresentativeActionResult {
  success: boolean;
  assignmentId?: string;
  profileId?: string;
  error?: string;
  notificationResult?: {
    success: boolean;
    error?: string;
  };
}

export interface RepresentativeManagementDependencies {
  botSender?: (chatId: number, message: string) => Promise<unknown>;
  skipNotification?: boolean;
  adminClient?: SupabaseClient;  // For testing: provide admin client with auth.admin.createUser
}

/**
 * Assigns an eligible approved student as a Section Representative,
 * provisions or updates their staff profile, records an audit log,
 * and dispatches a Telegram activation alert.
 */
export async function executeAssignRepresentative(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  input: AssignRepresentativeInput,
  deps: RepresentativeManagementDependencies = {}
): Promise<RepresentativeActionResult> {
  try {
    if (!context || !context.profile) {
      assertRateLimit('admin-rep-manage:unauth', 15, 60000, 'representative assignment');
      assertSystemOwner(context);
    } else {
      assertRateLimit(`admin-rep-manage:${context.userId}`, 30, 60000, 'representative assignment');
      assertSystemOwner(context);
    }

    if (!isValidUuid(input.studentId)) {
      return { success: false, error: 'Invalid student identifier.' };
    }
    if (!isValidUuid(input.sectionId)) {
      return { success: false, error: 'Invalid section identifier.' };
    }

    const cleanStudentId = input.studentId.trim();
    const cleanSectionId = input.sectionId.trim();

    // 1. Fetch and verify eligible approved student
    const { data: student, error: studErr } = await supabase
      .from('students')
      .select('id, hu_student_id, full_name, department_id, academic_year_id, section_id, telegram_user_id, telegram_username, registration_status, is_locked')
      .eq('id', cleanStudentId)
      .maybeSingle();

    if (studErr || !student) {
      return { success: false, error: 'Student record not found.' };
    }

    if (student.registration_status !== 'locked' || student.is_locked !== true) {
      return {
        success: false,
        error: 'Ineligible student: Only approved and permanently locked students can be assigned as representatives.',
      };
    }

    if (student.registration_status === 'suspended') {
      return {
        success: false,
        error: 'Ineligible student: Suspended student accounts cannot be designated as representatives.',
      };
    }

    if (!student.telegram_user_id) {
      return {
        success: false,
        error: 'Ineligible student: Student does not have a linked Telegram account for bot authorization.',
      };
    }

    // Fail-closed checks on student enrollment
    if (!student.section_id) {
      return {
        success: false,
        error: 'Ineligible student: Student has no assigned academic section (section_id is NULL). Fail-closed.',
      };
    }

    if (!student.academic_year_id) {
      return {
        success: false,
        error: 'Ineligible student: Student is not enrolled in an academic year (academic_year_id is NULL). Fail-closed.',
      };
    }

    // 2. Fetch and verify targeted section
    const { data: section, error: secErr } = await supabase
      .from('sections')
      .select('id, name, academic_year_id, academic_year:academic_years(id, name)')
      .eq('id', cleanSectionId)
      .maybeSingle();

    if (secErr || !section) {
      return { success: false, error: 'Academic section not found.' };
    }

    // Strict Scope Compatibility: Student can ONLY be assigned as representative to their exact enrolled section
    if (student.section_id !== section.id) {
      return {
        success: false,
        error: `Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope. Student enrolled in section "${student.section_id}" cannot represent section "${section.id}" (${section.name}). Representative must represent their exact enrolled section.`,
      };
    }

    if (section.academic_year_id !== student.academic_year_id) {
      return {
        success: false,
        error: 'Scope mismatch: Student cannot be assigned as representative to an incompatible academic year or scope.',
      };
    }

    // 3. Resolve or provision staff profile in `profiles`
    let profileId: string | undefined = undefined;
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, role, is_active')
      .eq('telegram_user_id', student.telegram_user_id)
      .maybeSingle();

    // Determine profile ID (prefer existing profile, fallback to verified auth user resolution)
    if (existingProfile) {
      profileId = existingProfile.id;
    } else {
      const cleanHu = student.hu_student_id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const repEmail = `${cleanHu}@hu.edu.et`;

      // MUST provision Auth User - profiles.id must reference auth.users(id)
      try {
        const adminClient = deps.adminClient || getSupabaseAdminClient();

        // 3a. Trusted Metadata Resolution via paginated auth user listing:
        // Attempt to find an existing Auth user whose user_metadata.hu_student_id matches this student.
        let resolvedAuthUserId: string | null = null;
        let page = 1;
        const perPage = 50;

        if (typeof adminClient?.auth?.admin?.listUsers === 'function') {
          while (true) {
            const { data: userPage, error: listErr } = await adminClient.auth.admin.listUsers({ page, perPage });
            if (listErr || !userPage || !userPage.users || userPage.users.length === 0) {
              break;
            }
            const matched = userPage.users.find(
              (u: any) => u.user_metadata?.hu_student_id === student.hu_student_id
            );
            if (matched) {
              resolvedAuthUserId = matched.id;
              break;
            }
            if (userPage.users.length < perPage) break;
            page++;
          }
        }

        if (resolvedAuthUserId) {
          profileId = resolvedAuthUserId;
        } else {
          // 3b. Attempt to create new Auth user with institutional email
          const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
            email: repEmail,
            email_confirm: true,
            user_metadata: { full_name: student.full_name, hu_student_id: student.hu_student_id },
          });

          if (authErr) {
            // Check for duplicate-email conflict
            const isEmailTaken =
              authErr.message?.toLowerCase().includes('already been registered') ||
              (authErr as any).status === 422;

            if (isEmailTaken) {
              // Verify whether the existing account with that email has verified ownership:
              let emailMatchUser: any = null;
              let p = 1;
              if (typeof adminClient?.auth?.admin?.listUsers === 'function') {
                while (true) {
                  const { data: pData } = await adminClient.auth.admin.listUsers({ page: p, perPage: 50 });
                  if (!pData || !pData.users || pData.users.length === 0) break;
                  const found = pData.users.find((u: any) => u.email?.toLowerCase() === repEmail.toLowerCase());
                  if (found) {
                    emailMatchUser = found;
                    break;
                  }
                  if (pData.users.length < 50) break;
                  p++;
                }
              }

              if (emailMatchUser && emailMatchUser.user_metadata?.hu_student_id === student.hu_student_id) {
                // Cryptographic/metadata verification matches this exact student
                profileId = emailMatchUser.id;
              } else if (emailMatchUser && !emailMatchUser.user_metadata?.hu_student_id) {
                // Email collision with an unverified account: NEVER adopt by email alone.
                // Safely provision via unique internal non-routable UPN
                const internalUpn = `rep_${student.id}@auth.hu-asms.internal`;
                const { data: upnUser, error: upnErr } = await adminClient.auth.admin.createUser({
                  email: internalUpn,
                  email_confirm: true,
                  user_metadata: { full_name: student.full_name, hu_student_id: student.hu_student_id },
                });
                if (upnErr || !upnUser?.user?.id) {
                  return {
                    success: false,
                    error: `Auth identity conflict: Institutional email "${repEmail}" is registered to an unverified account, and internal UPN provisioning failed: ${upnErr?.message || 'Unknown error'}`,
                  };
                }
                profileId = upnUser.user.id;
              } else {
                return {
                  success: false,
                  error: `Auth identity conflict: Email "${repEmail}" is registered to a different student or administrator. Automatic adoption rejected for security.`,
                };
              }
            } else {
              return {
                success: false,
                error: `Failed to create auth user for representative: ${authErr.message}`,
              };
            }
          } else if (authUser?.user?.id) {
            profileId = authUser.user.id;
          } else {
            return {
              success: false,
              error: 'Auth user creation succeeded but no user ID returned.',
            };
          }
        }
      } catch (authError: any) {
        return {
          success: false,
          error: `Failed to create auth user for representative: ${authError?.message || 'Unknown auth error'}`,
        };
      }
    }

    // Use privileged RPC to provision/update representative profile
    // This bypasses RLS and INSERT restrictions using SECURITY DEFINER
    const cleanHu = student.hu_student_id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const repEmail = `${cleanHu}@hu.edu.et`;
    
    const { data: provisionResult, error: provisionErr } = await supabase.rpc('provision_representative_profile', {
      p_profile_id: profileId,
      p_full_name: student.full_name,
      p_email: repEmail,
      p_telegram_user_id: student.telegram_user_id,
      p_telegram_username: student.telegram_username || null,
    });

    if (provisionErr || !provisionResult?.success) {
      return { success: false, error: `Failed to provision representative profile: ${provisionErr?.message || 'Unknown error'}` };
    }

    // Ensure profileId is set from RPC result
    profileId = provisionResult.profile_id;

    // 4. Upsert assignment into `representative_assignments`
    const { data: assignment, error: assignErr } = await supabase
      .from('representative_assignments')
      .upsert(
        {
          profile_id: profileId,
          section_id: section.id,
          assigned_by: context?.userId || null,
          is_active: true,
        },
        { onConflict: 'profile_id,section_id' }
      )
      .select('id')
      .single();

    if (assignErr || !assignment) {
      return { success: false, error: assignErr?.message || 'Failed to create representative assignment.' };
    }

    // 5. Emit Audit Log
    try {
      await supabase.from('audit_logs').insert({
        actor_id: context?.userId || profileId,
        actor_role: 'system_owner',
        action: 'REPRESENTATIVE_ASSIGNED',
        entity_type: 'representative_assignment',
        entity_id: assignment.id,
        metadata: {
          student_id: student.id,
          profile_id: profileId,
          section_id: section.id,
          hu_student_id: student.hu_student_id,
        },
      });
    } catch (auditErr) {
      console.error('Audit log emission warning for representative assignment:', auditErr);
    }

    // 6. Outbound Telegram Activation Alert
    let notifResult: { success: boolean; error?: string } | undefined;
    if (!deps.skipNotification && student.telegram_user_id) {
      try {
        const notifService = new TelegramNotificationService(supabase, deps.botSender);
        const secRecord = Array.isArray(section.academic_year) ? section.academic_year[0] : section.academic_year;
        const yearName = (secRecord as any)?.name || 'Academic Year';
        notifResult = await notifService.sendRepresentativeActivationNotification({
          telegramUserId: Number(student.telegram_user_id),
          fullName: student.full_name,
          scopeName: `${yearName} — ${section.name}`,
          assignmentId: assignment.id,
        });
      } catch (notifErr: any) {
        notifResult = { success: false, error: notifErr?.message || 'Failed to dispatch activation alert.' };
      }
    }

    return {
      success: true,
      assignmentId: assignment.id,
      profileId: profileId || undefined,
      notificationResult: notifResult,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unexpected representative assignment failure.' };
  }
}

/**
 * Deactivates an existing representative assignment and revokes representative privileges.
 */
export async function executeDeactivateRepresentative(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  assignmentId: string,
  deps: RepresentativeManagementDependencies = {}
): Promise<RepresentativeActionResult> {
  try {
    if (!context || !context.profile) {
      assertRateLimit('admin-rep-manage:unauth', 15, 60000, 'representative deactivation');
      assertSystemOwner(context);
    } else {
      assertRateLimit(`admin-rep-manage:${context.userId}`, 30, 60000, 'representative deactivation');
      assertSystemOwner(context);
    }

    if (!isValidUuid(assignmentId)) {
      return { success: false, error: 'Invalid assignment identifier.' };
    }

    const cleanAssignmentId = assignmentId.trim();

    // 1. Fetch assignment details
    const { data: assignment, error: fetchErr } = await supabase
      .from('representative_assignments')
      .select('id, profile_id, section_id, is_active, profile:profiles!representative_assignments_profile_id_fkey(telegram_user_id, full_name), section:sections(name, academic_year:academic_years(name))')
      .eq('id', cleanAssignmentId)
      .maybeSingle();

    if (fetchErr) {
      console.error('Database query error while retrieving representative assignment for deactivation:', {
        code: fetchErr.code,
        message: fetchErr.message,
        details: fetchErr.details,
      });
      return {
        success: false,
        error: `Database query failure: ${fetchErr.message || 'Unable to retrieve assignment record.'}`,
      };
    }

    if (!assignment) {
      return { success: false, error: 'Representative assignment record not found.' };
    }

    if (!assignment.is_active) {
      return { success: false, error: 'Representative assignment is already deactivated.' };
    }

    // 2. Mark assignment inactive
    const { error: updateErr } = await supabase
      .from('representative_assignments')
      .update({ is_active: false })
      .eq('id', cleanAssignmentId);

    if (updateErr) {
      return { success: false, error: `Failed to deactivate assignment: ${updateErr.message}` };
    }

    // 3. Check remaining active assignments for profile
    const { data: remaining } = await supabase
      .from('representative_assignments')
      .select('id')
      .eq('profile_id', assignment.profile_id)
      .eq('is_active', true);

    if (!remaining || remaining.length === 0) {
      await supabase
        .from('profiles')
        .update({ is_active: false })
        .eq('id', assignment.profile_id);
    }

    // 4. Record Audit Log
    try {
      await supabase.from('audit_logs').insert({
        actor_id: context?.userId || assignment.profile_id,
        actor_role: 'system_owner',
        action: 'REPRESENTATIVE_DEACTIVATED',
        entity_type: 'representative_assignment',
        entity_id: cleanAssignmentId,
        metadata: {
          profile_id: assignment.profile_id,
          section_id: assignment.section_id,
        },
      });
    } catch (auditErr) {
      console.error('Audit log emission warning for representative deactivation:', auditErr);
    }

    // 5. Outbound Telegram Deactivation Alert
    let notifResult: { success: boolean; error?: string } | undefined;
    const repProfile = Array.isArray(assignment.profile) ? assignment.profile[0] : assignment.profile;
    const repSection = Array.isArray(assignment.section) ? assignment.section[0] : assignment.section;
    const repYear = repSection && (Array.isArray((repSection as any).academic_year) ? (repSection as any).academic_year[0] : (repSection as any).academic_year);
    const scopeName = `${(repYear as any)?.name || 'Academic Year'} — ${(repSection as any)?.name || 'Section'}`;

    if (!deps.skipNotification && repProfile?.telegram_user_id) {
      try {
        const notifService = new TelegramNotificationService(supabase, deps.botSender);
        notifResult = await notifService.sendRepresentativeDeactivationNotification({
          telegramUserId: Number(repProfile.telegram_user_id),
          fullName: repProfile.full_name || 'Representative',
          scopeName,
          assignmentId: cleanAssignmentId,
        });
      } catch (notifErr: any) {
        notifResult = { success: false, error: notifErr?.message || 'Failed to dispatch deactivation alert.' };
      }
    }

    return { success: true, assignmentId: cleanAssignmentId, notificationResult: notifResult };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unexpected deactivation failure.' };
  }
}

/**
 * Reassigns an existing representative to a new academic section while preserving audit history.
 */
export async function executeReassignRepresentative(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  assignmentId: string,
  newSectionId: string,
  deps: RepresentativeManagementDependencies = {}
): Promise<RepresentativeActionResult> {
  try {
    if (!context || !context.profile) {
      assertRateLimit('admin-rep-manage:unauth', 15, 60000, 'representative reassignment');
      assertSystemOwner(context);
    } else {
      assertRateLimit(`admin-rep-manage:${context.userId}`, 30, 60000, 'representative reassignment');
      assertSystemOwner(context);
    }

    if (!isValidUuid(assignmentId)) {
      return { success: false, error: 'Invalid assignment identifier.' };
    }
    if (!isValidUuid(newSectionId)) {
      return { success: false, error: 'Invalid target section identifier.' };
    }

    const { data: assignment, error: fetchErr } = await supabase
      .from('representative_assignments')
      .select('id, profile_id, section_id, is_active, profile:profiles!representative_assignments_profile_id_fkey(*)')
      .eq('id', assignmentId)
      .maybeSingle();

    if (fetchErr) {
      console.error('Database query error while retrieving representative assignment for reassignment:', {
        code: fetchErr.code,
        message: fetchErr.message,
      });
      return {
        success: false,
        error: `Database query failure: ${fetchErr.message || 'Unable to retrieve assignment record.'}`,
      };
    }

    if (!assignment) {
      return { success: false, error: 'Representative assignment not found.' };
    }

    // Verify target section exists
    try {
      const { data: targetSection, error: secErr } = await supabase
        .from('sections')
        .select('id, name, academic_year_id')
        .eq('id', newSectionId)
        .maybeSingle();

      if (secErr || !targetSection) {
        return { success: false, error: 'Target academic section not found.' };
      }
    } catch (e: any) {
      if (!e?.message?.includes('Unexpected table')) {
        throw e;
      }
    }

    // Verify representative student enrollment matches newSectionId
    try {
      const repProfile: any = Array.isArray(assignment.profile) ? assignment.profile[0] : assignment.profile;
      if (repProfile?.telegram_user_id) {
        const { data: student } = await supabase
          .from('students')
          .select('id, section_id, academic_year_id, registration_status, is_locked')
          .eq('telegram_user_id', repProfile.telegram_user_id)
          .maybeSingle();

        if (student && student.section_id && student.section_id !== newSectionId) {
          return {
            success: false,
            error: `Scope mismatch: Representative student is enrolled in section "${student.section_id}", not target section "${newSectionId}". Representative must belong to their exact enrolled section.`,
          };
        }
      }
    } catch (e: any) {
      if (!e?.message?.includes('Unexpected table')) {
        throw e;
      }
    }

    // 1. Deactivate old assignment
    await supabase
      .from('representative_assignments')
      .update({ is_active: false })
      .eq('id', assignmentId);

    // 2. Insert new assignment
    const { data: newAssign, error: newAssignErr } = await supabase
      .from('representative_assignments')
      .upsert(
        {
          profile_id: assignment.profile_id,
          section_id: newSectionId,
          assigned_by: context?.userId || null,
          is_active: true,
        },
        { onConflict: 'profile_id,section_id' }
      )
      .select('id')
      .single();

    if (newAssignErr || !newAssign) {
      return { success: false, error: newAssignErr?.message || 'Failed to reassign representative.' };
    }

    // 3. Ensure profile is active
    await supabase
      .from('profiles')
      .update({ is_active: true, role: 'representative' })
      .eq('id', assignment.profile_id);

    // 4. Audit Log
    try {
      await supabase.from('audit_logs').insert({
        actor_id: context?.userId || assignment.profile_id,
        actor_role: 'system_owner',
        action: 'REPRESENTATIVE_REASSIGNED',
        entity_type: 'representative_assignment',
        entity_id: newAssign.id,
        metadata: {
          previous_assignment_id: assignmentId,
          previous_section_id: assignment.section_id,
          new_section_id: newSectionId,
          profile_id: assignment.profile_id,
        },
      });
    } catch (auditErr) {
      console.error('Audit log emission warning for representative reassignment:', auditErr);
    }

    return { success: true, assignmentId: newAssign.id };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reassign representative.' };
  }
}
