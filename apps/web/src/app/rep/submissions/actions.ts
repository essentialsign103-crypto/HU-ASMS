// HU-ASMS: Secure Signed URL Generator for Private Storage Vault
'use server';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { assertDistributedRateLimit } from '../../../lib/security/rate-limiter';
import { validateUuidIdentifier } from '../../../lib/rep/input-validation';
import {
  executeGetSubmissionFileDownloadUrl,
  type SignedUrlResult,
} from '../../../lib/rep/submission-file-service';

export type { SignedUrlResult };

/**
 * Generates a short-lived (15-minute) signed download URL for an authorized representative.
 */
export async function getSubmissionFileDownloadUrl(
  submissionFileId: string
): Promise<SignedUrlResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);
    if (!context || !context.profile) {
      await assertDistributedRateLimit('web:signed-url:unauth', 15, 60000, 'file download URL generation');
      return { error: 'Authentication required.' };
    }
    await assertDistributedRateLimit(`web:signed-url:${context.userId}`, 30, 60000, 'file download URL generation');
    const uuidError = validateUuidIdentifier(submissionFileId, 'submission file');
    if (uuidError) {
      return { error: uuidError };
    }
    return executeGetSubmissionFileDownloadUrl(supabase, context, submissionFileId);
  } catch (err: any) {
    return { error: err.message || 'Unauthorized access to submission file.' };
  }
}
