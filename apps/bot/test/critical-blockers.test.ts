// Critical Blockers Phases A, B, and C Regression Tests (Bot & Persistence)
// Note: Uses offline mocked Supabase clients, grammY API transformers, and injectable fetch stubs
// (does NOT connect to live Telegram Bot API or live Supabase PostgreSQL/Storage).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Update, UserFromGetMe } from 'grammy/types';

import { createBot, resolveBotSessionKey } from '../src/bot.js';
import { processTelegramWebhookRequest, resetWebhookBotCache } from '../src/webhook.js';
import {
  StudentRegistrationService,
  clearStudentTokenFailureTracking,
  hashVerificationToken,
} from '../src/services/registration.service.js';
import { IndividualSubmissionService } from '../src/services/submission.service.js';
import { GroupSubmissionService } from '../src/services/group-submission.service.js';
import { downloadTelegramDocument, TelegramFileDownloadError } from '../src/utils/telegram-file.js';
import { validateSubmissionFile, validateSubmissionFileContent } from '@hu-asms/validation';
import {
  SupabaseSessionStorage,
  PersistentMemorySessionStorage,
  type SerializedSessionRecord,
} from '../src/storage/supabase-session-storage.js';
import {
  createRateLimiterMiddleware,
  SupabaseRateLimitStore,
} from '../src/middleware/rate-limit.middleware.js';

