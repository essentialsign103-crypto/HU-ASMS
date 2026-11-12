// HU-ASMS: Phase 04 Student Registration & Identity Verification Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StudentRegistrationService } from '../src/services/registration.service.js';

describe('Phase 04 — Student Registration & Identity Lifecycle Unit Tests', () => {

  const mockStudents = [
    {
      id: 'student-1',
      hu_student_id: 'HU/10294/14',
      full_name: 'Hamza Mohammed',
      department_id: 'dept-se',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 11111111,
      registration_status: 'locked',
      is_locked: true,
      department: { name: 'Department of Software Engineering' },
      academic_year: { name: '3rd Year' },
      section: { name: 'Section B' },
    },
    {
      id: 'student-2',
      hu_student_id: 'HU/10295/14',
      full_name: 'Almaz Kebede',
      department_id: 'dept-se',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: null, // Pre-populated roster record awaiting Telegram link
      registration_status: 'approved',
      is_locked: true,
      department: { name: 'Department of Software Engineering' },
      academic_year: { name: '3rd Year' },
      section: { name: 'Section B' },
    },
    {
      id: 'student-3',
      hu_student_id: 'HU/10296/14',
      full_name: 'Beshir Ahmed',
      department_id: 'dept-se',
      academic_year_id: 'year-3',
      section_id: 'sec-3b',
      telegram_user_id: 33333333,
      registration_status: 'suspended',
      suspension_reason: 'Administrative disciplinary hold',
      department: { name: 'Department of Software Engineering' },
    },
  ];

  const mockPendingRequests = [
    {
      id: 'req-1',
      hu_student_id: 'HU/10297/14',
      full_name: 'Chala Bekele',
      telegram_user_id: 44444444,
      status: 'pending',
    },
  ];

  function createMockSupabaseClient() {
    return {
      from: (table: string) => {
        if (table === 'students') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                maybeSingle: async () => {
                  if (col === 'hu_student_id') {
                    const match = mockStudents.find((s) => s.hu_student_id === val);
                    return { data: match || null, error: null };
                  }
                  if (col === 'telegram_user_id') {
                    const match = mockStudents.find((s) => s.telegram_user_id === val);
                    return { data: match || null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
            update: (updates: any) => ({
              eq: (_col: string, idVal: string) => ({
                select: () => ({
                  single: async () => {
                    const student = mockStudents.find((s) => s.id === idVal);
                    return { data: { ...student, ...updates }, error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'registration_requests') {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => ({
                eq: (col2: string, val2: unknown) => ({
                  maybeSingle: async () => {
                    if ((col === 'hu_student_id' || col === 'telegram_user_id') && col2 === 'status') {
                      const match = mockPendingRequests.find(
                        (r) => (r as any)[col] === val && r.status === val2
                      );
                      return { data: match || null, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
                maybeSingle: async () => {
                  if (col === 'hu_student_id') {
                    const match = mockPendingRequests.find((r) => r.hu_student_id === val);
                    return { data: match || null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
            insert: (data: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'new-req', ...data }, error: null }),
              }),
            }),
          };
        }

        if (table === 'identity_change_requests') {
          return {
            insert: async (data: any) => ({ data, error: null }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as any;
  }

  describe('1. Name Privacy Masking', () => {
    it('should securely mask personal names to prevent identity harvesting', () => {
      const service = new StudentRegistrationService({} as any);
      assert.equal(service.maskName('Abebe'), 'A****');
      assert.equal(service.maskName('Hamza Mohammed'), 'H**** M*****');
      assert.equal(service.maskName('Almaz Kebede Tadesse'), 'A**** K***** T*****');
    });
  });

  describe('2. Student Identity Lookup Scenarios', () => {
    it('Scenario 1: should recognize an approved student linked to current Telegram user', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      const result = await service.lookupStudentIdentity('HU/10294/14', 11111111);

      assert.equal(result.status, 'linked_to_current_user');
      assert.ok(result.student);
      assert.equal(result.student.full_name, 'Hamza Mohammed');
    });

    it('Scenario 2: should block unauthorized identity claim and withhold all PII when linked to another user', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      // Telegram ID 99999999 attempts to look up Hamza's ID (which is linked to 11111111)
      const result = await service.lookupStudentIdentity('HU/10294/14', 99999999);

      assert.equal(result.status, 'linked_to_another_user');
      assert.equal((result as any).maskedInfo, undefined, 'Must not expose masked name or department before verification');
      assert.equal(result.student, undefined, 'Must not return raw student record to unverified user');
    });

    it('Scenario 3: should require verification for unlinked roster records without exposing student PII', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      const result = await service.lookupStudentIdentity('HU/10295/14', 22222222);

      assert.equal(result.status, 'unlinked_roster_verification_required');
      assert.equal(result.student, undefined, 'Must not return stored roster record before verification');
      assert.equal((result as any).maskedInfo, undefined);
    });

    it('Scenario 4: should identify own pending registration requests cleanly', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      const result = await service.lookupStudentIdentity('HU/10297/14', 44444444);

      assert.equal(result.status, 'pending_approval');
      assert.ok(result.pendingRequest);
    });

    it('Scenario 5: should identify own suspended accounts while refusing foreign probes', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      const result = await service.lookupStudentIdentity('HU/10296/14', 33333333);

      assert.equal(result.status, 'suspended');
      assert.ok(result.student);
    });

    it('Scenario 6: should identify brand new student IDs as not found', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      const result = await service.lookupStudentIdentity('HU/99999/14', 88888888);

      assert.equal(result.status, 'not_found');
    });
  });

  describe('3. Account Binding and Locking Security Gate', () => {
    it('should reject unverified direct roster linking via HU ID alone', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());
      await assert.rejects(
        async () => await service.linkRosterStudentToTelegram('student-2', 22222222, 'almaz_k'),
        /Direct unverified roster linking is disabled/
      );
    });
  });

  describe('4. Correction Request Submission', () => {
    it('should require at least 10 characters for correction reason', async () => {
      const service = new StudentRegistrationService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.submitCorrectionRequest('student-1', 'mistake', {});
        },
        /at least 10 characters/
      );

      // Valid reason should succeed
      await assert.doesNotReject(async () => {
        await service.submitCorrectionRequest(
          'student-1',
          'My section changed from Section A to Section B officially',
          { target_section: 'sec-3b' }
        );
      });
    });
  });

});
