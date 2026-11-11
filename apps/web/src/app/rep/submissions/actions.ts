// HU-ASMS: Secure Signed URL Generator for Private Storage Vault
'use server';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { assertRateLimit } from '../../../lib/security/rate-limiter';
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
      assertRateLimit('signed-url:unauth', 15, 60000, 'file download URL generation');
      return { error: 'Authentication required.' };
    }
    return executeGetSubmissionFileDownloadUrl(supabase, context, submissionFileId);
  } catch (err: any) {
    return { error: err.message || 'Unauthorized access to submission file.' };
  }
}