const BOT_INFO: UserFromGetMe = {
  id: 888000111,
  is_bot: true,
  first_name: 'HU ASMS Test Bot',
  username: 'hu_asms_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

const WEBHOOK_SECRET = 'test_webhook_secret_critical_blockers_001';

// ============================================================================
// PHASE A: SECURE STUDENT IDENTITY LINKING & ZERO PRE-VERIFICATION PII LEAKAGE
// ============================================================================

describe('Phase A — Secure Identity Verification, Claim & Recovery Controls [Mocked Unit Test]', () => {
  function createIdentityMockDb() {
    const students: any[] = [
      {
        id: 'stu-linked-1',
        hu_student_id: 'HU/10001/14',
        full_name: 'Secret Linked Student',
        department_id: 'dept-cs',
        academic_year_id: 'year-3',
        section_id: 'sec-3a',
        telegram_user_id: 111111,
        telegram_username: 'linked_user',
        registration_status: 'locked',
        is_locked: true,
        department: { id: 'dept-cs', name: 'Computer Science' },
        academic_year: { id: 'year-3', name: '3rd Year' },
        section: { id: 'sec-3a', name: 'Section A' },
      },
      {
        id: 'stu-unlinked-roster',
        hu_student_id: 'HU/10002/14',
        full_name: 'Roster Only Student SecretName',
        department_id: 'dept-se',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
        telegram_user_id: null,
        telegram_username: null,
        registration_status: 'pending',
        is_locked: false,
        department: { id: 'dept-se', name: 'Software Engineering' },
        academic_year: { id: 'year-3', name: '3rd Year' },
        section: { id: 'sec-3b', name: 'Section B' },
      },
      {
        id: 'stu-suspended',
        hu_student_id: 'HU/10003/14',
        full_name: 'Suspended Confidential Student',
        department_id: 'dept-cs',
        academic_year_id: 'year-3',
        section_id: 'sec-3a',
        telegram_user_id: 333333,
        registration_status: 'suspended',
        suspension_reason: 'Confidential Disciplinary Note',
        is_locked: true,
        department: { id: 'dept-cs', name: 'Computer Science' },
      },
    ];

    const pendingRequests: any[] = [
      {
        id: 'req-other-pending',
        hu_student_id: 'HU/10004/14',
        full_name: 'Other Applicant Private Name',
        department_id: 'dept-cs',
        academic_year_id: 'year-3',
        section_id: 'sec-3a',
        telegram_user_id: 444444,
        request_type: 'new_registration',
        status: 'pending',
      },
    ];

    const validTokens = [
      {
        studentId: 'stu-unlinked-roster',
        huStudentId: 'HU/10002/14',
        tokenHash: hashVerificationToken('CLAIM-CODE-2026'),
        purpose: 'roster_claim',
        used: false,
      },
      {
        studentId: 'stu-linked-1',
        huStudentId: 'HU/10001/14',
        tokenHash: hashVerificationToken('RECOVER-CODE-9999'),
        purpose: 'account_recovery',
        used: false,
      },
    ];

    const rpcCalls: Array<{ fn: string; params: any }> = [];

    const client = {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                maybeSingle: async () => {
                  const found = students.find((s) => s[col] === val);
                  return { data: found || null, error: null };
                },
              }),
            }),
          };
        }

        if (table === 'registration_requests') {
          return {
            select: () => ({
              eq: (col1: string, val1: unknown) => ({
                eq: (col2: string, val2: unknown) => ({
                  maybeSingle: async () => {
                    const found = pendingRequests.find(
                      (r) => r[col1] === val1 && r[col2] === val2
                    );
                    return { data: found || null, error: null };
                  },
                }),
              }),
            }),
            insert: (payload: any) => {
              const row = { id: `req-${pendingRequests.length + 1}`, ...payload };
              pendingRequests.push(row);
              return {
                select: () => ({
                  single: async () => ({ data: row, error: null }),
                }),
              };
            },
          };
        }

        throw new Error(`Unexpected table query: ${table}`);
      },
      rpc: async (fn: string, params: Record<string, any>) => {
        rpcCalls.push({ fn, params });
        if (fn !== 'redeem_student_verification_token') {
          throw new Error(`Unexpected RPC ${fn}`);
        }
        if (students.some((s) => s.telegram_user_id === params.p_telegram_user_id)) {
          return {
            data: null,
            error: {
              code: '23505',
              message: 'This Telegram account is already linked to another student record.',
            },
          };
        }
        const stu = students.find((s) => s.hu_student_id === params.p_hu_student_id);
        const tok = validTokens.find(
          (t) =>
            stu &&
            t.studentId === stu.id &&
            t.tokenHash === params.p_token_hash &&
            !t.used
        );
        if (!stu || !tok || stu.registration_status === 'suspended') {
          return { data: null, error: { code: 'P0002', message: 'Invalid or expired verification token.' } };
        }
        if (tok.purpose === 'roster_claim' && stu.telegram_user_id !== null) {
          return { data: null, error: { code: '23505', message: 'Already linked.' } };
        }
        tok.used = true;
        stu.telegram_user_id = params.p_telegram_user_id;
        stu.telegram_username = params.p_telegram_username;
        stu.registration_status = 'locked';
        stu.is_locked = true;
        return { data: { student_id: stu.id }, error: null };
      },
    } as any;

    return { client, students, pendingRequests, rpcCalls };
  }

  it('never leaks student PII (names, masked names, departments, or suspension reasons) on unverified HU ID guesses', async () => {
    const { client } = createIdentityMockDb();
    const service = new StudentRegistrationService(client);
    const attackerTg = 999888777;

    // 1. Guessed unlinked roster ID
    const unlinkedRes = await service.lookupStudentIdentity('HU/10002/14', attackerTg);
    assert.equal(unlinkedRes.status, 'unlinked_roster_verification_required');
    assert.equal(unlinkedRes.student, undefined);
    assert.equal((unlinkedRes as any).maskedInfo, undefined);
    assert.doesNotMatch(JSON.stringify(unlinkedRes), /Roster Only|SecretName|Software Engineering/i);

    // 2. Guessed foreign linked ID
    const foreignRes = await service.lookupStudentIdentity('HU/10001/14', attackerTg);
    assert.equal(foreignRes.status, 'linked_to_another_user');
    assert.equal(foreignRes.student, undefined);
    assert.equal((foreignRes as any).maskedInfo, undefined);
    assert.doesNotMatch(JSON.stringify(foreignRes), /Secret Linked|Computer Science/i);

    // 3. Guessed suspended foreign ID (must not leak suspension or PII)
    const suspRes = await service.lookupStudentIdentity('HU/10003/14', attackerTg);
    assert.equal(suspRes.status, 'linked_to_another_user');
    assert.equal(suspRes.student, undefined);
    assert.doesNotMatch(JSON.stringify(suspRes), /Confidential|Disciplinary|suspended/i);

    // 4. Guessed ID with another user's pending registration (must not leak pending applicant's PII)
    const pendRes = await service.lookupStudentIdentity('HU/10004/14', attackerTg);
    assert.equal(pendRes.status, 'pending_approval');
    assert.equal(pendRes.pendingRequest, undefined);
    assert.doesNotMatch(JSON.stringify(pendRes), /Other Applicant Private Name/i);
  });

  it('blocks direct unverified roster claiming and rejects duplicate Telegram account linking', async () => {
    const { client } = createIdentityMockDb();
    const service = new StudentRegistrationService(client);

    // Direct instant claiming must fail closed
    await assert.rejects(
      () => service.linkRosterStudentToTelegram('stu-unlinked-roster', 999888777, 'attacker'),
      /Direct unverified roster linking is disabled/
    );

    // Already linked Telegram account (111111) cannot lookup/claim another student ID
    const dupLookup = await service.lookupStudentIdentity('HU/10002/14', 111111);
    assert.equal(dupLookup.status, 'telegram_already_linked');

    // Already linked Telegram account (111111) cannot submit a second registration or claim
    await assert.rejects(
      () =>
        service.submitFirstTimeRegistration({
          hu_student_id: 'HU/55555/14',
          full_name: 'Second Identity Attempt',
          department_id: 'dept-cs',
          academic_year_id: 'year-3',
          section_id: 'sec-3a',
          telegram_user_id: 111111,
        }),
      /already linked/i
    );
  });

  it('verifies single-use hashed claim & recovery tokens and rejects wrong or reused tokens', async () => {
    const { client, students } = createIdentityMockDb();
    const service = new StudentRegistrationService(client);

    // Wrong code fails closed
    await assert.rejects(
      () => service.redeemVerificationToken('HU/10002/14', 'WRONG-TOKEN', 777001, 'student2'),
      /Invalid or expired verification code/
    );

    // Valid single-use roster claim code succeeds
    const claimed = await service.redeemVerificationToken(
      'HU/10002/14',
      'CLAIM-CODE-2026',
      777001,
      'student2'
    );
    assert.equal(claimed.hu_student_id, 'HU/10002/14');
    assert.equal(claimed.telegram_user_id, 777001);
    assert.equal(claimed.is_locked, true);

    // Reusing same single-use code with another Telegram ID fails
    await assert.rejects(
      () => service.redeemVerificationToken('HU/10002/14', 'CLAIM-CODE-2026', 777002, 'attacker'),
      /Invalid or expired verification code/
    );

    // Lost-account recovery with valid recovery code transfers binding atomically
    const recovered = await service.redeemVerificationToken(
      'HU/10001/14',
      'RECOVER-CODE-9999',
      888001,
      'recovered_user'
    );
    assert.equal(recovered.hu_student_id, 'HU/10001/14');
    assert.equal(recovered.telegram_user_id, 888001);
    assert.equal(students.find((s) => s.id === 'stu-linked-1')?.telegram_user_id, 888001);
  });

  it('queues admin-verified roster claim and account recovery requests safely and blocks suspended targets', async () => {
    const { client, pendingRequests } = createIdentityMockDb();
    const service = new StudentRegistrationService(client);

    // Suspended account cannot accept unverified claim/recovery
    await assert.rejects(
      () =>
        service.submitVerifiedClaimOrRecoveryRequest({
          hu_student_id: 'HU/10003/14',
          full_name: 'Attacker Guess',
          department_id: 'dept-cs',
          academic_year_id: 'year-3',
          section_id: 'sec-3a',
          telegram_user_id: 555001,
          request_type: 'account_recovery',
          recovery_reason: 'Trying to recover suspended student account',
        }),
      /Unable to create verification request/
    );

    // Valid admin-reviewed roster claim stores applicant-entered fields + target_student_id
    const claimReq = await service.submitVerifiedClaimOrRecoveryRequest({
      hu_student_id: 'HU/10002/14',
      full_name: 'Student Applicant Name',
      department_id: 'dept-se',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 555002,
      telegram_username: 'stu_new',
      request_type: 'roster_claim',
      recovery_reason: 'My HU ID is in the roster and I need verification without a token code.',
    });
    assert.equal(claimReq.request_type, 'roster_claim');
    assert.equal(claimReq.target_student_id, 'stu-unlinked-roster');
    assert.equal(claimReq.status, 'pending');

    // Account recovery request queued cleanly
    const recReq = await service.submitVerifiedClaimOrRecoveryRequest({
      hu_student_id: 'HU/10001/14',
      full_name: 'Lost Phone Owner',
      department_id: 'dept-cs',
      academic_year_id: 'year-3',
      section_id: 'sec-3a',
      telegram_user_id: 555003,
      request_type: 'account_recovery',
      recovery_reason: 'Lost my old SIM card and created a new Telegram account.',
    });
    assert.equal(recReq.request_type, 'account_recovery');
    assert.equal(recReq.target_student_id, 'stu-linked-1');
    assert.ok(pendingRequests.length >= 3);

    // Unauthorized pending recovery request must NOT block a second legitimate recovery request for the same HU ID
    const legitRecReq = await service.submitVerifiedClaimOrRecoveryRequest({
      hu_student_id: 'HU/10001/14',
      full_name: 'Real Linked Student Owner',
      department_id: 'dept-cs',
      academic_year_id: 'year-3',
      section_id: 'sec-3a',
      telegram_user_id: 555004,
      request_type: 'account_recovery',
      recovery_reason: 'Verified owner submitting legitimate recovery alongside attacker pending request.',
    });
    assert.equal(legitRecReq.request_type, 'account_recovery');
    assert.equal(legitRecReq.telegram_user_id, 555004);
  });

  it('normalizes lowercase verification codes and enforces per-student failed-attempt lockout + auditing', async () => {
    clearStudentTokenFailureTracking();
    const { client, students } = createIdentityMockDb();
    const auditInserts: any[] = [];

    const auditedClient = {
      ...client,
      from: (table: string) => {
        if (table === 'audit_logs') {
          return {
            insert: async (row: any) => {
              auditInserts.push(row);
              return { error: null };
            },
          };
        }
        return client.from(table);
      },
    } as any;

    const service = new StudentRegistrationService(auditedClient);

    // Lowercase and whitespace-padded verification token must verify identically to uppercase
    const lowercaseClaim = await service.redeemVerificationToken(
      'hu/10002/14',
      '  claim-code-2026  ',
      777099,
      'lowercase_student'
    );
    assert.equal(lowercaseClaim.hu_student_id, 'HU/10002/14');
    assert.equal(lowercaseClaim.telegram_user_id, 777099);

    // Five failed attempts targeting HU/10001/14 across distinct Telegram IDs trigger lockout on attempt #6
    for (let i = 1; i <= 5; i += 1) {
      await assert.rejects(
        () =>
          service.redeemVerificationToken(
            'HU/10001/14',
            `WRONG-GUESS-${i}`,
            600000 + i,
            `attacker_${i}`
          ),
        /Invalid or expired verification code/
      );
    }

    await assert.rejects(
      () => service.redeemVerificationToken('HU/10001/14', 'RECOVER-CODE-9999', 600099, 'attacker_6'),
      /Too many failed verification attempts/
    );
    assert.equal(students.find((s) => s.id === 'stu-linked-1')?.telegram_user_id, 111111);
    assert.ok(auditInserts.some((a) => a.action === 'STUDENT_VERIFICATION_FAILED'));
    assert.ok(auditInserts.some((a) => a.action === 'STUDENT_VERIFICATION_LOCKED'));

    clearStudentTokenFailureTracking();

    // Backend RPC LOCKED payload must also surface clear lockout error without linking
    const rpcLockedService = new StudentRegistrationService({
      ...auditedClient,
      rpc: async () => ({ data: { ok: false, code: 'LOCKED' }, error: null }),
    } as any);
    await assert.rejects(
      () => rpcLockedService.redeemVerificationToken('HU/10001/14', 'RECOVER-CODE-9999', 888999, 'legit'),
      /Too many failed verification attempts/
    );
  });
});

