// HU-ASMS: Representative Management Server Actions
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext, assertSystemOwner } from '../../../lib/auth/roles';
import { assertDistributedRateLimit } from '../../../lib/security/rate-limiter';
import {
  executeAssignRepresentative,
  executeDeactivateRepresentative,
  executeReassignRepresentative,
  type RepresentativeActionResult,
} from '../../../lib/admin/representative-management-service';

export async function assignRepresentativeAction(formData: FormData): Promise<void> {
  const rawStudentId = formData.get('studentId');
  const rawSectionId = formData.get('sectionId');
  const studentId = typeof rawStudentId === 'string' ? rawStudentId.trim() : '';
  const sectionId = typeof rawSectionId === 'string' ? rawSectionId.trim() : '';

  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-rep-manage:${context.userId}` : 'web:admin-rep-manage:unauth',
    20,
    60000,
    'representative assignment'
  );

  const result = await executeAssignRepresentative(supabase, context, {
    studentId,
    sectionId,
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to assign representative.');
  }

  revalidatePath('/admin/representatives');
  revalidatePath('/admin');
}

export async function deactivateRepresentativeAction(formData: FormData): Promise<void> {
  const rawAssignmentId = formData.get('assignmentId');
  const assignmentId = typeof rawAssignmentId === 'string' ? rawAssignmentId.trim() : '';

  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-rep-manage:${context.userId}` : 'web:admin-rep-manage:unauth',
    20,
    60000,
    'representative deactivation'
  );

  const result = await executeDeactivateRepresentative(supabase, context, assignmentId);

  if (!result.success) {
    throw new Error(result.error || 'Failed to deactivate representative.');
  }

  revalidatePath('/admin/representatives');
  revalidatePath('/admin');
}

export async function reassignRepresentativeAction(formData: FormData): Promise<void> {
  const rawAssignmentId = formData.get('assignmentId');
  const rawNewSectionId = formData.get('newSectionId');
  const assignmentId = typeof rawAssignmentId === 'string' ? rawAssignmentId.trim() : '';
  const newSectionId = typeof rawNewSectionId === 'string' ? rawNewSectionId.trim() : '';

  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  await assertDistributedRateLimit(
    context?.userId ? `web:admin-rep-manage:${context.userId}` : 'web:admin-rep-manage:unauth',
    20,
    60000,
    'representative reassignment'
  );

  const result = await executeReassignRepresentative(supabase, context, assignmentId, newSectionId);

  if (!result.success) {
    throw new Error(result.error || 'Failed to reassign representative.');
  }

  revalidatePath('/admin/representatives');
  revalidatePath('/admin');
}
