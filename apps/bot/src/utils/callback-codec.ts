/**
 * HU-ASMS: Compact Stateless UUID <-> Base64URL Codec for Telegram Callback Data
 * 
 * Telegram Bot API imposes a strict 64-byte limit on callback_data in inline keyboard buttons.
 * Storing two 36-character UUIDs with a prefix generates 84+ bytes, causing Telegram to reject
 * the message with `400 Bad Request: BUTTON_DATA_INVALID`.
 * 
 * This module encodes 16-byte raw UUIDs into 22-character URL-safe Base64 strings.
 * Two UUIDs packed with a 3-character prefix format to exactly 48 bytes, well within the 64-byte limit.
 */

export function uuidToBase64Url(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID format for compact encoding: "${uuid}"`);
  }
  return Buffer.from(hex, 'hex').toString('base64url');
}

export function base64UrlToUuid(b64: string): string {
  const buf = Buffer.from(b64, 'base64url');
  if (buf.length !== 16) {
    throw new Error(`Invalid Base64URL UUID buffer length (expected 16 bytes, got ${buf.length})`);
  }
  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeReportCallback(sectionId: string, projectId: string): string {
  return `rr:${uuidToBase64Url(sectionId)}:${uuidToBase64Url(projectId)}`;
}

export function decodeReportCallback(data: string): { sectionId: string; projectId: string } | null {
  if (data.startsWith('rr:')) {
    const parts = data.slice(3).split(':');
    if (parts.length === 2) {
      try {
        return {
          sectionId: base64UrlToUuid(parts[0]),
          projectId: base64UrlToUuid(parts[1]),
        };
      } catch {
        return null;
      }
    }
  }

  // Backward compatibility with legacy prefix if payload format is matched
  if (data.startsWith('rep_report_')) {
    const parts = data.replace('rep_report_', '').split('_');
    if (parts.length === 2) {
      return { sectionId: parts[0], projectId: parts[1] };
    }
  }

  return null;
}
