// HU-ASMS: Course Offering Service Unit Tests (Phase A — Core Workflow)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CourseOfferingService,
  type CreateCourseOfferingDTO,
} from '@hu-asms/database';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockSupabase(overrides: Record<string, any> = {}) {
  const store: Record<string, any[]> = {
    courses: [
      { id: 'course-oop', code: 'CS301', title: 'Object-Oriented Programming', is_active: true, department_id: 'dept-cs' },
      { id: 'course-db',  code: 'CS305', title: 'Database Systems',           is_active: true, department_id: 'dept-cs' },
      { id: 'course-net', code: 'CS310', title: 'Computer Networks',           is_active: true, department_id: 'dept-cs' },
    ],
    course_section_offerings: [] as any[],
  };

  const makeChain = (tableName: string, rows: any[], err: any = null) => {
    let filtered = [...rows];
    const eqFilters: Array<[string, any]> = [];
    let insertData: any = null;
    let updateData: any = null;
    let isSingle = false;
    let isMaybeSingle = false;
    let selectedColumns = '*';
    let orderCol: string | null = null;

    const chain: any = {
      select(cols = '*') { selectedColumns = cols; return chain; },
      eq(col: string, val: any)  { eqFilters.push([col, val]); return chain; },
      order() { return chain; },
      insert(d: any) { insertData = d; return chain; },
      update(d: any) { updateData = d; return chain; },
      single()      { isSingle = true; return chain; },
      maybeSingle() { isMaybeSingle = true; return chain; },
      or() { return chain; }, // accept filtering calls we don't need to simulate

      // Thenable — resolves when awaited
      then(onFulfilled: any, onRejected: any) {
        const promise = (async () => {
          if (err) return { data: null, error: err };

          if (insertData) {
            const toInsert = Array.isArray(insertData) ? insertData : [insertData];
            const inserted: any[] = [];
            for (const row of toInsert) {
              const full = {
                id: `gen-${Math.random().toString(36).slice(2)}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...row,
                // Augment with joined relations for teachers / sections / courses
                course: store.courses.find((c) => c.id === row.course_id) || null,
                teacher: { id: row.teacher_id, full_name: 'Dr. Test', is_active: true },
                section: { id: row.section_id, name: 'Section B', academic_year_id: row.academic_year_id, academic_year: { id: row.academic_year_id, name: '3rd Year', year_level: 3, is_active: true } },
                academic_year: { id: row.academic_year_id, name: '3rd Year', year_level: 3, is_active: true },
              };
              store[tableName].push(full);
              inserted.push(full);
            }
            const result = isSingle ? inserted[0] : inserted;
            return { data: result, error: null };
          }

          if (updateData) {
            let updated = false;
            for (let i = 0; i < store[tableName].length; i++) {
              const row = store[tableName][i];
              const matches = eqFilters.every(([col, val]) => row[col] === val);
              if (matches) {
                store[tableName][i] = { ...row, ...updateData };
                updated = true;
              }
            }
            return { data: updated ? { count: 1 } : null, error: null };
          }

          // Apply eq filters
          filtered = store[tableName].filter((row) =>
            eqFilters.every(([col, val]) => row[col] === val)
          );

          if (isSingle) {
            return filtered.length > 0
              ? { data: filtered[0], error: null }
              : { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
          }
          if (isMaybeSingle) {
            return { data: filtered[0] ?? null, error: null };
          }
          return { data: filtered, error: null };
        })();
        return promise.then(onFulfilled, onRejected);
      },
    };
    return chain;
  };

  return {
    _store: store,
    from(tableName: string) {
      if (overrides[tableName]) return overrides[tableName];
      const rows = store[tableName] ?? [];
      return makeChain(tableName, rows);
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase A — CourseOfferingService', () => {
  const SECTION_3B = 'section-3b';
  const SECTION_2A = 'section-2a';
  const YEAR_3 = 'year-3';
  const TEACHER_A = 'teacher-a';

  describe('1. getAvailableCatalogCourses', () => {
    it('returns all catalog courses when no offerings exist for the section', async () => {
      const db = makeMockSupabase();
      const svc = new CourseOfferingService(db);

      const courses = await svc.getAvailableCatalogCourses(SECTION_3B, YEAR_3);
      assert.equal(courses.length, 3);
    });

    it('excludes already-offered courses from the available list', async () => {
      const db = makeMockSupabase();
      // Seed one existing offering
      db._store.course_section_offerings = [
        {
          id: 'off-1',
          course_id: 'course-oop',
          section_id: SECTION_3B,
          teacher_id: TEACHER_A,
          academic_year_id: YEAR_3,
          is_active: true,
        },
      ];

      const svc = new CourseOfferingService(db);
      const courses = await svc.getAvailableCatalogCourses(SECTION_3B, YEAR_3);

      assert.equal(courses.length, 2);
      assert.ok(courses.every((c: any) => c.id !== 'course-oop'));
    });
  });

  describe('2. createOffering', () => {
    it('creates a new course offering and returns it with joined relations', async () => {
      const db = makeMockSupabase();
      const svc = new CourseOfferingService(db);

      const dto: CreateCourseOfferingDTO = {
        course_id: 'course-db',
        section_id: SECTION_3B,
        teacher_id: TEACHER_A,
        academic_year_id: YEAR_3,
        created_by: 'rep-profile-id',
      };

      const offering = await svc.createOffering(dto);

      assert.equal(offering.course_id, 'course-db');
      assert.equal(offering.section_id, SECTION_3B);
      assert.equal(offering.teacher_id, TEACHER_A);
      assert.equal(offering.is_active, true);
      assert.ok(offering.course?.title === 'Database Systems');
    });

    it('rejects offering creation when course_id is missing', async () => {
      const db = makeMockSupabase();
      const svc = new CourseOfferingService(db);

      await assert.rejects(
        () => svc.createOffering({ course_id: '', section_id: SECTION_3B, teacher_id: TEACHER_A, academic_year_id: YEAR_3 }),
        /required/
      );
    });

    it('surfaces duplicate error from unique constraint (23505)', async () => {
      const duplicateErrorDb = makeMockSupabase({
        course_section_offerings: {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: () => ({ then: async (resolve: any) => resolve({ data: null, error: null }) }) }) }),
          from: () => {},
        },
      });
      const svc = new CourseOfferingService(duplicateErrorDb);

      await assert.rejects(
        () => svc.createOffering({ course_id: 'course-oop', section_id: SECTION_3B, teacher_id: TEACHER_A, academic_year_id: YEAR_3 }),
        /already exists/
      );
    });
  });

  describe('3. getOfferingsForSection', () => {
    it('returns offerings only for the queried section', async () => {
      const db = makeMockSupabase();
      db._store.course_section_offerings = [
        { id: 'off-3b-1', course_id: 'course-oop', section_id: SECTION_3B, teacher_id: TEACHER_A, academic_year_id: YEAR_3, is_active: true, course: { id: 'course-oop', title: 'OOP' }, teacher: { id: TEACHER_A }, section: { id: SECTION_3B }, academic_year: { id: YEAR_3 } },
        { id: 'off-2a-1', course_id: 'course-db',  section_id: SECTION_2A, teacher_id: TEACHER_A, academic_year_id: 'year-2', is_active: true, course: { id: 'course-db', title: 'DB' },   teacher: { id: TEACHER_A }, section: { id: SECTION_2A }, academic_year: { id: 'year-2' } },
      ];

      const svc = new CourseOfferingService(db);
      const result = await svc.getOfferingsForSection(SECTION_3B);

      assert.equal(result.length, 1);
      assert.equal(result[0].section_id, SECTION_3B);
    });

    it('returns empty array when section has no offerings', async () => {
      const db = makeMockSupabase();
      const svc = new CourseOfferingService(db);

      const result = await svc.getOfferingsForSection('unknown-section');
      assert.equal(result.length, 0);
    });
  });

  describe('4. deactivateOffering', () => {
    it('deactivates an offering without deleting it', async () => {
      const db = makeMockSupabase();
      db._store.course_section_offerings = [
        { id: 'off-1', course_id: 'course-oop', section_id: SECTION_3B, teacher_id: TEACHER_A, academic_year_id: YEAR_3, is_active: true },
      ];

      const svc = new CourseOfferingService(db);
      await svc.deactivateOffering('off-1', SECTION_3B);

      const updated = db._store.course_section_offerings.find((o: any) => o.id === 'off-1');
      assert.equal(updated?.is_active, false);
    });
  });

  describe('5. Cross-section isolation', () => {
    it('getOfferingById with sectionId guard returns null for another section', async () => {
      const db = makeMockSupabase();
      db._store.course_section_offerings = [
        { id: 'off-3b', course_id: 'course-oop', section_id: SECTION_3B, teacher_id: TEACHER_A, academic_year_id: YEAR_3, is_active: true, course: null, teacher: null, section: null, academic_year: null },
      ];

      const svc = new CourseOfferingService(db);
      // Requesting offering off-3b but claiming it belongs to section-2a
      const result = await svc.getOfferingById('off-3b', SECTION_2A);
      assert.equal(result, null);
    });
  });
});
