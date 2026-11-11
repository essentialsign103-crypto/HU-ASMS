// HU-ASMS: Secure Submission File Signed URL Service
// Generates short-lived download URLs with section-scope verification and rate limiting

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertRepresentativeSectionScope, type UserSessionContext } from '../auth/roles';
import { assertRateLimit } from '../security/rate-limiter';

export interface SignedUrlResult {
  signedUrl?: string;
  error?: string;
}

/**
 * Generates a short-lived (15-minute) signed download URL for an authorized representative or owner.
 */
export async function executeGetSubmissionFileDownloadUrl(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  submissionFileId: string
): Promise<SignedUrlResult> {
  try {
    if (!context || !context.profile) {
      return { error: 'Authentication required.' };
    }

    assertRateLimit(
      `signed-url:${context.userId}`,
      30,
      60000,
      'file download URL generation'
    );

    // 1. Fetch file record and parent submission
    const { data: file, error: fileErr } = await supabase
      .from('submission_files')
      .select('*, submission:submissions(*)')
      .eq('id', submissionFileId)
      .single();

    if (fileErr || !file) {
      return { error: 'Submission file record not found.' };
    }

    // 2. Strict Scope Assertion: Rep must be assigned to the submission's section
    assertRepresentativeSectionScope(context, file.submission.section_id);

    // 3. Generate short-lived signed URL (900 seconds = 15 minutes)
    const { data: signedData, error: signErr } = await supabase.storage
      .from('submission-files-vault')
      .createSignedUrl(file.storage_path, 900);

    if (signErr || !signedData?.signedUrl) {
      return { error: `Failed to generate signed download URL: ${signErr?.message || 'Storage error'}` };
    }

    return { signedUrl: signedData.signedUrl };
  } catch (err: any) {
    return { error: err.message || 'Unauthorized access to submission file.' };
  }
}
