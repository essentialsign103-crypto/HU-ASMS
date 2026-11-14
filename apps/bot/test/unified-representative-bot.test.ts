// HU-ASMS: Phase 17 Unified Bot & 64-Byte Callback Codec Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  uuidToBase64Url,
  base64UrlToUuid,
  encodeReportCallback,
  decodeReportCallback,
} from '../src/utils/callback-codec.js';
import {
  getStudentMainMenuKeyboard,
  getRepresentativeMainMenuKeyboard,
  getUnifiedMainMenuKeyboard,
} from '../src/keyboards/main-menu.js';

describe('Phase 17 — Unified Bot Experience & 64-Byte Callback Data Codec', () => {
  describe('1. Compact UUID <-> Base64URL Callback Codec', () => {
    it('encodes any pair of 36-character UUIDs into <= 48 bytes (well within Telegram 64-byte limit)', () => {
      const sectionId = 'df5eeda6-5be0-403e-9c1c-daea73957750';
      const projectId = '33333333-3333-3333-3333-333333333322';

      const callbackData = encodeReportCallback(sectionId, projectId);
      const byteLength = Buffer.byteLength(callbackData, 'utf8');

      assert.equal(byteLength <= 64, true, `Callback data length ${byteLength} must not exceed 64 bytes`);
      assert.equal(byteLength, 48, `Expected exactly 48 bytes for 2 Base64URL-encoded UUIDs + prefix`);
      assert.match(callbackData, /^rr:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{22}$/);
    });

    it('round-trips section and project UUIDs accurately without loss', () => {
      const originalSectionId = 'c84ca904-5e24-4e7d-9dee-4fbd6d75da65';
      const originalProjectId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

      const encoded = encodeReportCallback(originalSectionId, originalProjectId);
      const decoded = decodeReportCallback(encoded);

      assert.notEqual(decoded, null);
      assert.equal(decoded?.sectionId, originalSectionId);
      assert.equal(decoded?.projectId, originalProjectId);
    });

    it('rejects invalid malformed UUIDs during encoding', () => {
      assert.throws(() => uuidToBase64Url('not-a-uuid'), /Invalid UUID/);
      assert.throws(() => uuidToBase64Url(''), /Invalid UUID/);
    });

    it('rejects corrupt Base64 strings during decoding', () => {
      assert.throws(() => base64UrlToUuid('too-short'), /Invalid Base64URL UUID buffer length/);
      assert.equal(decodeReportCallback('rr:corrupt:corrupt'), null);
      assert.equal(decodeReportCallback('random_garbage_string'), null);
    });

    it('maintains backward compatibility with legacy rep_report_ prefix', () => {
      const secId = '33333333-3333-3333-3333-333333333322';
      const projId = '44444444-4444-4444-4444-444444444444';
      const legacyData = `rep_report_${secId}_${projId}`;

      const decoded = decodeReportCallback(legacyData);
      assert.notEqual(decoded, null);
      assert.equal(decoded?.sectionId, secId);
      assert.equal(decoded?.projectId, projId);
    });
  });

  describe('2. Unified Main Menu Keyboards', () => {
    it('ordinary student receives only student buttons without representative portal button', () => {
      const studentKb = getUnifiedMainMenuKeyboard(false);
      const keyboardJson = JSON.stringify(studentKb);

      assert.match(keyboardJson, /👤 My Profile/);
      assert.match(keyboardJson, /📤 Submit Assignment/);
      assert.match(keyboardJson, /📜 Submission History/);
      assert.doesNotMatch(keyboardJson, /⭐ Representative Operations/);
    });

    it('representative student receives full student suite PLUS representative operations button', () => {
      const repKb = getUnifiedMainMenuKeyboard(true);
      const keyboardJson = JSON.stringify(repKb);

      // Asserts ordinary student capabilities are fully preserved:
      assert.match(keyboardJson, /👤 My Profile/);
      assert.match(keyboardJson, /📚 My Academic Information/);
      assert.match(keyboardJson, /📋 My Projects/);
      assert.match(keyboardJson, /👥 My Groups/);
      assert.match(keyboardJson, /📤 Submit Assignment/);
      assert.match(keyboardJson, /🚀 Submit Group Project/);
      assert.match(keyboardJson, /📜 Submission History/);
      assert.match(keyboardJson, /❓ Help & Support/);

      // Asserts additional representative permission button is present:
      assert.match(keyboardJson, /⭐ Representative Operations/);
    });

    it('representative portal menu provides quick return to student menu', () => {
      const repPortalKb = getRepresentativeMainMenuKeyboard();
      const keyboardJson = JSON.stringify(repPortalKb);

      assert.match(keyboardJson, /🏢 My Assigned Sections/);
      assert.match(keyboardJson, /📊 Submission Reports/);
      assert.match(keyboardJson, /📦 Forward to Teacher/);
      assert.match(keyboardJson, /🎓 Student Menu/);
    });
  });
});
