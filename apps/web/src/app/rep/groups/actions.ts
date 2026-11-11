// HU-ASMS: Representative Group Pre-Creation Server Action (Phase 12)
// Strictly enforces Phase 08 group management invariants: capacity bounds, section scope, and pending status

'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { assertRateLimit } from '../../../lib/security/rate-limiter';
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
      assertRateLimit('rep-group:unauth', 15, 60000, 'project group creation');
      return { success: false, error: 'Authentication required.' };
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
