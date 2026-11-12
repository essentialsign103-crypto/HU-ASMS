// HU-ASMS: Representative Group Pre-Creation Server Action (Phase 12)
// Strictly enforces Phase 08 group management invariants: capacity bounds, section scope, and pending status

'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { assertDistributedRateLimit } from '../../../lib/security/rate-limiter';
import { validateGroupCreationUuids } from '../../../lib/rep/input-validation';
import {
  executeCreateProjectGroup,
  type CreateProjectGroupInput,
  type CreateGroupResult,
} from '../../../lib/rep/group-precreation-service';

export type { CreateProjectGroupInput, CreateGroupResult };

export async function createProjectGroup(
  input: CreateProjectGroupInput
): Promise<CreateGroupResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);
    if (!context || !context.profile) {
      await assertDistributedRateLimit('web:rep-group:unauth', 15, 60000, 'project group creation');
      return { success: false, error: 'Authentication required.' };
    }
    await assertDistributedRateLimit(`web:rep-group:${context.userId}`, 20, 60000, 'project group creation');
    const uuidError = validateGroupCreationUuids(input);
    if (uuidError) {
      return { success: false, error: uuidError };
    }
    const result = await executeCreateProjectGroup(supabase, context, input);
    if (result.success) {
      revalidatePath('/rep/groups');
      revalidatePath('/rep');
    }
    return result;
  } catch (err: any) {
    return { success: false, error: err.message || 'Rate limit exceeded.' };
  }
}