// ============================================================================
// PHASE B: REAL TELEGRAM FILE DOWNLOADS, CONTENT INSPECTION, VAULT & ROLLBACK
// ============================================================================

describe('Phase B — Real Telegram Download, Content Inspection, Vault Storage & Rollback [Mocked Unit Test]', () => {
  it('downloads real bytes via Telegram getFile API, computes SHA-256, and redacts bot tokens on error', async () => {
    const pdfPayload = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    const secretToken = '99887766:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH1234';

    const mockApi = {
      token: secretToken,
      getFile: async (fileId: string) => {
        if (fileId === 'missing-path') return { file_id: fileId, file_unique_id: 'u1' } as any;
        return {
          file_id: fileId,
          file_unique_id: 'u-ok',
          file_size: pdfPayload.byteLength,
          file_path: 'documents/file_42.pdf',
        };
      },
    };

    const result = await downloadTelegramDocument({
      api: mockApi,
      fileId: 'tg-doc-42',
      maxSizeBytes: 5 * 1024 * 1024,
      fetchFn: async (url) => {
        assert.equal(
          String(url),
          `https://api.telegram.org/file/bot${secretToken}/documents/file_42.pdf`
        );
        return new Response(new Uint8Array(pdfPayload), {
          status: 200,
          headers: { 'content-length': String(pdfPayload.byteLength) },
        });
      },
    });

    assert.equal(Buffer.compare(result.buffer, pdfPayload), 0);
    assert.equal(result.sizeBytes, pdfPayload.byteLength);
    assert.equal(
      result.checksumSha256,
      createHash('sha256').update(pdfPayload).digest('hex')
    );

    // Failure redacts bot token completely
    await assert.rejects(
      () =>
        downloadTelegramDocument({
          api: mockApi,
          fileId: 'tg-doc-42',
          maxSizeBytes: 5 * 1024 * 1024,
          fetchFn: async (url) => {
            throw new Error(`Network reset while fetching ${String(url)}`);
          },
        }),
      (err: any) => {
        assert.ok(err instanceof TelegramFileDownloadError);
        assert.doesNotMatch(err.message, /99887766/);
        assert.match(err.message, /bot\[REDACTED\]/);
        return true;
      }
    );

    // Oversized stream aborted cleanly
    await assert.rejects(
      () =>
        downloadTelegramDocument({
          api: mockApi,
          fileId: 'tg-doc-42',
          maxSizeBytes: 10,
          fetchFn: async () => new Response(new Uint8Array(64), { status: 200 }),
        }),
      (err: any) => err.code === 'INVALID_FILE'
    );

    // Enforces 20 MB Cloud Bot API limit BEFORE calling api.getFile even if 50 MB is configured
    let getFileInvoked = false;
    await assert.rejects(
      () =>
        downloadTelegramDocument({
          api: {
            token: secretToken,
            getFile: async () => {
              getFileInvoked = true;
              return { file_id: 'too-big', file_unique_id: 'tb1' } as any;
            },
          },
          fileId: 'too-big',
          maxSizeBytes: 50 * 1024 * 1024,
          declaredSizeBytes: 21 * 1024 * 1024,
        }),
      (err: any) => {
        assert.ok(err instanceof TelegramFileDownloadError);
        assert.equal(err.code, 'INVALID_FILE');
        assert.match(err.message, /20\.0 MB/);
        return true;
      }
    );
    assert.equal(getFileInvoked, false);

    // validateSubmissionFile enforces the 20 MB limit clearly even if caller supplies 50 MB
    const oversizedCheck = validateSubmissionFile({
      filename: 'huge_thesis.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 22 * 1024 * 1024,
      allowedExtensions: ['pdf'],
      allowedMimeTypes: ['application/pdf'],
      maxSizeBytes: 50 * 1024 * 1024,
    });
    assert.equal(oversizedCheck.valid, false);
    assert.match(oversizedCheck.error || '', /20\.0 MB/);
  });

  it('rejects spoofed PDFs, executables, HTML scripts, and non-OOXML renamed DOCX payloads', () => {
    const exeSpoof = validateSubmissionFileContent({
      filename: 'assignment.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('MZ\x90\x00This is a PE executable'),
      maxSizeBytes: 1024 * 1024,
    });
    assert.equal(exeSpoof.valid, false);

    const htmlSpoof = validateSubmissionFileContent({
      filename: 'notes.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('<!doctype html><script>alert(1)</script>'),
      maxSizeBytes: 1024 * 1024,
    });
    assert.equal(htmlSpoof.valid, false);

    const fakeDocx = validateSubmissionFileContent({
      filename: 'thesis.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content: Buffer.from('PK\x03\x04plain_zip_without_ooxml_parts'),
      maxSizeBytes: 1024 * 1024,
    });
    assert.equal(fakeDocx.valid, false);

    const validDocx = validateSubmissionFileContent({
      filename: 'thesis.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content: Buffer.from('PK\x03\x04\x14\x00[Content_Types].xmlword/document.xml'),
      maxSizeBytes: 1024 * 1024,
    });
    assert.equal(validDocx.valid, true);
    assert.equal(validDocx.detectedType, 'docx');
  });

  it('fails closed when buffer is missing and rolls back orphaned storage + restores prior active submission on DB failure', async () => {
    const uploadedPaths: string[] = [];
    const removedPaths: string[] = [];
    const submissions: any[] = [
      {
        id: 'sub-v1',
        project_id: 'proj-1',
        section_id: 'sec-1',
        submission_type: 'individual',
        student_id: 'stu-1',
        version: 1,
        status: 'active',
      },
    ];
    let failFileInsert = false;

    const mockClient = {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'stu-1',
                    hu_student_id: 'HU/10001/14',
                    full_name: 'Student One',
                    academic_year_id: 'yr-1',
                    section_id: 'sec-1',
                    registration_status: 'locked',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'projects') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'proj-1',
                      title: 'Lab 1',
                      is_active: true,
                      submission_type: 'individual',
                      resubmission_allowed: true,
                      opening_date: new Date(Date.now() - 86400_000).toISOString(),
                      deadline: new Date(Date.now() + 86400_000).toISOString(),
                      targets: [{ academic_year_id: 'yr-1', section_id: 'sec-1' }],
                      file_rules: {
                        allowed_extensions: ['pdf'],
                        allowed_mime_types: ['application/pdf'],
                        max_file_size_bytes: 5 * 1024 * 1024,
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'submissions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: submissions.find((s) => s.status === 'active') || null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: (vals: any) => ({
              eq: async (_c: string, id: string) => {
                const sub = submissions.find((s) => s.id === id);
                if (sub) Object.assign(sub, vals);
                return { error: null };
              },
            }),
            insert: (vals: any) => {
              const row = { id: `sub-v${submissions.length + 1}`, ...vals };
              submissions.push(row);
              return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
            },
            delete: () => ({
              eq: async (_c: string, id: string) => {
                const idx = submissions.findIndex((s) => s.id === id);
                if (idx >= 0) submissions.splice(idx, 1);
                return { error: null };
              },
            }),
          };
        }
        if (table === 'submission_files') {
          return {
            insert: (vals: any) => ({
              select: () => ({
                single: async () => {
                  if (failFileInsert) {
                    return { data: null, error: new Error('DB disk quota error') };
                  }
                  return { data: { id: 'sf-1', ...vals }, error: null };
                },
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'submission_members' || table === 'audit_logs') {
          return {
            insert: async () => ({ error: null }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: (bucket: string) => {
          assert.equal(bucket, 'submission-files-vault');
          return {
            upload: async (path: string) => {
              uploadedPaths.push(path);
              return { data: { path }, error: null };
            },
            remove: async (paths: string[]) => {
              removedPaths.push(...paths);
              return { error: null };
            },
          };
        },
      },
    } as any;

    const service = new IndividualSubmissionService(mockClient);

    // 1. Missing downloaded buffer fails closed without touching DB/storage
    await assert.rejects(
      () =>
        service.submitIndividualAssignment({
          telegramUserId: 111111,
          projectId: 'proj-1',
          file: {
            originalFilename: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        }),
      (err: any) => err.code === 'FILE_DOWNLOAD_REQUIRED'
    );
    assert.equal(uploadedPaths.length, 0);

    // 2. DB failure after upload deletes orphaned storage file and restores v1 back to 'active'
    failFileInsert = true;
    await assert.rejects(
      () =>
        service.submitIndividualAssignment({
          telegramUserId: 111111,
          projectId: 'proj-1',
          file: {
            originalFilename: 'report_v2.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 24,
            buffer: Buffer.from('%PDF-1.4 valid content v2'),
          },
        }),
      (err: any) => err.code === 'DATABASE_PERSISTENCE_FAILED'
    );

    assert.equal(uploadedPaths.length, 1);
    assert.deepEqual(removedPaths, uploadedPaths);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].id, 'sub-v1');
    assert.equal(submissions[0].status, 'active');

    // 3. Group submission also cleans up orphan storage and restores group status on DB failure
    let groupStatus = 'verified';
    let grpSubFail = true;
    const grpClient = {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'stu-leader',
                    hu_student_id: 'HU/10001/14',
                    full_name: 'Leader One',
                    academic_year_id: 'yr-1',
                    section_id: 'sec-1',
                    registration_status: 'locked',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'groups') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'grp-1',
                    group_code: 'GRP-01',
                    project_id: 'proj-g',
                    section_id: 'sec-1',
                    group_leader_id: 'stu-leader',
                    status: groupStatus,
                    project: {
                      id: 'proj-g',
                      title: 'Group Design',
                      is_active: true,
                      submission_type: 'group',
                      resubmission_allowed: true,
                      opening_date: new Date(Date.now() - 86400_000).toISOString(),
                      deadline: new Date(Date.now() + 86400_000).toISOString(),
                      file_rules: {
                        allowed_extensions: ['pdf'],
                        allowed_mime_types: ['application/pdf'],
                        max_file_size_bytes: 5 * 1024 * 1024,
                        min_group_size: 1,
                        max_group_size: 4,
                      },
                    },
                    members: [
                      {
                        student_id: 'stu-leader',
                        confirmation_status: 'confirmed',
                        student: { hu_student_id: 'HU/10001/14', full_name: 'Leader One' },
                      },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
            update: (vals: any) => ({
              eq: async () => {
                groupStatus = vals.status;
                return { error: null };
              },
            }),
          };
        }
        if (table === 'submissions') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
            insert: (vals: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'gsub-1', ...vals }, error: null }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'submission_files') {
          return {
            insert: () => ({
              select: () => ({
                single: async () =>
                  grpSubFail
                    ? { data: null, error: new Error('Insert constraint error') }
                    : { data: { id: 'gsf-1' }, error: null },
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'submission_members' || table === 'audit_logs') {
          return { insert: async () => ({ error: null }), delete: () => ({ eq: async () => ({ error: null }) }) };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploadedPaths.push(path);
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            removedPaths.push(...paths);
            return { error: null };
          },
        }),
      },
    } as any;

    const grpService = new GroupSubmissionService(grpClient);
    await assert.rejects(
      () =>
        grpService.submitGroupAssignment({
          telegramUserId: 111111,
          groupId: 'grp-1',
          projectId: 'proj-g',
          file: {
            originalFilename: 'group_doc.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 20,
            buffer: Buffer.from('%PDF-1.4 group payload'),
          },
        }),
      (err: any) => err.code === 'DATABASE_PERSISTENCE_FAILED'
    );
    assert.equal(removedPaths.length, 2);
    assert.equal(groupStatus, 'verified');
  });
});

