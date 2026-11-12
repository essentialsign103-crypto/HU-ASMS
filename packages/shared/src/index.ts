// HU-ASMS: Shared Constants, UI Messages, and Formatters

export const SYSTEM_CONSTANTS = {
  UNIVERSITY_NAME: 'Haramaya University',
  SYSTEM_TITLE: 'Academic Submission Management System (HU-ASMS)',
  TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES: 20 * 1024 * 1024, // 20 MB Cloud Bot API getFile limit
  DEFAULT_MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB
  STORAGE_BUCKET_NAME: 'submission-files-vault',
  DEFAULT_ALLOWED_EXTENSIONS: ['pdf'],
  DEFAULT_ALLOWED_MIME_TYPES: ['application/pdf'],
};

/**
 * Resolves the effective submission file size ceiling in bytes, clamping any
 * project setting to the 20 MB Telegram Cloud Bot API `getFile` download limit.
 */
export function resolveEffectiveTelegramMaxFileSizeBytes(
  configuredBytes?: number | null
): number {
  const raw =
    typeof configuredBytes === 'number' && Number.isFinite(configuredBytes) && configuredBytes > 0
      ? configuredBytes
      : SYSTEM_CONSTANTS.DEFAULT_MAX_FILE_SIZE_BYTES;
  return Math.min(raw, SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES);
}

export const BOT_MESSAGES = {
  WELCOME_UNREGISTERED:
    `🎓 *Welcome to HU-ASMS*\n` +
    `*Haramaya University Academic Submission Management System*\n\n` +
    `This platform manages your academic submissions, individual assignments, and group projects.\n\n` +
    `To get started, please enter your official *HU Student ID* (e.g., \`HU/10294/14\` or \`HU-2024-001\`).`,

  REGISTRATION_WARNING:
    `⚠️ *Important Academic Identity Notice*\n\n` +
    `Please ensure that your university student ID, full name, department, academic year, and section are correct.\n\n` +
    `Your information will be stored in the university academic submission system. After administrator approval, your academic identity will be locked.\n\n` +
    `You cannot independently change your academic identity after approval. If you make a mistake, contact the System Owner.`,

  REGISTRATION_SUBMITTED:
    `✅ *Registration Submitted for Approval*\n\n` +
    `Your academic profile has been submitted to the System Administrator for verification.\n` +
    `You will receive a notification once your registration is approved.`,

  IDENTITY_LOCKED_NOTICE:
    `🔒 *Academic Identity Locked*\n\n` +
    `Your academic identity has been approved and permanently locked.\n` +
    `If you need to correct any details, please use the /support or /correction command to submit an owner-reviewed change request.`,

  ALREADY_SUBMITTED_GROUP: (groupCode: string, projectTitle: string) =>
    `⚠️ *Your group has already submitted this project.*\n\n` +
    `Group: *${groupCode}*\n` +
    `Project: *${projectTitle}*\n` +
    `Status: *Submitted*\n\n` +
    `Please contact your group representative if you believe this information is incorrect.`,

  ALREADY_SUBMITTED_INDIVIDUAL: (projectTitle: string) =>
    `⚠️ *You have already submitted an active file for this project.*\n\n` +
    `Project: *${projectTitle}*\n` +
    `Status: *Submitted*\n\n` +
    `If resubmissions are allowed for this project, a new upload will supersede your previous submission while preserving history.`,

  SUBMISSION_SUCCESS: (projectTitle: string, filename: string, scopeName: string) =>
    `🎉 *Submission Successfully Received!*\n\n` +
    `Project: *${projectTitle}*\n` +
    `Section: *${scopeName}*\n` +
    `File: \`${filename}\`\n` +
    `Timestamp: ${new Date().toUTCString()}\n\n` +
    `Your academic section representative has been automatically notified.`,

  UNAUTHORIZED_ACCESS:
    `⛔ *Access Denied*\n\n` +
    `You do not have permission to perform this action or access this academic section.`,
};

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDateUTC(dateString: string | Date): string {
  const d = typeof dateString === 'string' ? new Date(dateString) : dateString;
  return d.toUTCString();
}
