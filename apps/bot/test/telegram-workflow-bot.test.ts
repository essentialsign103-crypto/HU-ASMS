// HU-ASMS: Telegram Bot Workflow Tests (Phase 5)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from '../src/services/notification.service.js';
import {
  RepresentativeService,
  UnauthorizedSectionScopeError,
} from '../src/services/representative.service.js';

describe('Telegram Bot Workflow Integration & Scope Tests', () => {
  const SEC_3B_ID = 'sec-3b';
  const SEC_2A_ID = 'sec-2a';
  const REP_TELEGRAM_ID = 11111111;
  const DEACTIVATED_REP_ID = 22222222;

  const mockProfiles = [
    {
      id: 'prof-active',
      role: 'representative',
      full_name: 'Hamza Representative',
      telegram_user_id: REP_TELEGRAM_ID,
      is_active: true,
    },
    {
      id: 'prof-inactive',
      role: 'representative',
      full_name: 'Deactivated Rep',
      telegram_user_id: DEACTIVATED_REP_ID,
      is_active: false,
    },
  ];

  const mockAssignments = [
    {
      id: 'assign-3b',
      profile_id: 'prof-active',
      section_id: SEC_3B_ID,
      is_active: true,
      profile: mockProfiles[0],
      section: {
        id: SEC_3B_ID,
        name: 'Section B',
        academic_year_id: 'year-3',
        academic_year: { name: '3rd Year' },
      },
    },
    {
      id: 'assign-inactive',
      profile_id: 'prof-inactive',
      section_id: SEC_3B_ID,
      is_active: false,
      profile: mockProfiles[1],
      section: {
        id: SEC_3B_ID,
        name: 'Section B',
        academic_year_id: 'year-3',
        academic_year: { name: '3rd Year' },
      },
    },
  ];

  const mockStudents = [
    {
      id: 'stud-1',
      hu_student_id: 'HU/10294/14',
      full_name: 'Student In Scope',
      section_id: SEC_3B_ID,
      registration_status: 'locked',
      is_locked: true,
    },
  ];

  function createMockSupabase() {
    return {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: (_col: string, val: any) => ({
                eq: (_col2: string, active: boolean) => ({
                  maybeSingle: async () => {
                    const found = mockProfiles.find(
                      (p) => p.telegram_user_id === val && p.is_active === active
                    );
                    return { data: found || null, error: null };
                  },
                }),
              }),
            }),
          };
        }
        if (table === 'representative_assignments') {
          return {
            select: () => ({
              eq: (col: string, val: any) => {
                if (col === 'profile_id') {
                  return {
                    eq: (_col2: string, active: boolean) => {
                      const found = mockAssignments.filter(
                        (a) => a.profile_id === val && a.is_active === active
                      );
                      return Promise.resolve({ data: found, error: null });
                    },
                  };
                }
                if (col === 'section_id') {
                  return {
                    eq: (_col2: string, active: boolean) => ({
                      eq: () => {
                        const found = mockAssignments.filter(
                          (a) => a.section_id === val && a.is_active === active
                        );
                        return Promise.resolve({ data: found, error: null });
                      },
                    }),
                  };
                }
                return Promise.resolve({ data: [], error: null });
              },
            }),
          };
        }
        if (table === 'students') {
          return {
            select: () => ({
              eq: (_col: string, secId: string) => ({
                order: async () => {
                  const filtered = mockStudents.filter((s) => s.section_id === secId);
                  return { data: filtered, error: null };
                },
              }),
            }),
          };
        }
        if (table === 'notifications') {
          return {
            insert: async (data: any) => ({ data, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as any;
  }

  describe('Representative Scope & Bot Recognition', () => {
    it('bot recognizes active representative and allows section access', async () => {
      const repService = new RepresentativeService(createMockSupabase());
      const rep = await repService.getRepresentativeProfile(REP_TELEGRAM_ID);

      assert.ok(rep);
      assert.equal(rep.profile.full_name, 'Hamza Representative');
      assert.equal(rep.assignments.length, 1);
      assert.equal(rep.assignments[0].section_id, SEC_3B_ID);

      // Section students accessible within scope
      const students = await repService.getSectionStudents(REP_TELEGRAM_ID, SEC_3B_ID);
      assert.equal(students.length, 1);
      assert.equal(students[0].full_name, 'Student In Scope');
    });

    it('representative cannot access another unassigned section (cross-section isolation)', async () => {
      const repService = new RepresentativeService(createMockSupabase());

      await assert.rejects(
        async () => {
          await repService.getSectionStudents(REP_TELEGRAM_ID, SEC_2A_ID);
        },
        UnauthorizedSectionScopeError
      );
    });

    it('deactivated representative loses bot access immediately', async () => {
      const repService = new RepresentativeService(createMockSupabase());
      const rep = await repService.getRepresentativeProfile(DEACTIVATED_REP_ID);

      assert.equal(rep, null);

      await assert.rejects(
        async () => {
          await repService.getSectionStudents(DEACTIVATED_REP_ID, SEC_3B_ID);
        },
        UnauthorizedSectionScopeError
      );
    });
  });

  describe('NotificationService Delivery Recording & Error Handling', () => {
    it('records failed status and error message when representative notification dispatch fails', async () => {
      const insertedRows: any[] = [];
      const failingSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: async () => ({
                      data: [
                        {
                          id: 'assign-1',
                          profile: {
                            telegram_user_id: 99999999,
                            full_name: 'Rep One',
                            is_active: true,
                          },
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'notifications') {
            return {
              insert: async (data: any) => {
                insertedRows.push(data);
                return { error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const failingBotSender = async () => {
        throw new Error('Telegram Bot API connection timeout');
      };

      const notifService = new NotificationService(failingSupabase, failingBotSender);
      const res = await notifService.notifyRepresentativeOfSubmission({
        sectionId: SEC_3B_ID,
        projectTitle: 'Compiler Design',
        scopeName: '3rd Year — Section B',
        studentOrGroupName: 'Student A',
        fileName: 'ast_parser.zip',
        fileSizeBytes: 2048,
        submissionType: 'individual',
      });

      assert.equal(res.dispatchedCount, 0);
      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0].status, 'failed');
      assert.match(insertedRows[0].error_message, /connection timeout/);
    });

    it('records sent status and sent_at timestamp on successful representative alert', async () => {
      const insertedRows: any[] = [];
      const successSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: async () => ({
                      data: [
                        {
                          id: 'assign-1',
                          profile: {
                            telegram_user_id: 11111111,
                            full_name: 'Rep One',
                            is_active: true,
                          },
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'notifications') {
            return {
              insert: async (data: any) => {
                insertedRows.push(data);
                return { error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const successBotSender = async () => {};
      const notifService = new NotificationService(successSupabase, successBotSender);
      const res = await notifService.notifyRepresentativeOfSubmission({
        sectionId: SEC_3B_ID,
        projectTitle: 'Compiler Design',
        scopeName: '3rd Year — Section B',
        studentOrGroupName: 'Student A',
        fileName: 'ast_parser.zip',
        fileSizeBytes: 2048,
        submissionType: 'individual',
      });

      assert.equal(res.dispatchedCount, 1);
      assert.equal(insertedRows.length, 1);
      assert.equal(insertedRows[0].status, 'sent');
      assert.ok(insertedRows[0].sent_at);
      assert.equal(insertedRows[0].error_message, null);
    });
  });
});