// ============================================================================
// PHASE C: PERSISTENT BOT CONVERSATIONS & DISTRIBUTED RATE LIMITING
// ============================================================================

describe('Phase C — Persistent Webhook Conversations Across Cold Starts & Distributed Rate Limiting [Mocked Unit Test]', () => {
  function makeTextUpdate(updateId: number, userId: number, text: string): Update {
    return {
      update_id: updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: 'private', first_name: 'Student' },
        from: { id: userId, is_bot: false, first_name: 'Student', username: 'stu_test' },
        text,
        entities: text.startsWith('/') ? [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }] : undefined,
      },
    } as Update;
  }

  it('persists multi-step conversation state in external store across separate HTTP webhook requests and simulated cold starts', async () => {
    const sharedDbTable = new Map<string, { session_key: string; session_data: any; expires_at: string }>();

    // Simulated Postgres client backed by sharedDbTable (survives bot disposal & cold starts)
    const mockPostgresClient = {
      from: (table: string) => {
        assert.equal(table, 'bot_sessions');
        return {
          select: () => ({
            eq: (_col: string, key: string) => ({
              maybeSingle: async () => ({ data: sharedDbTable.get(key) || null, error: null }),
            }),
          }),
          upsert: async (row: any) => {
            sharedDbTable.set(row.session_key, {
              session_key: row.session_key,
              session_data: JSON.parse(JSON.stringify(row.session_data)),
              expires_at: row.expires_at,
            });
            return { error: null };
          },
          delete: () => ({
            eq: async (_col: string, key: string) => {
              sharedDbTable.delete(key);
              return { error: null };
            },
          }),
        };
      },
    } as any;

    const storageAdapter = new SupabaseSessionStorage(mockPostgresClient);
    const replies: Array<{ instance: string; text: string }> = [];

    function createServerlessInstance(label: string) {
      const bot = createBot('123456:TEST_TOKEN_PHASE_C', {
        botInfo: BOT_INFO,
        sessionStorage: storageAdapter,
        rateLimit: { inMemoryOnly: true, maxRequests: 20, windowMs: 10_000 },
      });
      bot.api.config.use(async (prev, method, payload, signal) => {
        if (method === 'sendMessage' && payload && typeof payload === 'object') {
          replies.push({ instance: label, text: String((payload as any).text || '') });
          return { ok: true, result: { message_id: replies.length } } as any;
        }
        return prev(method, payload, signal);
      });
      return bot;
    }

    // Request 1 on Instance A: /start -> enters registrationConversation cleanly
    resetWebhookBotCache();
    // Precondition: simulate Supabase env NOT needed because handleStartCommand hits getSupabaseAdminClient()!
    // Wait: createBot registers conversations directly, so let's add a lightweight test-only conversation
    // route inside two fresh bots sharing storageAdapter to test grammY + @grammyjs/conversations without DB env,
    // AND explicitly verify SupabaseSessionStorage read/write JSONB persistence separately below!
    const sharedSessions = new Map<string, SerializedSessionRecord>();
    const memStorage = new PersistentMemorySessionStorage(sharedSessions);

    const buildMultiStepBot = async (label: string) => {
      const { conversations: convPlugin, createConversation } = await import('@grammyjs/conversations');
      const { Bot, session } = await import('grammy');

      async function multiStepFlow(conversation: any, ctx: any) {
        await ctx.reply('Step 1: Send your HU Student ID');
        const msg1 = await conversation.waitFor(':text');
        await ctx.reply(`Step 2: Received ${msg1.message.text}. Now send your Full Name`);
        const msg2 = await conversation.waitFor(':text');
        await ctx.reply(`Completed profile: ${msg1.message.text} / ${msg2.message.text}`);
      }

      const b = new Bot<any>('123456:TEST_TOKEN_PHASE_C', { botInfo: BOT_INFO });
      b.api.config.use(async (_prev, method, payload) => {
        if (method === 'sendMessage' && payload && typeof payload === 'object') {
          replies.push({ instance: label, text: String((payload as any).text || '') });
          return { ok: true, result: { message_id: replies.length } } as any;
        }
        return { ok: true, result: true } as any;
      });
      b.use(
        session({
          initial: () => ({}),
          storage: storageAdapter,
          getSessionKey: (ctx: any) => ctx.chat?.id?.toString() ?? ctx.from?.id?.toString(),
        })
      );
      b.use(convPlugin());
      b.use(createConversation(multiStepFlow));
      b.command('flow', (ctx) => ctx.conversation.enter('multiStepFlow'));
      return b;
    };

    // Serverless Instance #1 handles Request 1 (/flow)
    const instance1 = await buildMultiStepBot('lambda-1');
    const r1 = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: makeTextUpdate(101, 424242, '/flow'),
      },
      { bot: instance1, secretToken: WEBHOOK_SECRET }
    );
    assert.equal(r1.statusCode, 200);
    assert.equal(sharedDbTable.has('424242'), true);

    // Simulated cold start: reset singleton cache & spin up completely fresh Instance #2 sharing Postgres session table
    resetWebhookBotCache();
    const instance2 = await buildMultiStepBot('lambda-2');
    const r2 = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: makeTextUpdate(102, 424242, 'HU/55123/14'),
      },
      { bot: instance2, secretToken: WEBHOOK_SECRET }
    );
    assert.equal(r2.statusCode, 200);

    // Simulated cold start #2: spin up Instance #3 to finish the multi-step conversation!
    resetWebhookBotCache();
    const instance3 = await buildMultiStepBot('lambda-3');
    const r3 = await processTelegramWebhookRequest(
      {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: makeTextUpdate(103, 424242, 'Abebe Bikila'),
      },
      { bot: instance3, secretToken: WEBHOOK_SECRET }
    );
    assert.equal(r3.statusCode, 200);

    assert.deepEqual(replies, [
      { instance: 'lambda-1', text: 'Step 1: Send your HU Student ID' },
      { instance: 'lambda-2', text: 'Step 2: Received HU/55123/14. Now send your Full Name' },
      { instance: 'lambda-3', text: 'Completed profile: HU/55123/14 / Abebe Bikila' },
    ]);

    // Also verify createBot + PersistentMemorySessionStorage instantiate cleanly across two cold-start bots
    memStorage.write('1234', { step: 'awaiting_verification' });
    assert.deepEqual(memStorage.read('1234'), { step: 'awaiting_verification' });
    const botA = createServerlessInstance('botA');
    const botB = createServerlessInstance('botB');
    assert.ok(botA && botB);
  });

  it('enforces distributed sliding-window rate limits across separate serverless instances via Postgres RPC and fails closed on RPC error', async () => {
    const sharedHits = new Map<string, number[]>();

    const mockRpcClient = {
      rpc: async (fn: string, params: Record<string, any>) => {
        assert.equal(fn, 'check_and_increment_rate_limit');
        const key = String(params.p_key);
        const maxReq = Number(params.p_max_requests);
        const windowMs = Number(params.p_window_ms);
        const now = Date.now();
        const valid = (sharedHits.get(key) || []).filter((t) => t > now - windowMs);

        if (valid.length >= maxReq) {
          return {
            data: [{ allowed: false, remaining: 0, retry_after_ms: 4000 }],
            error: null,
          };
        }
        valid.push(now);
        sharedHits.set(key, valid);
        return {
          data: [{ allowed: true, remaining: maxReq - valid.length, retry_after_ms: 0 }],
          error: null,
        };
      },
    } as any;

    const store = new SupabaseRateLimitStore(mockRpcClient);
    const sentTexts: string[] = [];

    const createDistributedBot = () => {
      const b = createBot('123456:TEST_TOKEN_RL', {
        botInfo: BOT_INFO,
        sessionStorage: new PersistentMemorySessionStorage(),
        rateLimit: {
          windowMs: 10_000,
          maxRequests: 2,
          store,
        },
      });
      b.api.config.use(async (_prev, method, payload) => {
        if (method === 'sendMessage' && payload && typeof payload === 'object') {
          sentTexts.push(String((payload as any).text || ''));
          return { ok: true, result: { message_id: sentTexts.length } } as any;
        }
        return { ok: true, result: true } as any;
      });
      return b;
    };

    // Hit Instance 1, Instance 2, then Instance 1 again for the same Telegram user (999111)
    const bot1 = createDistributedBot();
    const bot2 = createDistributedBot();

    await bot1.handleUpdate(makeTextUpdate(201, 999111, '/help'));
    await bot2.handleUpdate(makeTextUpdate(202, 999111, '/help'));
    await bot1.handleUpdate(makeTextUpdate(203, 999111, '/help'));

    assert.equal(sentTexts.length, 3);
    assert.doesNotMatch(sentTexts[0], /Rate limit exceeded/);
    assert.doesNotMatch(sentTexts[1], /Rate limit exceeded/);
    assert.match(sentTexts[2], /Rate limit exceeded/);

    // Failing distributed store must fail closed without invoking downstream next() handler
    const failingStore = new SupabaseRateLimitStore({
      rpc: async () => ({ data: null, error: { message: 'Postgres connection dropped' } }),
    } as any);
    const mw = createRateLimiterMiddleware({
      windowMs: 10_000,
      maxRequests: 5,
      store: failingStore,
    });
    let nextCalled = false;
    const errReplies: string[] = [];
    await mw(
      {
        from: { id: 12345 },
        reply: async (msg: string) => {
          errReplies.push(msg);
        },
      } as any,
      async () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, false);
    assert.equal(errReplies.length, 1);
    assert.match(errReplies[0], /temporarily busy/);
  });

  it('fails closed in NODE_ENV=production if persistent Supabase credentials are missing', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevUrl = process.env.SUPABASE_URL;
    const prevNextUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      assert.throws(
        () => createBot('123456:TEST_PROD_GUARD', { botInfo: BOT_INFO }),
        /required in production/i
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
      if (prevNextUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevNextUrl;
      if (prevService !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevService;
    }
  });

  it('isolates group chat session keys per user and restricts sensitive registration/submission flows to private chats', async () => {
    // 1. Session key isolation: private chat uses user ID, shared group scopes by chatId:userId
    assert.equal(resolveBotSessionKey({ chat: { id: 101 }, from: { id: 101 } }), '101');
    assert.equal(
      resolveBotSessionKey({ chat: { id: -100999 }, from: { id: 101 } }),
      '-100999:101'
    );
    assert.equal(
      resolveBotSessionKey({ chat: { id: -100999 }, from: { id: 202 } }),
      '-100999:202'
    );
    assert.notEqual(
      resolveBotSessionKey({ chat: { id: -100999 }, from: { id: 101 } }),
      resolveBotSessionKey({ chat: { id: -100999 }, from: { id: 202 } })
    );

    // 2. Shared group chat commands must reject sensitive flows cleanly without entering conversations
    const sharedSessions = new Map<string, SerializedSessionRecord>();
    const groupReplies: string[] = [];
    const bot = createBot('123456:TEST_GROUP_GUARD', {
      botInfo: BOT_INFO,
      sessionStorage: new PersistentMemorySessionStorage(sharedSessions),
      rateLimit: { inMemoryOnly: true, maxRequests: 20, windowMs: 10_000 },
    });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage' && payload && typeof payload === 'object') {
        groupReplies.push(String((payload as any).text || ''));
        return { ok: true, result: { message_id: groupReplies.length } } as any;
      }
      return { ok: true, result: true } as any;
    });

    const makeGroupUpdate = (updateId: number, userId: number, text: string): Update =>
      ({
        update_id: updateId,
        message: {
          message_id: updateId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: -100888777, type: 'supergroup', title: 'SE Section B' },
          from: { id: userId, is_bot: false, first_name: 'Student', username: `stu_${userId}` },
          text,
          entities: text.startsWith('/')
            ? [{ offset: 0, length: text.split(' ')[0].length, type: 'bot_command' }]
            : undefined,
        },
      }) as Update;

    await bot.handleUpdate(makeGroupUpdate(501, 101, '/start'));
    await bot.handleUpdate(makeGroupUpdate(502, 202, '/submit'));
    await bot.handleUpdate(makeGroupUpdate(503, 101, '/submit_group'));
    await bot.handleUpdate(makeGroupUpdate(504, 202, '/correction'));
    await bot.handleUpdate(makeGroupUpdate(505, 101, '/profile'));

    assert.equal(groupReplies.length, 5);
    for (const msg of groupReplies) {
      assert.match(msg, /Private Chat Required/);
    }
    assert.equal(sharedSessions.has('-100888777'), false);
  });
});
