// HU-ASMS: Secure Submission File Signed URL Service
// Generates short-lived download URLs with pre-fetch authorization, UUID validation, and rate limiting

import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidUuid } from '@hu-asms/validation';
import {
  assertRepresentativeSectionScope,
  getActiveAssignedSectionIds,
  isRepresentativeRole,
  isSystemOwnerRole,
  type UserSessionContext,
} from '../auth/roles';
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

    if (context.profile.is_active !== true) {
      return { error: 'Forbidden: Active staff profile required.' };
    }

    const isVerifiedOwner = context.isOwner && isSystemOwnerRole(context.profile.role);
    const isVerifiedRep =
      context.isRepresentative && isRepresentativeRole(context.profile.role);

    if (!isVerifiedOwner && !isVerifiedRep) {
      return { error: 'Forbidden: Representative privileges required.' };
    }

    if (!isVerifiedOwner && getActiveAssignedSectionIds(context).length === 0) {
      return { error: 'Forbidden: No active section assignment is configured for your account.' };
    }

    assertRateLimit(
      `signed-url:${context.userId}`,
      30,
      60000,
      'file download URL generation'
    );

    if (!isValidUuid(submissionFileId)) {
      return { error: 'Invalid submission file identifier.' };
    }

    const cleanFileId = submissionFileId.trim();

    // 1. Fetch file record and parent submission
    const { data: file, error: fileErr } = await supabase
      .from('submission_files')
      .select('*, submission:submissions(*)')
      .eq('id', cleanFileId)
      .single();

    if (fileErr || !file) {
      return { error: 'Submission file record not found.' };
    }

    if (!file.submission || !file.submission.section_id) {
      return { error: 'Submission file is not linked to a valid submission section.' };
    }

    // 2. Strict Scope Assertion: Rep must be assigned to the submission's section
    assertRepresentativeSectionScope(context, file.submission.section_id);

    if (typeof file.storage_path !== 'string' || file.storage_path.trim().length === 0) {
      return { error: 'Submission file is missing a valid storage path.' };
    }

    // 3. Generate short-lived signed URL (900 seconds = 15 minutes)
    const { data: signedData, error: signErr } = await supabase.storage
      .from('submission-files-vault')
      .createSignedUrl(file.storage_path, 900);

    if (signErr || !signedData?.signedUrl) {
      return { error: `Failed to generate signed download URL: ${signErr?.message || 'Storage error'}` };
    }

    return { signedUrl: signedData.signedUrl };
  } catch (err: any) {
    return { error: err?.message || 'Unauthorized access to submission file.' };
  }
}
