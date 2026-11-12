// HU-ASMS: Centralized Error Redaction & Sensitive Data Protection (Phase 13)
// Prevents internal SQL, database schema names, stack traces, and credentials from reaching users

export interface SafeErrorOutput {
  userMessage: string;
  errorCode: string;
  isOperational: boolean;
}

const KNOWN_ERROR_CODES = new Set([
  'STUDENT_NOT_FOUND',
  'STUDENT_SUSPENDED',
  'ACCOUNT_LOCKED',
  'NOT_REGISTERED',
  'IDENTITY_TAKEN',
  'PROJECT_NOT_FOUND',
  'PROJECT_NOT_OPEN',
  'DEADLINE_EXCEEDED',
  'FILE_VALIDATION_FAILED',
  'FILE_DOWNLOAD_REQUIRED',
  'FILE_DOWNLOAD_FAILED',
  'INVALID_FILE',
  'STORAGE_UPLOAD_FAILED',
  'DATABASE_PERSISTENCE_FAILED',
  'DUPLICATE_SUBMISSION',
  'DUPLICATE_GROUP_SUBMISSION',
  'UNREGISTERED_STUDENT',
  'ACCOUNT_SUSPENDED',
  'NOT_ELIGIBLE_SCOPE',
  'INVALID_SUBMISSION_TYPE',
  'GROUP_NOT_FOUND',
  'GROUP_NOT_VERIFIED',
  'UNAUTHORIZED_SUBMITTER',
  'NOT_GROUP_MEMBER',
  'INVALID_GROUP_CODE',
  'GROUP_TOO_SMALL',
  'GROUP_TOO_LARGE',
  'GROUP_CAPACITY_VIOLATION',
  'CROSS_SECTION_VIOLATION',
  'ALREADY_IN_GROUP',
  'RATE_LIMIT_EXCEEDED',
  'FORBIDDEN',
  'UNAUTHORIZED',
]);

/**
 * Maps any error into a safe, user-friendly message, stripping SQL, stack traces,
 * and database internals.
 */
export function formatSafeErrorMessage(err: any): SafeErrorOutput {
  if (!err) {
    return {
      userMessage: '⚠️ An unexpected error occurred. Please try again.',
      errorCode: 'INTERNAL_ERROR',
      isOperational: false,
    };
  }

  // Handle known operational domain errors (SubmissionError, GroupSubmissionError, etc.)
  if (err.code && KNOWN_ERROR_CODES.has(err.code)) {
    return {
      userMessage: err.message,
      errorCode: err.code,
      isOperational: true,
    };
  }

  const rawMessage = String(err.message || err);

  // Check for database / PostgreSQL error leaks
  if (
    rawMessage.includes('violates') ||
    rawMessage.includes('foreign key') ||
    rawMessage.includes('unique constraint') ||
    rawMessage.includes('relation') ||
    rawMessage.includes('syntax error') ||
    rawMessage.includes('column') ||
    rawMessage.includes('PostgrestError')
  ) {
    return {
      userMessage: '⚠️ Database request failed. Please verify your input and try again.',
      errorCode: 'DATABASE_ERROR',
      isOperational: false,
    };
  }

  // Check for network / storage errors
  if (
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('ETIMEDOUT') ||
    rawMessage.includes('fetch failed') ||
    rawMessage.includes('Storage')
  ) {
    return {
      userMessage: '⚠️ University storage service is temporarily unreachable. Please retry shortly.',
      errorCode: 'STORAGE_UNAVAILABLE',
      isOperational: false,
    };
  }

  // Fallback generic safe message
  return {
    userMessage: '⚠️ Something went wrong while processing your request. Please try again later.',
    errorCode: 'UNHANDLED_ERROR',
    isOperational: false,
  };
}

/**
 * Redacts secrets, tokens, and credentials from log payloads.
 */
export function sanitizeLogData(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot[REDACTED]');
  }

  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sensitiveKeys = new Set([
    'password',
    'token',
    'bot_token',
    'secret',
    'service_role',
    'apikey',
    'authorization',
    'telegram_bot_token',
    'supabase_service_role_key',
  ]);

  if (Array.isArray(obj)) {
    return obj.map(sanitizeLogData);
  }

  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      cleaned[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      cleaned[key] = sanitizeLogData(val);
    } else {
      cleaned[key] = sanitizeLogData(val);
    }
  }

  return cleaned;
}
