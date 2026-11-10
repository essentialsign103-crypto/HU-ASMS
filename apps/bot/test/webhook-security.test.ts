// HU-ASMS: Phase 13 Telegram Webhook Security & Error Redaction Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyTelegramWebhookSecret,
  handleWebhookSecretGuard,
} from '../src/middleware/webhook-security.middleware.js';
import {
  formatSafeErrorMessage,
  sanitizeLogData,
} from '../src/utils/error-handler.js';

describe('Phase 13 — Webhook Security & Error Redaction Unit Tests', () => {
  const sampleSecret = 'a_very_secret_telegram_webhook_token_12345';

  describe('1. Webhook Secret Token Verification', () => {
    it('should validate matching secret token correctly', () => {
      const isValid = verifyTelegramWebhookSecret(sampleSecret, sampleSecret);
      assert.equal(isValid, true);
    });

    it('should reject mismatched secret token', () => {
      const isValid = verifyTelegramWebhookSecret('forged_token_attempt', sampleSecret);
      assert.equal(isValid, false);
    });

    it('should reject tokens of different lengths without throwing', () => {
      const isValid = verifyTelegramWebhookSecret('short', sampleSecret);
      assert.equal(isValid, false);
    });

    it('should reject undefined or empty tokens', () => {
      assert.equal(verifyTelegramWebhookSecret(undefined, sampleSecret), false);
      assert.equal(verifyTelegramWebhookSecret(sampleSecret, undefined), false);
      assert.equal(verifyTelegramWebhookSecret('', sampleSecret), false);
    });

    it('handleWebhookSecretGuard should authorize valid header with HTTP 200', () => {
      const req = {
        headers: {
          'x-telegram-bot-api-secret-token': sampleSecret,
        },
      };

      const result = handleWebhookSecretGuard(req, sampleSecret);
      assert.equal(result.authorized, true);
      assert.equal(result.statusCode, 200);
    });

    it('handleWebhookSecretGuard should reject missing header with HTTP 403', () => {
      const req = {
        headers: {},
      };

      const result = handleWebhookSecretGuard(req, sampleSecret);
      assert.equal(result.authorized, false);
      assert.equal(result.statusCode, 403);
      assert.match(result.error || '', /Missing X-Telegram-Bot-Api-Secret-Token/);
    });

    it('handleWebhookSecretGuard should return HTTP 500 if server secret is unconfigured', () => {
      const req = {
        headers: {
          'x-telegram-bot-api-secret-token': sampleSecret,
        },
      };

      const result = handleWebhookSecretGuard(req, undefined);
      assert.equal(result.authorized, false);
      assert.equal(result.statusCode, 500);
      assert.match(result.error || '', /is not configured on the server/);
    });
  });

  describe('2. Error Redaction & PII Protection', () => {
    it('should redact raw SQL errors and PostgreSQL constraint messages', () => {
      const sqlErr = new Error('syntax error at or near "SELECT" relation "students" does not exist');
      const safe = formatSafeErrorMessage(sqlErr);

      assert.equal(safe.errorCode, 'DATABASE_ERROR');
      assert.equal(safe.isOperational, false);
      assert.equal(safe.userMessage.includes('SELECT'), false);
      assert.equal(safe.userMessage.includes('students'), false);
      assert.match(safe.userMessage, /Database request failed/);
    });

    it('should redact raw network/storage connection failures', () => {
      const storageErr = new Error('ECONNREFUSED connect to storage.supabase.co:443');
      const safe = formatSafeErrorMessage(storageErr);

      assert.equal(safe.errorCode, 'STORAGE_UNAVAILABLE');
      assert.equal(safe.isOperational, false);
      assert.equal(safe.userMessage.includes('ECONNREFUSED'), false);
      assert.match(safe.userMessage, /University storage service is temporarily unreachable/);
    });

    it('should preserve known operational business errors with user guidance', () => {
      const domainErr = {
        message: 'Your group has already submitted this project. Resubmissions are disabled.',
        code: 'DUPLICATE_GROUP_SUBMISSION',
      };
      const safe = formatSafeErrorMessage(domainErr);

      assert.equal(safe.errorCode, 'DUPLICATE_GROUP_SUBMISSION');
      assert.equal(safe.isOperational, true);
      assert.equal(safe.userMessage, domainErr.message);
    });

    it('sanitizeLogData should redact sensitive keys in nested payloads', () => {
      const payload = {
        studentId: 'HU/10294/14',
        auth: {
          bot_token: '9200252077:AAE1qA9IPfSUuHm5h91RgYtahXvgBvucrQ0',
          apiKey: 'sb_publishable_secret_key',
        },
        meta: {
          telegram_bot_token: 'should_be_redacted',
          normalField: 'safe_value',
        },
      };

      const sanitized = sanitizeLogData(payload);

      assert.equal(sanitized.studentId, 'HU/10294/14');
      assert.equal(sanitized.auth.bot_token, '[REDACTED]');
      assert.equal(sanitized.auth.apiKey, '[REDACTED]');
      assert.equal(sanitized.meta.telegram_bot_token, '[REDACTED]');
      assert.equal(sanitized.meta.normalField, 'safe_value');
    });
  });
});
