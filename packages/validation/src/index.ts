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

  if (options.sizeBytes > options.maxSizeBytes) {
    const maxMb = (options.maxSizeBytes / (1024 * 1024)).toFixed(1);
    const actualMb = (options.sizeBytes / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${actualMb} MB) exceeds maximum permitted limit of ${maxMb} MB.`,
    };
  }

  return { valid: true };
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
