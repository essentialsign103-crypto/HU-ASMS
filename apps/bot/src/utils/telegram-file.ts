// HU-ASMS: Real Telegram Bot API File Download & Integrity Utilities (Critical Blockers Phase B)
import { createHash } from 'node:crypto';
import type { Api } from 'grammy';
import { SYSTEM_CONSTANTS, resolveEffectiveTelegramMaxFileSizeBytes } from '@hu-asms/shared';

export class TelegramFileDownloadError extends Error {
  constructor(
    public code: 'FILE_DOWNLOAD_FAILED' | 'INVALID_FILE',
    message: string
  ) {
    super(message);
    this.name = 'TelegramFileDownloadError';
  }
}

export interface DownloadedTelegramFile {
  buffer: Buffer;
  sizeBytes: number;
  checksumSha256: string;
  telegramFilePath: string;
}

export interface DownloadTelegramFileOptions {
  api: Pick<Api, 'getFile'> & { token?: string };
  fileId: string;
  maxSizeBytes?: number;
  declaredSizeBytes?: number;
  botToken?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export function computeSha256Hex(content: Uint8Array | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function redactBotTokens(input: string, knownToken?: string): string {
  let out = input.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot[REDACTED]');
  if (knownToken && knownToken.length > 0) {
    out = out.split(knownToken).join('[REDACTED]');
  }
  return out;
}

function isSafeTelegramRelativePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  if (filePath.includes('..') || /^https?:\/\//i.test(filePath) || filePath.includes('\0')) {
    return false;
  }
  return /^[A-Za-z0-9_./-]+$/.test(filePath);
}

/**
 * Resolves a Telegram document via `getFile`, checks reported bounds before downloading,
 * streams/reads actual file bytes up to `maxSizeBytes`, rejects empty/oversized payloads,
 * and returns the binary buffer + SHA-256 digest without leaking bot tokens in errors.
 */
export async function downloadTelegramDocument(
  options: DownloadTelegramFileOptions
): Promise<DownloadedTelegramFile> {
  const {
    api,
    fileId,
    declaredSizeBytes,
    fetchFn = globalThis.fetch,
    timeoutMs = 25_000,
  } = options;

  const requestedMaxBytes =
    options.maxSizeBytes && options.maxSizeBytes > 0
      ? options.maxSizeBytes
      : SYSTEM_CONSTANTS.DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxSizeBytes = resolveEffectiveTelegramMaxFileSizeBytes(requestedMaxBytes);

  if (!fileId || typeof fileId !== 'string' || fileId.trim().length === 0) {
    throw new TelegramFileDownloadError('FILE_DOWNLOAD_FAILED', 'Missing Telegram file identifier.');
  }

  if (typeof declaredSizeBytes === 'number' && declaredSizeBytes > maxSizeBytes) {
    const actualMb = (declaredSizeBytes / (1024 * 1024)).toFixed(1);
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
    const telegramNote =
      requestedMaxBytes > SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES ||
      maxSizeBytes === SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES
        ? ' (Telegram Cloud Bot API downloads are capped at 20.0 MB)'
        : '';
    throw new TelegramFileDownloadError(
      'INVALID_FILE',
      `File size (${actualMb} MB) exceeds the ${maxMb} MB maximum upload limit${telegramNote}. Please compress or split your file and submit again.`
    );
  }

  const token = options.botToken || api.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim().length === 0) {
    throw new TelegramFileDownloadError(
      'FILE_DOWNLOAD_FAILED',
      'Telegram bot credentials unavailable to download submission file.'
    );
  }

  let fileMeta: Awaited<ReturnType<Api['getFile']>>;
  try {
    fileMeta = await api.getFile(fileId);
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new TelegramFileDownloadError(
      'FILE_DOWNLOAD_FAILED',
      `Failed to resolve file metadata from Telegram: ${redactBotTokens(raw, token)}`
    );
  }

  const telegramFilePath = fileMeta?.file_path;
  if (!telegramFilePath || !isSafeTelegramRelativePath(telegramFilePath)) {
    throw new TelegramFileDownloadError(
      'FILE_DOWNLOAD_FAILED',
      'Telegram did not return a valid downloadable file_path.'
    );
  }

  if (typeof fileMeta.file_size === 'number') {
    if (fileMeta.file_size <= 0) {
      throw new TelegramFileDownloadError(
        'INVALID_FILE',
        'Telegram reported an empty (0-byte) document.'
      );
    }
    if (fileMeta.file_size > maxSizeBytes) {
      const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
      throw new TelegramFileDownloadError(
        'INVALID_FILE',
        `Reported file size (${(fileMeta.file_size / (1024 * 1024)).toFixed(1)} MB) exceeds ${maxMb} MB limit.`
      );
    }
  }

  const cleanRelPath = telegramFilePath.replace(/^\/+/, '');
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${cleanRelPath}`;

  let response: Response;
  try {
    response = await fetchFn(downloadUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new TelegramFileDownloadError(
      'FILE_DOWNLOAD_FAILED',
      `Failed to download file bytes from Telegram: ${redactBotTokens(raw, token)}`
    );
  }

  if (!response.ok) {
    throw new TelegramFileDownloadError(
      'FILE_DOWNLOAD_FAILED',
      `Telegram file download failed with HTTP ${response.status}.`
    );
  }

  const headerLength = response.headers?.get?.('content-length');
  if (headerLength) {
    const parsedLen = Number(headerLength);
    if (Number.isFinite(parsedLen) && parsedLen > maxSizeBytes) {
      await response.body?.cancel?.().catch(() => {});
      const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
      throw new TelegramFileDownloadError(
        'INVALID_FILE',
        `Download Content-Length exceeds maximum ${maxMb} MB limit.`
      );
    }
  }

  let buffer: Buffer;
  if (response.body && typeof (response.body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxSizeBytes) {
          await reader.cancel().catch(() => {});
          const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
          throw new TelegramFileDownloadError(
            'INVALID_FILE',
            `Downloaded stream exceeded maximum permitted limit of ${maxMb} MB.`
          );
        }
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks, totalBytes);
    } catch (err: unknown) {
      if (err instanceof TelegramFileDownloadError) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      throw new TelegramFileDownloadError(
        'FILE_DOWNLOAD_FAILED',
        `Failed reading Telegram file stream: ${redactBotTokens(raw, token)}`
      );
    }
  } else {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxSizeBytes) {
      const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
      throw new TelegramFileDownloadError(
        'INVALID_FILE',
        `Downloaded payload exceeds maximum permitted limit of ${maxMb} MB.`
      );
    }
    buffer = Buffer.from(ab);
  }

  if (buffer.byteLength === 0) {
    throw new TelegramFileDownloadError(
      'INVALID_FILE',
      'Downloaded file content is empty (0 bytes).'
    );
  }

  return {
    buffer,
    sizeBytes: buffer.byteLength,
    checksumSha256: computeSha256Hex(buffer),
    telegramFilePath: cleanRelPath,
  };
}
