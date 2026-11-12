// HU-ASMS: Validation Utilities and Business Rules

/**
 * Normalizes and sanitizes a Haramaya University Student ID
 * Standard formats accepted: HU/12345/14, HU-2024-001, hu/12345/14, etc.
 */
export function sanitizeHuStudentId(id: string): string {
  if (!id) return '';
  return id.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Validates HU Student ID format
 * Haramaya University student IDs typically follow patterns like HU/XXXXX/YY or HU-YYYY-XXXX
 */
export function isValidHuStudentId(id: string): boolean {
  const sanitized = sanitizeHuStudentId(id);
  // Pattern 1: HU/12345/14 or UGR/12345/14
  const standardPattern = /^(HU|UGR)\/\d{3,6}\/\d{2}$/;
  // Pattern 2: HU-2024-001
  const dashPattern = /^HU-\d{4}-\d{3,5}$/;
  // Pattern 3: Generalized safe university ID pattern: starts with HU, letters/numbers separated by / or -
  const generalSafePattern = /^HU[\/-][A-Z0-9\/-]{4,20}$/;

  return (
    standardPattern.test(sanitized) ||
    dashPattern.test(sanitized) ||
    generalSafePattern.test(sanitized)
  );
}

export interface StudentRegistrationInput {
  hu_student_id: string;
  full_name: string;
  department_id: string;
  academic_year_id: string;
  section_id: string;
  telegram_user_id: number;
  telegram_username?: string | null;
  phone?: string | null;
}

export function validateStudentRegistration(input: StudentRegistrationInput): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!input.hu_student_id || !isValidHuStudentId(input.hu_student_id)) {
    errors.hu_student_id =
      'Invalid Haramaya University Student ID format. Example: HU/10294/14 or HU-2024-001';
  }

  if (!input.full_name || input.full_name.trim().length < 3) {
    errors.full_name = 'Full name must be at least 3 characters long.';
  }

  if (!input.department_id || input.department_id.trim().length === 0) {
    errors.department_id = 'Department selection is required.';
  }

  if (!input.academic_year_id || input.academic_year_id.trim().length === 0) {
    errors.academic_year_id = 'Academic year selection is required.';
  }

  if (!input.section_id || input.section_id.trim().length === 0) {
    errors.section_id = 'Section selection is required.';
  }

  if (!input.telegram_user_id || input.telegram_user_id <= 0) {
    errors.telegram_user_id = 'Invalid Telegram numeric account ID.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface FileValidationOptions {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

/**
 * Strictly verifies file uploads against project rules (Extension, MIME type, File size)
 */
export function validateSubmissionFile(options: FileValidationOptions): {
  valid: boolean;
  error?: string;
} {
  const ext = options.filename.split('.').pop()?.toLowerCase();
  if (!ext) {
    return { valid: false, error: 'File must have a valid extension.' };
  }

  const normalizedAllowedExts = options.allowedExtensions.map((e) =>
    e.toLowerCase().replace('.', '')
  );
  if (!normalizedAllowedExts.includes(ext)) {
    return {
      valid: false,
      error: `File format .${ext} is not allowed. Permitted formats: ${normalizedAllowedExts.map((e) => '.' + e).join(', ')}`,
    };
  }

  if (
    options.allowedMimeTypes.length > 0 &&
    !options.allowedMimeTypes.includes(options.mimeType)
  ) {
    return {
      valid: false,
      error: `File MIME type "${options.mimeType}" does not match project accepted formats.`,
    };
  }

  const effectiveMaxBytes = Math.min(options.maxSizeBytes, 20 * 1024 * 1024);
  if (options.sizeBytes > effectiveMaxBytes) {
    const maxMb = (effectiveMaxBytes / (1024 * 1024)).toFixed(1);
    const actualMb = (options.sizeBytes / (1024 * 1024)).toFixed(1);
    const telegramSuffix =
      options.maxSizeBytes > 20 * 1024 * 1024 || effectiveMaxBytes === 20 * 1024 * 1024
        ? ' (Telegram Bot API downloads are limited to 20.0 MB)'
        : '';
    return {
      valid: false,
      error: `File size (${actualMb} MB) exceeds maximum permitted limit of ${maxMb} MB${telegramSuffix}.`,
    };
  }

  return { valid: true };
}

/**
 * Sanitizes an uploaded filename to prevent directory traversal, control character
 * injection, and filesystem exploits.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'unnamed_file';

  // 1. Remove null bytes and non-printable control characters
  let clean = filename.replace(/[\x00-\x1F\x7F]/g, '');

  // 2. Remove directory paths and traversal components (../, ..\, /)
  clean = clean.replace(/(\.\.[\/\\])+/g, '');
  clean = clean.replace(/[/\\]+/g, '_');

  // 3. Remove illegal Windows and POSIX characters: < > : " | ? *
  clean = clean.replace(/[<>:"|?*]/g, '');

  // 4. Trim leading/trailing dots and spaces
  clean = clean.trim().replace(/^\.+|\.+$/g, '');

  // 5. Replace multi-spaces or multi-underscores
  clean = clean.replace(/[\s_]+/g, '_');

  if (!clean || clean.length === 0) {
    return 'submission_file';
  }

  // 6. Split extension and base to limit length to 100 chars
  const parts = clean.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()!;
    const base = parts.join('.');
    const truncatedBase = base.slice(0, 80);
    return `${truncatedBase}.${ext}`;
  }

  return clean.slice(0, 80);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string identifier strictly conforms to canonical UUID format.
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function validateGroupMembershipCapacity(
  currentMemberCount: number,
  minGroupSize: number,
  maxGroupSize: number
): { valid: boolean; error?: string } {
  if (currentMemberCount < minGroupSize) {
    return {
      valid: false,
      error: `Group has ${currentMemberCount} member(s), but project requires at least ${minGroupSize}.`,
    };
  }
  if (currentMemberCount > maxGroupSize) {
    return {
      valid: false,
      error: `Group has ${currentMemberCount} member(s), which exceeds project maximum of ${maxGroupSize}.`,
    };
  }
  return { valid: true };
}

export interface FileContentValidationOptions {
  filename: string;
  mimeType: string;
  content: Uint8Array;
  maxSizeBytes: number;
}

export interface FileContentValidationResult {
  valid: boolean;
  detectedType?: string;
  error?: string;
}

function startsWithBytes(buf: Uint8Array, prefix: number[]): boolean {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

function containsAsciiMarker(buf: Uint8Array, marker: string, maxScanBytes = 262144): boolean {
  const limit = Math.min(buf.length, maxScanBytes);
  const decoder = new TextDecoder('latin1');
  return decoder.decode(buf.subarray(0, limit)).includes(marker);
}

/**
 * Inspects actual downloaded file bytes against magic signatures, dangerous payloads,
 * byte-size bounds, and declared extension/MIME type to block spoofed or empty files.
 */
export function validateSubmissionFileContent(
  options: FileContentValidationOptions
): FileContentValidationResult {
  const { filename, mimeType, content, maxSizeBytes } = options;

  if (!content || content.byteLength === 0) {
    return {
      valid: false,
      error: 'Downloaded file content is empty (0 bytes).',
    };
  }

  if (content.byteLength > maxSizeBytes) {
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    const actualMb = (content.byteLength / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Downloaded file size (${actualMb} MB) exceeds maximum permitted limit of ${maxMb} MB.`,
    };
  }

  // Reject executable binaries, scripts, and HTML payloads regardless of extension
  if (
    startsWithBytes(content, [0x4d, 0x5a]) || // PE/MZ executable
    startsWithBytes(content, [0x7f, 0x45, 0x4c, 0x46]) || // ELF executable
    startsWithBytes(content, [0x23, 0x21]) || // Shell shebang (#!)
    startsWithBytes(content, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O / Java class
    startsWithBytes(content, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWithBytes(content, [0xfe, 0xed, 0xfa, 0xcf])
  ) {
    return {
      valid: false,
      error: 'Executable or binary script content is strictly prohibited.',
    };
  }

  const headText = new TextDecoder('utf-8', { fatal: false })
    .decode(content.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  if (
    headText.startsWith('<!doctype html') ||
    headText.startsWith('<html') ||
    headText.startsWith('<script') ||
    headText.startsWith('<?php')
  ) {
    return {
      valid: false,
      error: 'HTML or active script payloads cannot be submitted as academic documents.',
    };
  }

  const parts = filename.trim().split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  const normalizedMime = (mimeType || '').toLowerCase().trim();

  if (ext === 'pdf') {
    if (!startsWithBytes(content, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      return {
        valid: false,
        error: 'File content does not match a valid PDF signature (%PDF-).',
      };
    }
    if (normalizedMime && normalizedMime !== 'application/pdf') {
      return {
        valid: false,
        error: `Declared MIME type "${mimeType}" conflicts with PDF file signature.`,
      };
    }
    return { valid: true, detectedType: 'pdf' };
  }

  if (ext === 'zip' || ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
    if (!startsWithBytes(content, [0x50, 0x4b, 0x03, 0x04])) {
      return {
        valid: false,
        error: `File content does not match a valid ZIP/OOXML archive signature for .${ext}.`,
      };
    }

    if (ext === 'docx') {
      if (!containsAsciiMarker(content, 'word/') && !containsAsciiMarker(content, '[Content_Types].xml')) {
        return {
          valid: false,
          error: 'Archive content is missing required Word (.docx) OOXML structure.',
        };
      }
      return { valid: true, detectedType: 'docx' };
    }

    if (ext === 'xlsx') {
      if (!containsAsciiMarker(content, 'xl/') && !containsAsciiMarker(content, '[Content_Types].xml')) {
        return {
          valid: false,
          error: 'Archive content is missing required Excel (.xlsx) OOXML structure.',
        };
      }
      return { valid: true, detectedType: 'xlsx' };
    }

    if (ext === 'pptx') {
      if (!containsAsciiMarker(content, 'ppt/') && !containsAsciiMarker(content, '[Content_Types].xml')) {
        return {
          valid: false,
          error: 'Archive content is missing required PowerPoint (.pptx) OOXML structure.',
        };
      }
      return { valid: true, detectedType: 'pptx' };
    }

    return { valid: true, detectedType: 'zip' };
  }

  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
    if (!startsWithBytes(content, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
      return {
        valid: false,
        error: `File content does not match a valid legacy Office (.${ext}) binary signature.`,
      };
    }
    return { valid: true, detectedType: ext };
  }

  if (ext === 'png') {
    if (!startsWithBytes(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return {
        valid: false,
        error: 'File content does not match a valid PNG image signature.',
      };
    }
    return { valid: true, detectedType: 'png' };
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    if (!startsWithBytes(content, [0xff, 0xd8, 0xff])) {
      return {
        valid: false,
        error: 'File content does not match a valid JPEG image signature.',
      };
    }
    return { valid: true, detectedType: 'jpeg' };
  }

  if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json') {
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] === 0x00) {
        return {
          valid: false,
          error: `Binary null bytes detected inside .${ext} text submission.`,
        };
      }
    }
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
      if (ext === 'json') {
        JSON.parse(decoded);
      }
      return { valid: true, detectedType: ext };
    } catch {
      return {
        valid: false,
        error: `File content is not valid UTF-8${ext === 'json' ? '/JSON' : ''} text.`,
      };
    }
  }

  return {
    valid: false,
    error: `File type .${ext || 'unknown'} is not supported by content inspection.`,
  };
}
