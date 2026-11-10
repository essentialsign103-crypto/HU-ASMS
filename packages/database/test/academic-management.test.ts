// HU-ASMS: Phase 06 Academic Management Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AcademicManagementService } from '../src/academic-management.js';

describe('Phase 06 — Academic Management Service Unit Tests', () => {

  const mockCourses = [
    {
      id: 'course-1',
      code: 'SENG3112',
      title: 'Database Management Systems',
      department_id: 'dept-se',
      is_active: true,
    },
  ];

  const mockTeachers = [
    {
      id: 'teacher-1',
      full_name: 'Dr. Abebe Kebede',
      email: 'abebe.kebede@hu.edu.et',
      department_id: 'dept-se',
      is_active: true,
    },
  ];

  const mockProjects: any[] = [];
  const mockTargets: any[] = [];
  const mockFileRules: any[] = [];

  function createMockSupabaseClient() {
    return {
      from: (table: string) => {
        if (table === 'courses') {
          return {
            select: () => ({
              order: () => ({ data: mockCourses, error: null }),
              eq: (_col: string, val: unknown) => ({
                maybeSingle: async () => {
                  const match = mockCourses.find((c) => c.id === val);
                  return { data: match || null, error: null };
                },
              }),
            }),
            insert: (data: any) => {
              if (mockCourses.some((c) => c.code === data.code)) {
                return {
                  select: () => ({
                    single: async () => ({
                      data: null,
                      error: { code: '23505', message: 'duplicate key' },
                    }),
                  }),
                };
              }
              const newCourse = { id: `course-${mockCourses.length + 1}`, ...data };
              mockCourses.push(newCourse);
              return {
                select: () => ({
                  single: async () => ({ data: newCourse, error: null }),
                }),
              };
            },
            update: (updates: any) => ({
              eq: (_col: string, val: unknown) => ({
                select: () => ({
                  single: async () => {
                    const idx = mockCourses.findIndex((c) => c.id === val);
                    if (idx !== -1) mockCourses[idx] = { ...mockCourses[idx], ...updates };
                    return { data: mockCourses[idx], error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'teachers') {
          return {
            select: () => ({
              order: () => ({ data: mockTeachers, error: null }),
              eq: (_col: string, val: unknown) => ({
                maybeSingle: async () => {
                  const match = mockTeachers.find((t) => t.id === val);
                  return { data: match || null, error: null };
                },
              }),
            }),
            insert: (data: any) => {
              const newTeacher = { id: `teacher-${mockTeachers.length + 1}`, ...data };
              mockTeachers.push(newTeacher);
              return {
                select: () => ({
                  single: async () => ({ data: newTeacher, error: null }),
                }),
              };
            },
            update: (updates: any) => ({
              eq: (_col: string, val: unknown) => ({
                select: () => ({
                  single: async () => {
                    const idx = mockTeachers.findIndex((t) => t.id === val);
                    if (idx !== -1) mockTeachers[idx] = { ...mockTeachers[idx], ...updates };
                    return { data: mockTeachers[idx], error: null };
                  },
                }),
              }),
            }),
          };
        }

        if (table === 'projects') {
          return {
            insert: (data: any) => {
              const newProject = {
                id: `proj-${mockProjects.length + 1}`,
                ...data,
                course: mockCourses.find((c) => c.id === data.course_id),
                teacher: mockTeachers.find((t) => t.id === data.teacher_id),
              };
              mockProjects.push(newProject);
              return {
                select: () => ({
                  single: async () => ({ data: newProject, error: null }),
                }),
              };
            },
            delete: () => ({
              eq: (_col: string, idVal: string) => {
                const idx = mockProjects.findIndex((p) => p.id === idVal);
                if (idx !== -1) mockProjects.splice(idx, 1);
                return Promise.resolve({ data: null, error: null });
              },
            }),
            select: () => ({
              eq: (_col: string, val: unknown) => ({
                eq: (_col2: string, _activeVal: unknown) => ({
                  lte: () => ({
                    gte: () => ({
                      or: (cond1: string) => ({
                        or: (cond2: string) => ({
                          maybeSingle: async () => {
                            // Scope matching logic
                            const project = mockProjects.find((p) => p.id === val);
                            if (!project) return { data: null, error: null };

                            const targets = mockTargets.filter((t) => t.project_id === project.id);
                            // check if any target matches year or section
                            const matchesYear = targets.some((t) => cond1.includes(t.academic_year_id));
                            const matchesSec = targets.some(
                              (t) => !t.section_id || cond2.includes(t.section_id)
                            );

                            if (matchesYear && matchesSec) {
                              return { data: project, error: null };
                            }
                            return { data: null, error: null };
                          },
                        }),
                      }),
                    }),
                  }),
                }),
                maybeSingle: async () => {
                  const match = mockProjects.find((p) => p.id === val);
                  return {
                    data: match
                      ? {
                          ...match,
                          targets: mockTargets.filter((t) => t.project_id === match.id),
                          file_rules: mockFileRules.find((f) => f.project_id === match.id),
                        }
                      : null,
                    error: null,
                  };
                },
              }),
            }),
          };
        }

        if (table === 'project_targets') {
          return {
            insert: (payloads: any[]) => {
              mockTargets.push(...payloads);
              return {
                select: () => Promise.resolve({ data: payloads, error: null }),
              };
            },
          };
        }

        if (table === 'project_file_rules') {
          return {
            insert: (rule: any) => {
              mockFileRules.push(rule);
              return {
                select: () => ({
                  single: async () => ({ data: rule, error: null }),
                }),
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    } as any;
  }

  describe('1. Course Management', () => {
    it('should create a valid academic course with normalized code', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());
      const course = await service.createCourse({
        code: 'seng3121', // lowercase input
        title: 'Software Architecture and Design',
        department_id: 'dept-se',
      });

      assert.equal(course.code, 'SENG3121', 'Course code must be uppercase');
      assert.equal(course.title, 'Software Architecture and Design');
      assert.equal(course.is_active, true);
    });

    it('should prevent duplicate course codes', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createCourse({
            code: 'SENG3112', // Already exists in mockCourses
            title: 'Another Database Course',
            department_id: 'dept-se',
          });
        },
        /already exists/
      );
    });

    it('should require department_id and title', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createCourse({
            code: 'COSC101',
            title: '',
            department_id: 'dept-cs',
          });
        },
        /Course code and title are required/
      );
    });
  });

  describe('2. Teacher Management', () => {
    it('should create and update teacher delivery recipient records', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());
      const teacher = await service.createTeacher({
        full_name: 'Mr. Dawit Tadesse',
        email: 'dawit.tadesse@hu.edu.et',
        phone: '+251911000002',
        department_id: 'dept-cs',
      });

      assert.equal(teacher.full_name, 'Mr. Dawit Tadesse');
      assert.equal(teacher.email, 'dawit.tadesse@hu.edu.et');

      // Update teacher phone
      const updated = await service.updateTeacher(teacher.id, {
        phone: '+251911999999',
      });
      assert.equal(updated.phone, '+251911999999');
    });

    it('should reject invalid teacher names', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createTeacher({ full_name: 'D' });
        },
        /at least 3 characters/
      );
    });
  });

  describe('3. Dynamic Project Creation & Multi-Scope Targeting', () => {
    it('should create a project with multi-section targets and file constraints', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      const openingDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const deadline = new Date(Date.now() + 86400000 * 14).toISOString(); // 14 days from now

      const project = await service.createProject({
        course_id: 'course-1',
        teacher_id: 'teacher-1',
        title: 'Hospital Database Normalization Project',
        description: 'Complete 3NF/BCNF normalization and submit schema PDF.',
        submission_type: 'individual',
        opening_date: openingDate,
        deadline: deadline,
        resubmission_allowed: true,
        targets: [
          { academic_year_id: 'year-3', section_id: 'sec-3b' },
          { academic_year_id: 'year-3', section_id: 'sec-3a' },
        ],
        file_rules: {
          allowed_extensions: ['pdf'],
          max_file_size_bytes: 20971520, // 20 MB
          min_group_size: 1,
          max_group_size: 1,
        },
      });

      assert.ok(project.id);
      assert.equal(project.title, 'Hospital Database Normalization Project');
      assert.equal(project.targets.length, 2, 'Must create both section targets');
      assert.deepEqual(project.file_rules.allowed_extensions, ['pdf']);
      assert.equal(project.file_rules.max_file_size_bytes, 20971520);
    });

    it('should reject deadline earlier than or equal to opening date', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createProject({
            course_id: 'course-1',
            teacher_id: 'teacher-1',
            title: 'Invalid Date Assignment',
            submission_type: 'individual',
            opening_date: '2026-11-15T00:00:00Z',
            deadline: '2026-11-10T00:00:00Z', // Before opening date!
            targets: [{ academic_year_id: 'year-3' }],
            file_rules: { allowed_extensions: ['pdf'] },
          });
        },
        /Project deadline must be set after opening date/
      );
    });

    it('should reject project with no targets', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createProject({
            course_id: 'course-1',
            teacher_id: 'teacher-1',
            title: 'Targetless Project',
            submission_type: 'individual',
            opening_date: '2026-11-10T00:00:00Z',
            deadline: '2026-11-20T00:00:00Z',
            targets: [], // Empty!
            file_rules: { allowed_extensions: ['pdf'] },
          });
        },
        /must be targeted to at least one academic year/
      );
    });

    it('should reject invalid group bounds (min > max)', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      await assert.rejects(
        async () => {
          await service.createProject({
            course_id: 'course-1',
            teacher_id: 'teacher-1',
            title: 'Invalid Group Bounds Project',
            submission_type: 'group',
            opening_date: '2026-11-10T00:00:00Z',
            deadline: '2026-11-20T00:00:00Z',
            targets: [{ academic_year_id: 'year-3' }],
            file_rules: {
              allowed_extensions: ['pdf'],
              min_group_size: 5,
              max_group_size: 3, // Min is greater than Max!
            },
          });
        },
        /cannot exceed maximum group size/
      );
    });
  });

  describe('4. Scope-based Eligibility Resolution', () => {
    it('should resolve eligibility for targeted section and reject un-targeted section', async () => {
      const service = new AcademicManagementService(createMockSupabaseClient());

      // Project targeted to 3rd Year Section B and Section A
      const isEligibleFor3B = await service.isProjectEligibleForScope(
        'proj-1',
        'year-3',
        'sec-3b'
      );
      assert.equal(isEligibleFor3B, true, 'Section 3B student must be eligible');

      // Student in 2nd Year Section A
      const isEligibleFor2A = await service.isProjectEligibleForScope(
        'proj-1',
        'year-2',
        'sec-2a'
      );
      assert.equal(isEligibleFor2A, false, 'Section 2A student must not be eligible');
    });
  });

});
