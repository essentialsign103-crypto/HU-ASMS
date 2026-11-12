// HU-ASMS: Shared Submission Content Validation, Vault Upload & Rollback Helpers (Phase B)
import type { SupabaseClient } from '@hu-asms/database';
import { SYSTEM_CONSTANTS } from '@hu-asms/shared';
import {
  validateSubmissionFile,
  validateSubmissionFileContent,
  sanitizeFilename,
} from '@hu-asms/validation';
import { computeSha256Hex } from './telegram-file.js';

export interface SubmissionBinaryInput {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  telegramFileId?: string;
  buffer?: Buffer;
}

export type StorageUploaderFn = (
  bucket: string,
  path: string,
  fileData: Buffer | Uint8Array,
  mimeType: string
) => Promise<{ path: string; error?: unknown | null }>;

export type StorageRemoverFn = (path: string) => Promise<{ error: unknown }>;

export interface PreparedSubmissionBinary {
  buffer: Buffer;
  actualSizeBytes: number;
  checksumSha256: string;
  safeFilename: string;
  mimeType: string;
}

export interface ProjectFileRuleBounds {
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

export class SubmissionBinaryError extends Error {
  constructor(
    public code:
      | 'INVALID_FILE'
      | 'FILE_DOWNLOAD_REQUIRED'
      | 'STORAGE_UPLOAD_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'SubmissionBinaryError';
  }
}

/**
 * Validates file metadata AND downloaded file bytes (non-empty, magic-byte inspection,
 * anti-executable screening, byte-size bounds) and computes SHA-256 digest before upload.
 */
export function validateAndPrepareSubmissionBinary(
  file: SubmissionBinaryInput,
  rules: ProjectFileRuleBounds
): PreparedSubmissionBinary {
  const safeFilename = sanitizeFilename(file.originalFilename);

  const metaCheck = validateSubmissionFile({
    filename: safeFilename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    allowedExtensions: rules.allowedExtensions,
    allowedMimeTypes: rules.allowedMimeTypes,
    maxSizeBytes: rules.maxSizeBytes,
  });

  if (!metaCheck.valid) {
    throw new SubmissionBinaryError(
      'INVALID_FILE',
      metaCheck.error || 'File metadata validation failed.'
    );
  }

  if (!file.buffer || file.buffer.byteLength === 0) {
    throw new SubmissionBinaryError(
      'FILE_DOWNLOAD_REQUIRED',
      'Downloaded file content is required before persisting a submission.'
    );
  }

  const contentCheck = validateSubmissionFileContent({
    filename: safeFilename,
    mimeType: file.mimeType,
    content: file.buffer,
    maxSizeBytes: rules.maxSizeBytes,
  });

  if (!contentCheck.valid) {
    throw new SubmissionBinaryError(
      'INVALID_FILE',
      contentCheck.error || 'Uploaded file content failed security inspection.'
    );
  }

  return {
    buffer: file.buffer,
    actualSizeBytes: file.buffer.byteLength,
    checksumSha256: computeSha256Hex(file.buffer),
    safeFilename,
    mimeType: file.mimeType,
  };
}

/**
 * Uploads validated file bytes to the private Supabase storage bucket (`submission-files-vault`).
 * Always fails closed if upload fails.
 */
export async function uploadSubmissionToVault(
  client: SupabaseClient,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
  customUploader?: StorageUploaderFn
): Promise<string> {
  let uploadError: unknown = null;
  let storedPath = storagePath;

  const bucket = SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME;

  if (customUploader) {
    const res = await customUploader(bucket, storagePath, buffer, contentType);
    uploadError = res.error;
    if (res.path) storedPath = res.path;
  } else {
    const { data, error } = await client.storage.from(bucket).upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });
    uploadError = error;
    if (data?.path) storedPath = data.path;
  }

  if (uploadError) {
    const msg = uploadError instanceof Error ? uploadError.message : String((uploadError as any)?.message || uploadError);
    throw new SubmissionBinaryError(
      'STORAGE_UPLOAD_FAILED',
      `Failed to store submission file in vault: ${msg}`
    );
  }

  return storedPath;
}

/**
 * Removes an uploaded storage object if subsequent database writes abort, preventing orphans.
 */
export async function cleanupOrphanedVaultObject(
  client: SupabaseClient,
  storagePath: string,
  customRemover?: StorageRemoverFn
): Promise<boolean> {
  try {
    if (customRemover) {
      const res = await customRemover(storagePath);
      return !res?.error;
    }
    const bucketApi = (client as any)?.storage?.from?.(SYSTEM_CONSTANTS.STORAGE_BUCKET_NAME);
    if (typeof bucketApi?.remove === 'function') {
      const res = await bucketApi.remove([storagePath]);
      return !res?.error;
    }
    return false;
  } catch {
    return false;
  }
}
