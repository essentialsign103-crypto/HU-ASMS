// HU-ASMS: University Structure Service Tests (Phase 03)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UniversityStructureService } from '../src/university-structure.js';
import { sanitizeHuStudentId, isValidHuStudentId } from '@hu-asms/validation';

describe('Phase 03 — University Structure Service Unit Tests', () => {

  describe('1. HU Student ID Validation & Sanitization', () => {
    it('should sanitize and accept valid Haramaya University Student IDs', () => {
      const validCases = [
        { input: 'hu/10294/14', expected: 'HU/10294/14' },
        { input: ' HU/10294/14 ', expected: 'HU/10294/14' },
        { input: 'hu-2024-001', expected: 'HU-2024-001' },
        { input: 'UGR/99881/15', expected: 'UGR/99881/15' },
      ];

      for (const testCase of validCases) {
        const sanitized = sanitizeHuStudentId(testCase.input);
        assert.equal(sanitized, testCase.expected);
        assert.equal(isValidHuStudentId(sanitized), true, `Failed for ${testCase.input}`);
      }
    });

    it('should reject invalid student IDs', () => {
      const invalidCases = [
        '',
        'INVALID_ID',
        '12345',
        'STUDENT-1',
        'HU/',
      ];

      for (const input of invalidCases) {
        const sanitized = sanitizeHuStudentId(input);
        assert.equal(isValidHuStudentId(sanitized), false, `Should reject ${input}`);
      }
    });
  });

  describe('2. Representative Scope Verification Logic', () => {
    it('should verify representative authorization strictly by section assignment', async () => {
      const mockAssignments = [
        {
          id: 'assign-1',
          section_id: 'sec-3b',
          is_active: true,
          profile: { telegram_user_id: 11223344, is_active: true },
        },
        {
          id: 'assign-2',
          section_id: 'sec-2a',
          is_active: true,
          profile: { telegram_user_id: 99887766, is_active: true },
        },
        {
          id: 'assign-3',
          section_id: 'sec-3a',
          is_active: false, // Deactivated
          profile: { telegram_user_id: 55443322, is_active: true },
        },
      ];

      // Create a mock Supabase client for verifyRepresentativeScope
      const mockClient = {
        from: (table: string) => {
          assert.equal(table, 'representative_assignments');
          return {
            select: (_fields: string) => ({
              eq: function (col: string, val: unknown) {
                // Return chainable filters
                const state = {
                  filters: [{ col, val }],
                  eq(c: string, v: unknown) {
                    this.filters.push({ col: c, val: v });
                    return this;
                  },
                  maybeSingle: async () => {
                    const sectionFilter = state.filters.find((f) => f.col === 'section_id')?.val;
                    const telegramFilter = state.filters.find((f) => f.col === 'profile.telegram_user_id')?.val;
                    const activeFilter = state.filters.find((f) => f.col === 'is_active')?.val;

                    const match = mockAssignments.find(
                      (a) =>
                        a.section_id === sectionFilter &&
                        a.profile.telegram_user_id === telegramFilter &&
                        a.is_active === activeFilter &&
                        a.profile.is_active === true
                    );

                    return { data: match ? { id: match.id } : null, error: null };
                  },
                };
                return state;
              },
            }),
          };
        },
      } as any;

      const service = new UniversityStructureService(mockClient);

      // 1. Hamza (11223344) has active assignment to Section 3B -> Authorized
      const isHamza3BAuthorized = await service.verifyRepresentativeScope(11223344, 'sec-3b');
      assert.equal(isHamza3BAuthorized, true, 'Hamza should be authorized for Section 3B');

      // 2. Hamza (11223344) attempting to access Section 3A -> Must be Denied!
      const isHamza3AAuthorized = await service.verifyRepresentativeScope(11223344, 'sec-3a');
      assert.equal(isHamza3AAuthorized, false, 'Hamza must not have access to Section 3A');

      // 3. Hamza (11223344) attempting to access Section 2A -> Must be Denied!
      const isHamza2AAuthorized = await service.verifyRepresentativeScope(11223344, 'sec-2a');
      assert.equal(isHamza2AAuthorized, false, 'Hamza must not have access to Section 2A');

      // 4. Deactivated rep (55443322) attempting to access Section 3A -> Must be Denied!
      const isDeactivatedAuthorized = await service.verifyRepresentativeScope(55443322, 'sec-3a');
      assert.equal(isDeactivatedAuthorized, false, 'Deactivated rep must be denied');

      // 5. Unknown Telegram User (99999999) -> Denied
      const isUnknownAuthorized = await service.verifyRepresentativeScope(99999999, 'sec-3b');
      assert.equal(isUnknownAuthorized, false, 'Unknown user must be denied');
    });
  });

  describe('3. Student Academic Reassignment & Audit History', () => {
    it('should require a valid reason and update student assignment while preserving audit history', async () => {
      let insertedAudit: any = null;
      let updatedStudentData: any = null;

      const mockStudent = {
        id: 'student-001',
        hu_student_id: 'HU/10294/14',
        department_id: 'dept-se',
        academic_year_id: 'year-2',
        section_id: 'sec-2a',
      };

      const mockClient = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({ data: mockStudent, error: null }),
                }),
              }),
              update: (newVals: any) => ({
                eq: () => ({
                  select: () => ({
                    single: async () => {
                      updatedStudentData = { ...mockStudent, ...newVals };
                      return { data: updatedStudentData, error: null };
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'identity_change_history') {
            return {
              insert: async (auditRecord: any) => {
                insertedAudit = auditRecord;
                return { data: null, error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const service = new UniversityStructureService(mockClient);

      // Attempt reassignment without reason -> should fail
      await assert.rejects(
        async () => {
          await service.updateStudentAcademicAssignment(
            'student-001',
            { academic_year_id: 'year-3', section_id: 'sec-3b' },
            '' // empty reason
          );
        },
        /A detailed reason is required/
      );

      // Perform valid reassignment
      const result = await service.updateStudentAcademicAssignment(
        'student-001',
        { academic_year_id: 'year-3', section_id: 'sec-3b' },
        'Student promoted from 2nd Year Section A to 3rd Year Section B',
        'owner-profile-1'
      );

      assert.equal(result.academic_year_id, 'year-3');
      assert.equal(result.section_id, 'sec-3b');

      // Verify audit history record was inserted
      assert.ok(insertedAudit, 'Audit record must be created');
      assert.equal(insertedAudit.student_id, 'student-001');
      assert.equal(insertedAudit.changed_by, 'owner-profile-1');
      assert.deepEqual(insertedAudit.old_values, {
        department_id: 'dept-se',
        academic_year_id: 'year-2',
        section_id: 'sec-2a',
      });
      assert.deepEqual(insertedAudit.new_values, {
        department_id: 'dept-se',
        academic_year_id: 'year-3',
        section_id: 'sec-3b',
      });
    });
  });

  describe('4. Roster Ingestion Format Rules', () => {
    it('should reject student creation with malformed HU ID or short name', async () => {
      const mockClient = {} as any;
      const service = new UniversityStructureService(mockClient);

      await assert.rejects(
        async () => {
          await service.addStudentToRoster({
            hu_student_id: 'NOT-A-VALID-ID',
            full_name: 'John Doe',
            department_id: 'dept-se',
            academic_year_id: 'year-3',
            section_id: 'sec-3b',
          });
        },
        /Invalid Haramaya University Student ID format/
      );

      await assert.rejects(
        async () => {
          await service.addStudentToRoster({
            hu_student_id: 'HU/10294/14',
            full_name: 'J', // too short
            department_id: 'dept-se',
            academic_year_id: 'year-3',
            section_id: 'sec-3b',
          });
        },
        /Full name must be at least 3 characters/
      );
    });
  });

});
