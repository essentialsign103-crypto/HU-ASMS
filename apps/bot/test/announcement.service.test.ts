// HU-ASMS: Announcement Service Unit Tests (Issue 3 — Announcement Center)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnnouncementService } from '../src/services/announcement.service.js';
import { UnauthorizedSectionScopeError } from '../src/services/representative.service.js';

const SEC_A = 'section-a';
const SEC_B = 'section-b';
const REP_TG = 11111111;
const PROFILE_ID = 'profile-rep-1';
const STUDENT_TG = 22222222;

function makeMockSupabase(options: {
  repProfile?: any;
  repAssignments?: any[];
  students?: any[];
  insertError?: boolean;
  recipientInsertError?: boolean;
  botSenderShouldFail?: boolean;
}) {
  const store: Record<string, any[]> = {
    announcements: [],
    announcement_recipients: [],
    audit_logs: [],
  };

  const repProfile = options.repProfile ?? {
    id: PROFILE_ID,
    telegram_user_id: REP_TG,
    is_active: true,
    role: 'representative',
  };

  const repAssignments = options.repAssignments ?? [
    {
      id: 'assign-1',
      profile_id: PROFILE_ID,
      section_id: SEC_A,
      is_active: true,
      section: { id: SEC_A, name: 'Section A', academic_year_id: 'year-1', academic_year: { id: 'year-1', name: '3rd Year' } },
    },
  ];

  const students = options.students ?? [
    {
      id: 'student-1',
      hu_student_id: 'HU/001',
      full_name: 'Alice',
      section_id: SEC_A,
      telegram_user_id: STUDENT_TG,
      registration_status: 'locked',
      is_locked: true,
    },
    {
      id: 'student-2',
      hu_student_id: 'HU/002',
      full_name: 'Bob',
      section_id: SEC_A,
      telegram_user_id: 33333333,
      registration_status: 'approved',
      is_locked: false,
    },
  ];

  const db: any = {
    _store: store,
    from(table: string) {
      const chain: any = {
        select: () => chain,
        insert: (data: any) => {
          const insertChain: any = {
            select: () => insertChain,
            single: async () => {
              if (table === 'announcements' && options.insertError) {
                return { data: null, error: { message: 'DB error' } };
              }
              const rows = Array.isArray(data) ? data : [data];
              const full = { id: `gen-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...rows[0] };
              store[table]?.push(full);
              return { data: full, error: null };
            },
            then: (resolve: any) => {
              if (table === 'announcement_recipients' && options.recipientInsertError) {
                return Promise.resolve({ error: { message: 'Recipient insert error' } }).then(resolve);
              }
              const rows = Array.isArray(data) ? data : [data];
              rows.forEach((r: any) => {
                const full = { id: `gen-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(), ...r };
                store[table]?.push(full);
              });
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return insertChain;
        },
        update: (data: any) => ({
          eq: (_: string, __: any) => ({ eq: (_: string, __: any) => ({ data: null, error: null }) }),
        }),
        eq: (_: string, __: any) => chain,
        order: () => chain,
        range: () => chain,
        single: async () => {
          if (table === 'announcements') {
            const last = store.announcements[store.announcements.length - 1];
            return last ? { data: last, error: null } : { data: null, error: { message: 'Not found' } };
          }
          return { data: null, error: null };
        },
        then(resolve: any) {
          if (table === 'profiles') {
            return Promise.resolve({ data: repProfile, error: null }).then(resolve);
          }
          if (table === 'representative_assignments') {
            return Promise.resolve({ data: repAssignments, error: null }).then(resolve);
          }
          if (table === 'students') {
            return Promise.resolve({ data: students, error: null }).then(resolve);
          }
          if (table === 'announcement_recipients') {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
        },
      };
      chain.maybeSingle = async () => {
        if (table === 'profiles') return { data: repProfile, error: null };
        return { data: null, error: null };
      };
      return chain;
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'test/path' }, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };

  return db;
}

describe('Announcement Service (Issue 3)', () => {
  describe('1. Section authorization', () => {
    it('rejects announcement creation for unassigned section', async () => {
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db);

      await assert.rejects(
        () => svc.createAndDispatch(REP_TG, PROFILE_ID, {
          sectionId: SEC_B,  // Not assigned
          academicYearId: 'year-1',
          title: 'Test Announcement',
          content: 'Test announcement body',
        }),
        UnauthorizedSectionScopeError
      );
    });

    it('allows announcement creation for assigned section', async () => {
      const sent: number[] = [];
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db, async (chatId: number) => {
        sent.push(chatId);
      });

      const result = await svc.createAndDispatch(REP_TG, PROFILE_ID, {
        sectionId: SEC_A,
        academicYearId: 'year-1',
        title: 'Test Announcement',
        content: 'Valid announcement for the section',
      });

      assert.ok(result.success, 'Should succeed');
      assert.ok(result.announcementId, 'Should have an ID');
      assert.equal(result.dispatchedCount, 2, 'Should dispatch to 2 students');
      assert.equal(result.failedCount, 0);
      assert.equal(sent.length, 2);
      assert.ok(sent.includes(STUDENT_TG));
    });
  });

  describe('2. Body validation', () => {
    it('rejects body shorter than 5 characters', async () => {
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db);
      const result = await svc.createAndDispatch(REP_TG, PROFILE_ID, {
        sectionId: SEC_A,
        academicYearId: 'year-1',
        title: 'Hi',
        content: 'Hi',
      });
      assert.equal(result.success, false);
      assert.match(result.error!, /Title/);
    });

    it('rejects content exceeding 4000 characters', async () => {
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db);
      const result = await svc.createAndDispatch(REP_TG, PROFILE_ID, {
        sectionId: SEC_A,
        academicYearId: 'year-1',
        title: 'Valid Title',
        content: 'x'.repeat(4001),
      });
      assert.equal(result.success, false);
      assert.match(result.error!, /4000/);
    });
  });

  describe('3. Notification failure tolerance', () => {
    it('marks recipients as failed if bot sender throws but announcement still succeeds', async () => {
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db, async () => {
        throw new Error('Telegram API unavailable');
      });

      const result = await svc.createAndDispatch(REP_TG, PROFILE_ID, {
        sectionId: SEC_A,
        academicYearId: 'year-1',
        title: 'Test Announcement',
        content: 'Announcement with failing sender',
      });

      assert.ok(result.success, 'Announcement should still succeed');
      assert.equal(result.dispatchedCount, 0, 'None dispatched');
      assert.equal(result.failedCount, 2, 'Both failed');
    });
  });

  describe('4. Database error handling', () => {
    it('returns error when announcement insert fails', async () => {
      const db = makeMockSupabase({ insertError: true });
      const svc = new AnnouncementService(db);
      const result = await svc.createAndDispatch(REP_TG, PROFILE_ID, {
        sectionId: SEC_A,
        academicYearId: 'year-1',
        title: 'Test Announcement',
        content: 'Test announcement',
      });
      assert.equal(result.success, false);
      assert.ok(result.error, 'Should have error message');
    });

    it('returns success even if recipient insert fails (announcement is preserved)', async () => {
      const db = makeMockSupabase({ recipientInsertError: true });
      const svc = new AnnouncementService(db, async () => {});
      const result = await svc.createAndDispatch(REP_TG, PROFILE_ID, {
        sectionId: SEC_A,
        academicYearId: 'year-1',
        title: 'Test Announcement',
        content: 'Test announcement with recipient error',
      });
      assert.ok(result.success, 'Should succeed even if recipients fail');
      assert.equal(result.dispatchedCount, 0);
    });
  });

  describe('5. Announcement history', () => {
    it('returns empty list when no announcements exist', async () => {
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db);
      const result = await svc.getAnnouncementHistory(REP_TG, SEC_A);
      assert.equal(result.total, 0);
      assert.equal(result.announcements.length, 0);
    });

    it('rejects history request for unassigned section', async () => {
      const db = makeMockSupabase({});
      const svc = new AnnouncementService(db);
      await assert.rejects(
        () => svc.getAnnouncementHistory(REP_TG, SEC_B),
        UnauthorizedSectionScopeError
      );
    });
  });
});
