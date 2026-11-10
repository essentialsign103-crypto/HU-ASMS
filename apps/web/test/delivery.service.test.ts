// HU-ASMS: Phase 12 Teacher Delivery Service Unit Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executePrepareDeliveryBatch,
  executeDispatchDelivery,
  executeAcknowledgeDelivery,
  executeGetDeliveryPackageManifest,
  type PrepareDeliveryInput,
} from '../src/lib/rep/delivery-service.js';
import type { UserSessionContext } from '../src/lib/auth/roles.js';

describe('Phase 12 — Teacher Delivery Service Unit Tests', () => {
  const mockRepContext: UserSessionContext = {
    userId: 'user-rep-1',
    profile: {
      id: 'user-rep-1',
      telegram_user_id: 11111111,
      full_name: 'Ahmed Representative',
      email: 'rep.ahmed@haramaya.edu.et',
      role: 'representative',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    isOwner: false,
    isRepresentative: true,
    assignments: [
      {
        id: 'assign-1',
        profile_id: 'user-rep-1',
        section_id: 'sec-3b',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };

  const sampleProject = {
    id: 'proj-os-p1',
    course_id: 'course-os',
    title: 'Operating Systems Kernel Module Lab',
    submission_type: 'individual',
  };

  const sampleSubmissions = [
    {
      id: 'sub-1',
      section_id: 'sec-3b',
      project_id: 'proj-os-p1',
      student_id: 'stud-1',
      status: 'active',
    },
    {
      id: 'sub-2',
      section_id: 'sec-3b',
      project_id: 'proj-os-p1',
      student_id: 'stud-2',
      status: 'active',
    },
  ];

  function createMockSupabase(dbState: {
    project?: any;
    submissions?: any[];
    delivery?: any;
    auditLogs?: any[];
    storageSignedUrls?: Record<string, string>;
  }) {
    const insertedDeliveries: any[] = [];
    const insertedDeliveryItems: any[] = [];
    const updatedDeliveries: any[] = [];
    const insertedAuditLogs: any[] = dbState.auditLogs || [];

    const mockClient = {
      from: (table: string) => {
        if (table === 'projects') {
          return {
            select: () => ({
              eq: (_col: string, val: string) => ({
                single: async () => {
                  if (dbState.project && dbState.project.id === val) {
                    return { data: dbState.project, error: null };
                  }
                  return { data: null, error: new Error('Project not found') };
                },
              }),
            }),
          };
        }

        if (table === 'submissions') {
          return {
            select: () => ({
              in: (_col: string, ids: string[]) => {
                const subs = (dbState.submissions || []).filter((s) => ids.includes(s.id));
                return Promise.resolve({ data: subs, error: null });
              },
            }),
          };
        }

        if (table === 'deliveries') {
          return {
            insert: (record: any) => ({
              select: () => ({
                single: async () => {
                  const created = { id: 'deliv-generated-1', ...record };
                  insertedDeliveries.push(created);
                  return { data: created, error: null };
                },
              }),
            }),
            select: (cols?: string) => ({
              eq: (_col: string, id: string) => ({
                single: async () => {
                  if (dbState.delivery && dbState.delivery.id === id) {
                    return { data: dbState.delivery, error: null };
                  }
                  return { data: null, error: new Error('Delivery not found') };
                },
              }),
            }),
            update: (updateFields: any) => ({
              eq: (_col: string, id: string) => {
                updatedDeliveries.push({ id, ...updateFields });
                return Promise.resolve({ error: null });
              },
            }),
          };
        }

        if (table === 'delivery_items') {
          return {
            insert: (items: any[]) => {
              insertedDeliveryItems.push(...items);
              return Promise.resolve({ error: null });
            },
          };
        }

        if (table === 'audit_logs') {
          return {
            insert: (log: any) => {
              insertedAuditLogs.push(log);
              return Promise.resolve({ error: null });
            },
          };
        }

        throw new Error(`Unexpected table queried: ${table}`);
      },
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (storagePath: string, expiresIn: number) => {
            const url = `https://mock-storage.hu.edu.et/${bucket}/${storagePath}?expires_in=${expiresIn}&token=valid_15m`;
            return { data: { signedUrl: url }, error: null };
          },
        }),
      },
      _state: {
        insertedDeliveries,
        insertedDeliveryItems,
        updatedDeliveries,
        insertedAuditLogs,
      },
    };

    return mockClient as any;
  }

  describe('1. Delivery Batch Preparation & Scope Authorization', () => {
    it('should successfully prepare a delivery batch with submissions from assigned section', async () => {
      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: 'sec-3b',
        projectId: 'proj-os-p1',
        teacherId: 'teacher-dr-kebede',
        channel: 'telegram',
        deliveryNotes: 'Section 3B assignment submissions for grading',
        submissionIds: ['sub-1', 'sub-2'],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, true);
      assert.equal(result.deliveryId, 'deliv-generated-1');

      // Verify delivery master record
      assert.equal(mockDb._state.insertedDeliveries.length, 1);
      const delivery = mockDb._state.insertedDeliveries[0];
      assert.equal(delivery.project_id, 'proj-os-p1');
      assert.equal(delivery.section_id, 'sec-3b');
      assert.equal(delivery.course_id, 'course-os');
      assert.equal(delivery.teacher_id, 'teacher-dr-kebede');
      assert.equal(delivery.batch_count, 2);
      assert.equal(delivery.status, 'prepared');
      assert.equal(delivery.channel, 'telegram');

      // Verify delivery items attached
      assert.equal(mockDb._state.insertedDeliveryItems.length, 2);
      assert.equal(mockDb._state.insertedDeliveryItems[0].submission_id, 'sub-1');
      assert.equal(mockDb._state.insertedDeliveryItems[1].submission_id, 'sub-2');

      // Verify audit log
      assert.equal(mockDb._state.insertedAuditLogs.length, 1);
      assert.equal(mockDb._state.insertedAuditLogs[0].action, 'TEACHER_DELIVERY_PREPARED');
      assert.equal(mockDb._state.insertedAuditLogs[0].actor_role, 'representative');
    });

    it('should reject batch preparation if representative attempts to prepare for an unassigned section', async () => {
      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: 'sec-4a', // Unassigned section
        projectId: 'proj-os-p1',
        teacherId: 'teacher-dr-kebede',
        channel: 'email',
        submissionIds: ['sub-1'],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, false);
      assert.match(result.error || '', /Forbidden: Access denied for section sec-4a/);
      assert.equal(mockDb._state.insertedDeliveries.length, 0);
    });

    it('should reject batch preparation if any submission belongs to a different section', async () => {
      const foreignSubmissions = [
        { id: 'sub-1', section_id: 'sec-3b', project_id: 'proj-os-p1' },
        { id: 'sub-foreign', section_id: 'sec-3a', project_id: 'proj-os-p1' }, // Cross-section leak!
      ];

      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: foreignSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: 'sec-3b',
        projectId: 'proj-os-p1',
        teacherId: 'teacher-dr-kebede',
        channel: 'telegram',
        submissionIds: ['sub-1', 'sub-foreign'],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, false);
      assert.match(result.error || '', /Security Violation: Cannot attach submissions outside your assigned section/);
      assert.equal(mockDb._state.insertedDeliveries.length, 0);
    });

    it('should reject batch preparation if submission list is empty', async () => {
      const mockDb = createMockSupabase({
        project: sampleProject,
        submissions: sampleSubmissions,
      });

      const input: PrepareDeliveryInput = {
        sectionId: 'sec-3b',
        projectId: 'proj-os-p1',
        teacherId: 'teacher-dr-kebede',
        channel: 'telegram',
        submissionIds: [],
      };

      const result = await executePrepareDeliveryBatch(mockDb, mockRepContext, input);

      assert.equal(result.success, false);
      assert.match(result.error || '', /At least one submission must be selected/);
    });
  });

  describe('2. Delivery Dispatch & Teacher Acknowledgment Lifecycle', () => {
    it('should transition status from prepared to sent on dispatch', async () => {
      const existingDelivery = {
        id: 'deliv-101',
        section_id: 'sec-3b',
        status: 'prepared',
      };

      const mockDb = createMockSupabase({
        delivery: existingDelivery,
      });

      const result = await executeDispatchDelivery(
        mockDb,
        mockRepContext,
        'deliv-101',
        'Forwarded via Telegram to Dr. Kebede'
      );

      assert.equal(result.success, true);
      assert.equal(mockDb._state.updatedDeliveries.length, 1);
      assert.equal(mockDb._state.updatedDeliveries[0].status, 'sent');
      assert.equal(mockDb._state.updatedDeliveries[0].delivery_notes, 'Forwarded via Telegram to Dr. Kebede');
      assert.ok(mockDb._state.updatedDeliveries[0].sent_at);

      // Verify audit log
      const audit = mockDb._state.insertedAuditLogs.find((l: any) => l.action === 'TEACHER_DELIVERY_DISPATCHED');
      assert.ok(audit);
      assert.equal(audit.entity_id, 'deliv-101');
    });

    it('should transition status from sent to acknowledged on teacher confirmation', async () => {
      const existingDelivery = {
        id: 'deliv-101',
        section_id: 'sec-3b',
        status: 'sent',
      };

      const mockDb = createMockSupabase({
        delivery: existingDelivery,
      });

      const result = await executeAcknowledgeDelivery(mockDb, mockRepContext, 'deliv-101');

      assert.equal(result.success, true);
      assert.equal(mockDb._state.updatedDeliveries.length, 1);
      assert.equal(mockDb._state.updatedDeliveries[0].status, 'acknowledged');
      assert.ok(mockDb._state.updatedDeliveries[0].acknowledged_at);

      // Verify audit log
      const audit = mockDb._state.insertedAuditLogs.find((l: any) => l.action === 'TEACHER_DELIVERY_ACKNOWLEDGED');
      assert.ok(audit);
      assert.equal(audit.entity_id, 'deliv-101');
    });

    it('should reject dispatch if delivery belongs to an unassigned section', async () => {
      const outsideDelivery = {
        id: 'deliv-999',
        section_id: 'sec-5a', // Unassigned section
        status: 'prepared',
      };

      const mockDb = createMockSupabase({
        delivery: outsideDelivery,
      });

      const result = await executeDispatchDelivery(mockDb, mockRepContext, 'deliv-999');

      assert.equal(result.success, false);
      assert.match(result.error || '', /Forbidden: Access denied for section sec-5a/);
    });
  });

  describe('3. Delivery Package Manifest & Signed 15-Minute Download URLs', () => {
    it('should generate signed manifest with 15-minute expiring download links for teacher delivery', async () => {
      const deliveryWithItems = {
        id: 'deliv-package-1',
        section_id: 'sec-3b',
        course_id: 'course-os',
        teacher_id: 'teacher-dr-kebede',
        status: 'prepared',
        channel: 'telegram',
        course: { id: 'course-os', code: 'COSC301', title: 'Operating Systems' },
        teacher: { id: 'teacher-dr-kebede', full_name: 'Dr. Kebede', telegram_username: 'dr_kebede' },
        section: { id: 'sec-3b', name: 'Section B', academic_year: { name: '3rd Year' } },
        project: { id: 'proj-os-p1', title: 'OS Kernel Lab' },
        items: [
          {
            id: 'item-1',
            submission: {
              id: 'sub-ind-1',
              submission_type: 'individual',
              student: { full_name: 'Abdi Mohammed' },
              files: [
                {
                  storage_path: 'projects/p1/individual/abdi/report.pdf',
                  original_filename: 'Kernel_Lab_Abdi.pdf',
                  file_size_bytes: 2048576,
                },
              ],
            },
          },
          {
            id: 'item-2',
            submission: {
              id: 'sub-grp-1',
              submission_type: 'group',
              group: { group_code: 'Group 04' },
              files: [
                {
                  storage_path: 'projects/p1/groups/grp4/project.zip',
                  original_filename: 'Group04_Final.zip',
                  file_size_bytes: 5242880,
                },
              ],
            },
          },
        ],
      };

      const mockDb = createMockSupabase({
        delivery: deliveryWithItems,
      });

      const manifestResult = await executeGetDeliveryPackageManifest(
        mockDb,
        mockRepContext,
        'deliv-package-1'
      );

      assert.equal(manifestResult.error, undefined);
      assert.ok(manifestResult.delivery);
      assert.equal(manifestResult.items?.length, 2);

      // Verify Individual item details and signed URL
      const item1 = manifestResult.items![0];
      assert.equal(item1.submitterName, 'Abdi Mohammed');
      assert.equal(item1.fileName, 'Kernel_Lab_Abdi.pdf');
      assert.equal(item1.fileSizeBytes, 2048576);
      assert.match(item1.signedUrl, /expires_in=900/);
      assert.match(item1.signedUrl, /Kernel_Lab_Abdi\.pdf|projects\/p1\/individual/);

      // Verify Group item details and signed URL
      const item2 = manifestResult.items![1];
      assert.equal(item2.submitterName, 'Group 04 (Team)');
      assert.equal(item2.fileName, 'Group04_Final.zip');
      assert.equal(item2.fileSizeBytes, 5242880);
      assert.match(item2.signedUrl, /expires_in=900/);
    });

    it('should reject manifest generation when representative is not assigned to delivery section', async () => {
      const outsideDelivery = {
        id: 'deliv-out-1',
        section_id: 'sec-1a',
        items: [],
      };

      const mockDb = createMockSupabase({
        delivery: outsideDelivery,
      });

      const manifestResult = await executeGetDeliveryPackageManifest(
        mockDb,
        mockRepContext,
        'deliv-out-1'
      );

      assert.match(manifestResult.error || '', /Forbidden: Access denied for section sec-1a/);
    });
  });
});
