// HU-ASMS: Secure Signed URL Generator for Private Storage Vault
'use server';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext, assertRepresentativeSectionScope } from '../../../lib/auth/roles';

export interface SignedUrlResult {
  signedUrl?: string;
  error?: string;
}

/**
 * Generates a short-lived (15-minute) signed download URL for an authorized representative.
 */
export async function getSubmissionFileDownloadUrl(
  submissionFileId: string
): Promise<SignedUrlResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);

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
