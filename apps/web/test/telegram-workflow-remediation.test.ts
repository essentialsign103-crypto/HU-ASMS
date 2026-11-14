// HU-ASMS: Comprehensive Telegram Workflow Remediation Unit & Integration Tests (Phase 5)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramNotificationService } from '../src/lib/notifications/telegram-notification-service';
import {
  executeAssignRepresentative,
  executeDeactivateRepresentative,
  executeReassignRepresentative,
} from '../src/lib/admin/representative-management-service';
import {
  executePrepareDeliveryBatch,
  executeDispatchDelivery,
  executeAcknowledgeDelivery,
  executeFailDelivery,
} from '../src/lib/rep/delivery-service';
import type { UserSessionContext } from '../src/lib/auth/roles';

// Canonical Test Identifiers
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const REP_USER_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_APPROVED_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_UNAPPROVED_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_SUSPENDED_ID = '55555555-5555-4555-8555-555555555555';
const SEC_3B_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEC_2A_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const YEAR_3_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const YEAR_2_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROJ_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEACHER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SUB_1_ID = '99999999-9999-4999-8999-999999999991';
const SUB_2_ID = '99999999-9999-4999-8999-999999999992';
const ASSIGN_ID = '77777777-7777-4777-8777-777777777777';
const DELIV_ID = '88888888-8888-4888-8888-888888888888';

function createOwnerContext(): UserSessionContext {
  return {
    userId: OWNER_ID,
    email: 'admin@hu.edu.et',
    isOwner: true,
    isRepresentative: false,
    assignments: [],
    profile: {
      id: OWNER_ID,
      role: 'system_owner',
      full_name: 'Dr. System Owner',
      email: 'admin@hu.edu.et',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

function createRepContext(assignedSectionIds: string[] = [SEC_3B_ID]): UserSessionContext {
  return {
    userId: REP_USER_ID,
    email: 'rep@hu.edu.et',
    isOwner: false,
    isRepresentative: true,
    assignments: assignedSectionIds.map((secId) => ({
      id: `assign-${secId}`,
      profile_id: REP_USER_ID,
      section_id: secId,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    profile: {
      id: REP_USER_ID,
      role: 'representative',
      full_name: 'Hamza Representative',
      email: 'rep@hu.edu.et',
      telegram_user_id: 11111111,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

describe('Telegram Workflow Audit & Remediation Test Suite', () => {
  describe('Workflow 1: Student Approval & Rejection Notifications', () => {
    it('approved student receives clear Telegram notification and record is marked sent', async () => {
      const persistedNotifications: any[] = [];
      let sentChatId: number | null = null;
      let sentMessage: string | null = null;

      const mockBotSender = async (chatId: number, message: string) => {
        sentChatId = chatId;
        sentMessage = message;
      };

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'notifications') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
              insert: (record: any) => {
                const row = { id: 'notif-1', ...record };
                persistedNotifications.push(row);
                return {
                  select: () => ({
                    maybeSingle: async () => ({ data: row, error: null }),
                  }),
                };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const service = new TelegramNotificationService(mockSupabase, mockBotSender);
      const res = await service.sendStudentApprovalNotification({
        telegramUserId: 987654321,
        fullName: 'Abdi Bekele',
        huStudentId: 'HU/10294/14',
        departmentName: 'Software Engineering',
        academicScope: '3rd Year — Section B',
        requestId: 'req-123',
      });

      assert.equal(res.success, true);
      assert.equal(sentChatId, 987654321);
      assert.ok(sentMessage);
      assert.match(sentMessage!, /Registration Approved!/);
      assert.match(sentMessage!, /Abdi Bekele/);
      assert.match(sentMessage!, /HU\/10294\/14/);
      assert.equal(persistedNotifications.length, 1);
      assert.equal(persistedNotifications[0].status, 'sent');
      assert.equal(persistedNotifications[0].recipient_telegram_id, 987654321);
    });

    it('rejected student receives notification with reason and record is marked sent', async () => {
      const persistedNotifications: any[] = [];
      let sentMessage: string | null = null;

      const mockBotSender = async (_chatId: number, msg: string) => {
        sentMessage = msg;
      };

      const mockSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
          }),
          insert: (record: any) => {
            persistedNotifications.push(record);
            return { select: () => ({ maybeSingle: async () => ({ data: record }) }) };
          },
        }),
      } as any;

      const service = new TelegramNotificationService(mockSupabase, mockBotSender);
      const res = await service.sendStudentRejectionNotification({
        telegramUserId: 987654321,
        fullName: 'Abdi Bekele',
        huStudentId: 'HU/10294/14',
        reason: 'Student ID does not match registrar records',
        requestId: 'req-124',
      });

      assert.equal(res.success, true);
      assert.ok(sentMessage);
      assert.match(sentMessage!, /Registration Request Rejected/);
      assert.match(sentMessage!, /Student ID does not match registrar records/);
      assert.equal(persistedNotifications[0].status, 'sent');
    });

    it('records failed status and error message when Telegram API fails (non-blocking)', async () => {
      const persistedNotifications: any[] = [];

      const mockFailingBotSender = async () => {
        throw new Error('Forbidden: bot was blocked by the user');
      };

      const mockSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
          }),
          insert: (record: any) => {
            persistedNotifications.push(record);
            return { select: () => ({ maybeSingle: async () => ({ data: record }) }) };
          },
        }),
      } as any;

      const service = new TelegramNotificationService(mockSupabase, mockFailingBotSender);
      const res = await service.sendStudentApprovalNotification({
        telegramUserId: 987654321,
        fullName: 'Blocked User',
        huStudentId: 'HU/10295/14',
        requestId: 'req-blocked',
      });

      assert.equal(res.success, false);
      assert.match(res.error || '', /bot was blocked by the user/);
      assert.equal(persistedNotifications.length, 1);
      assert.equal(persistedNotifications[0].status, 'failed');
      assert.match(persistedNotifications[0].error_message, /bot was blocked by the user/);
    });

    it('retrying a notification updates retry count without creating duplicate events', async () => {
      let retryCountUpdated = 0;
      let newStatus = '';

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'notifications') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'notif-failed-1',
                      recipient_telegram_id: 987654321,
                      message: 'Test alert',
                      status: 'failed',
                      retry_count: 0,
                    },
                    error: null,
                  }),
                }),
              }),
              update: (fields: any) => {
                newStatus = fields.status;
                retryCountUpdated = fields.retry_count;
                return {
                  eq: async () => ({ error: null }),
                };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const mockSuccessBotSender = async () => {};
      const service = new TelegramNotificationService(mockSupabase, mockSuccessBotSender);
      const res = await service.retryNotification('notif-failed-1');

      assert.equal(res.success, true);
      assert.equal(newStatus, 'sent');
      assert.equal(retryCountUpdated, 1);
    });
  });

  describe('Workflow 2: Representative Assignment & Scope Lifecycle', () => {
    it('eligible approved and locked student can be assigned as representative', async () => {
      let insertedProfile: any = null;
      let insertedAssignment: any = null;
      let notificationSent = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Sara Student',
                      department_id: 'dept-1',
                      academic_year_id: YEAR_3_ID,
                      section_id: SEC_3B_ID,
                      telegram_user_id: 12345678,
                      telegram_username: 'sarastudent',
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SEC_3B_ID,
                      name: 'Section B',
                      academic_year_id: YEAR_3_ID,
                      academic_year: { id: YEAR_3_ID, name: '3rd Year' },
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
              upsert: async (record: any) => {
                insertedProfile = record;
                return { error: null };
              },
            };
          }
          if (table === 'representative_assignments') {
            return {
              upsert: (record: any) => {
                insertedAssignment = record;
                return {
                  select: () => ({
                    single: async () => ({ data: { id: ASSIGN_ID, ...record }, error: null }),
                  }),
                };
              },
            };
          }
          if (table === 'audit_logs') {
            return {
              insert: async () => ({ error: null }),
            };
          }
          if (table === 'notifications') {
            return {
              select: () => ({
                eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
              }),
              insert: () => {
                notificationSent = true;
                return { select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-act' } }) }) };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
        rpc: async (fnName: string, params: any) => {
          if (fnName === 'provision_representative_profile') {
            insertedProfile = {
              id: params.p_profile_id,
              role: 'representative',
              full_name: params.p_full_name,
              email: params.p_email,
              telegram_user_id: params.p_telegram_user_id,
              telegram_username: params.p_telegram_username,
              is_active: true,
            };
            return {
              data: { success: true, profile_id: params.p_profile_id, action: 'created' },
              error: null,
            };
          }
          throw new Error(`Unexpected RPC: ${fnName}`);
        },
      } as any;

      const mockBotSender = async () => {};
      
      // Mock admin client for auth user creation
      const mockAdminClient = {
        auth: {
          admin: {
            createUser: async (params: any) => ({
              data: {
                user: {
                  id: 'auth-user-id-for-rep',
                  email: params.email,
                  user_metadata: params.user_metadata,
                },
              },
              error: null,
            }),
          },
        },
      } as any;
      
      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        {
          studentId: STUDENT_APPROVED_ID,
          sectionId: SEC_3B_ID,
        },
        { botSender: mockBotSender, adminClient: mockAdminClient }
      );

      assert.equal(res.success, true);
      assert.equal(res.assignmentId, ASSIGN_ID);
      assert.ok(insertedProfile);
      assert.equal(insertedProfile.role, 'representative');
      assert.equal(insertedProfile.is_active, true);
      assert.ok(insertedAssignment);
      assert.equal(insertedAssignment.section_id, SEC_3B_ID);
      assert.equal(insertedAssignment.is_active, true);
      assert.equal(notificationSent, true);
    });

    it('ineligible unapproved student cannot be assigned as representative', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_UNAPPROVED_ID,
                      hu_student_id: 'HU/10295/14',
                      full_name: 'Pending Student',
                      registration_status: 'pending',
                      is_locked: false,
                      telegram_user_id: 88888888,
                    },
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        {
          studentId: STUDENT_UNAPPROVED_ID,
          sectionId: SEC_3B_ID,
        },
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.match(res.error || '', /Only approved and permanently locked students/);
    });

    it('rejects assigning representative across different sections within the same academic year', async () => {
      const SEC_3A_ID = '33333333-3333-3333-3333-333333333331';
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Third Year Section B Student',
                      academic_year_id: YEAR_3_ID,
                      section_id: SEC_3B_ID, // Enrolled in Section B
                      telegram_user_id: 12345678,
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SEC_3A_ID, // Target is Section A
                      name: 'Section A (Year 3)',
                      academic_year_id: YEAR_3_ID,
                    },
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        {
          studentId: STUDENT_APPROVED_ID,
          sectionId: SEC_3A_ID,
        },
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.match(res.error || '', /Representative must represent their exact enrolled section/);
    });

    it('rejects student with NULL section_id (fail-closed)', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Unassigned Student',
                      academic_year_id: YEAR_3_ID,
                      section_id: null, // NULL section
                      telegram_user_id: 12345678,
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        {
          studentId: STUDENT_APPROVED_ID,
          sectionId: SEC_3B_ID,
        },
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.match(res.error || '', /section_id is NULL/i);
    });

    it('rejects student with NULL academic_year_id (fail-closed)', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'No Year Student',
                      academic_year_id: null, // NULL year
                      section_id: SEC_3B_ID,
                      telegram_user_id: 12345678,
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        {
          studentId: STUDENT_APPROVED_ID,
          sectionId: SEC_3B_ID,
        },
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.match(res.error || '', /academic_year_id is NULL/i);
    });

    it('resolves existing Auth account safely via verified metadata hu_student_id without duplicate creation', async () => {
      let createUserCalled = false;
      const EXISTING_AUTH_ID = 'existing-auth-user-999';

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Verified Student',
                      department_id: 'dept-1',
                      academic_year_id: YEAR_3_ID,
                      section_id: SEC_3B_ID,
                      telegram_user_id: 12345678,
                      telegram_username: 'verified_user',
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SEC_3B_ID,
                      name: 'Section B',
                      academic_year_id: YEAR_3_ID,
                      academic_year: { id: YEAR_3_ID, name: '3rd Year' },
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
            };
          }
          if (table === 'representative_assignments') {
            return {
              upsert: () => ({
                select: () => ({ single: async () => ({ data: { id: ASSIGN_ID }, error: null }) }),
              }),
            };
          }
          if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
          if (table === 'notifications') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
              insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-1' } }) }) }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
        rpc: async (fn: string, params: any) => {
          if (fn === 'provision_representative_profile') {
            return { data: { success: true, profile_id: params.p_profile_id }, error: null };
          }
          throw new Error(`Unexpected RPC: ${fn}`);
        },
      } as any;

      const mockAdminClient = {
        auth: {
          admin: {
            listUsers: async () => ({
              data: {
                users: [
                  {
                    id: EXISTING_AUTH_ID,
                    email: 'hu1029414@hu.edu.et',
                    user_metadata: { hu_student_id: 'HU/10294/14', full_name: 'Verified Student' },
                  },
                ],
              },
              error: null,
            }),
            createUser: async () => {
              createUserCalled = true;
              return { data: null, error: new Error('Should not be called') };
            },
          },
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        { studentId: STUDENT_APPROVED_ID, sectionId: SEC_3B_ID },
        { adminClient: mockAdminClient, skipNotification: true }
      );

      assert.equal(res.success, true);
      assert.equal(createUserCalled, false, 'createUser must not be called when user matches verified metadata');
      assert.equal(res.profileId, EXISTING_AUTH_ID);
    });

    it('rejects blind adoption of Auth user by email when metadata hu_student_id does not match', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Target Student',
                      academic_year_id: YEAR_3_ID,
                      section_id: SEC_3B_ID,
                      telegram_user_id: 12345678,
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SEC_3B_ID,
                      name: 'Section B',
                      academic_year_id: YEAR_3_ID,
                      academic_year: { id: YEAR_3_ID, name: '3rd Year' },
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const mockAdminClient = {
        auth: {
          admin: {
            listUsers: async () => ({
              data: {
                users: [
                  {
                    id: 'foreign-user-id',
                    email: 'hu1029414@hu.edu.et',
                    user_metadata: { hu_student_id: 'HU/99999/99' }, // Belongs to a DIFFERENT student!
                  },
                ],
              },
              error: null,
            }),
            createUser: async () => ({
              data: null,
              error: { message: 'A user with this email address has already been registered', status: 422 },
            }),
          },
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        { studentId: STUDENT_APPROVED_ID, sectionId: SEC_3B_ID },
        { adminClient: mockAdminClient, skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.match(res.error || '', /registered to a different student or administrator/i);
    });

    it('safely provisions unique non-routable internal UPN when email collision occurs with unverified account', async () => {
      let createdEmail: string | null = null;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Target Student',
                      department_id: 'dept-1',
                      academic_year_id: YEAR_3_ID,
                      section_id: SEC_3B_ID,
                      telegram_user_id: 12345678,
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SEC_3B_ID,
                      name: 'Section B',
                      academic_year_id: YEAR_3_ID,
                      academic_year: { id: YEAR_3_ID, name: '3rd Year' },
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
            };
          }
          if (table === 'representative_assignments') {
            return {
              upsert: () => ({
                select: () => ({ single: async () => ({ data: { id: ASSIGN_ID }, error: null }) }),
              }),
            };
          }
          if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
          if (table === 'notifications') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
              insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-1' } }) }) }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
        rpc: async (fn: string, params: any) => {
          if (fn === 'provision_representative_profile') {
            return { data: { success: true, profile_id: params.p_profile_id }, error: null };
          }
          throw new Error(`Unexpected RPC: ${fn}`);
        },
      } as any;

      const mockAdminClient = {
        auth: {
          admin: {
            listUsers: async () => ({
              data: {
                users: [
                  {
                    id: 'unverified-user-id',
                    email: 'hu1029414@hu.edu.et',
                    user_metadata: {}, // Missing hu_student_id metadata!
                  },
                ],
              },
              error: null,
            }),
            createUser: async (params: any) => {
              if (params.email === 'hu1029414@hu.edu.et') {
                return {
                  data: null,
                  error: { message: 'A user with this email address has already been registered', status: 422 },
                };
              }
              // Fallback internal UPN
              createdEmail = params.email;
              return {
                data: {
                  user: {
                    id: 'upn-auth-user-id',
                    email: params.email,
                    user_metadata: params.user_metadata,
                  },
                },
                error: null,
              };
            },
          },
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        { studentId: STUDENT_APPROVED_ID, sectionId: SEC_3B_ID },
        { adminClient: mockAdminClient, skipNotification: true }
      );

      assert.equal(res.success, true);
      assert.equal(createdEmail, `rep_${STUDENT_APPROVED_ID}@auth.hu-asms.internal`);
      assert.equal(res.profileId, 'upn-auth-user-id');
    });

    it('student cannot be assigned to an incompatible academic scope (cross-year)', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'students') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: STUDENT_APPROVED_ID,
                      hu_student_id: 'HU/10294/14',
                      full_name: 'Second Year Student',
                      academic_year_id: YEAR_2_ID,
                      section_id: SEC_2A_ID,
                      telegram_user_id: 12345678,
                      registration_status: 'locked',
                      is_locked: true,
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SEC_3B_ID,
                      name: 'Section B (Year 3)',
                      academic_year_id: YEAR_3_ID,
                    },
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeAssignRepresentative(
        mockSupabase,
        createOwnerContext(),
        {
          studentId: STUDENT_APPROVED_ID,
          sectionId: SEC_3B_ID, // Mismatched year
        },
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.match(res.error || '', /incompatible academic year or scope/);
    });

    it('deactivating representative sets is_active to false and dispatches notification', async () => {
      let assignmentDeactivated = false;
      let notificationDispatched = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: ASSIGN_ID,
                      profile_id: REP_USER_ID,
                      section_id: SEC_3B_ID,
                      is_active: true,
                      profile: { telegram_user_id: 11111111, full_name: 'Hamza Rep' },
                      section: { name: 'Section B', academic_year: { name: '3rd Year' } },
                    },
                  }),
                  eq: async () => ({
                    data: [], // No remaining active assignments
                  }),
                }),
              }),
              update: (fields: any) => {
                if (fields.is_active === false) assignmentDeactivated = true;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'profiles') {
            return {
              update: () => ({ eq: async () => ({ error: null }) }),
            };
          }
          if (table === 'audit_logs') {
            return { insert: async () => ({ error: null }) };
          }
          if (table === 'notifications') {
            return {
              select: () => ({
                eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
              }),
              insert: () => {
                notificationDispatched = true;
                return { select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-deact' } }) }) };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        { botSender: async () => {} }
      );

      assert.equal(res.success, true);
      assert.equal(assignmentDeactivated, true);
      assert.equal(notificationDispatched, true);
    });

    it('deactivation query explicitly disambiguates profile foreign key constraint', async () => {
      let capturedSelect: string | null = null;
      let capturedAssignmentId: string | null = null;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: (cols: string) => {
                if (!capturedSelect) capturedSelect = cols;
                return {
                  eq: (col: string, val: string) => {
                    if (col === 'id') capturedAssignmentId = val;
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: ASSIGN_ID,
                          profile_id: REP_USER_ID,
                          section_id: SEC_3B_ID,
                          is_active: true,
                          profile: { telegram_user_id: 11111111, full_name: 'Hamza Rep' },
                          section: { name: 'Section B', academic_year: { name: '3rd Year' } },
                        },
                        error: null,
                      }),
                      eq: async () => ({ data: [] }),
                    };
                  },
                };
              },
              update: () => ({ eq: async () => ({ error: null }) }),
            };
          }
          if (table === 'profiles') return { update: () => ({ eq: async () => ({ error: null }) }) };
          if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
          if (table === 'notifications') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
              insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-1' } }) }) }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        { skipNotification: true }
      );

      assert.equal(res.success, true);
      assert.equal(capturedAssignmentId, ASSIGN_ID);
      assert.ok(capturedSelect, 'Query must perform a select');
      assert.match(
        capturedSelect!,
        /profile:profiles!representative_assignments_profile_id_fkey/i,
        'Select must explicitly disambiguate profile foreign key relationship'
      );
    });

    it('deactivation of nonexistent assignment ID returns actual not-found error', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        '00000000-0000-0000-0000-000000000000',
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.equal(res.error, 'Representative assignment record not found.');
    });

    it('distinguishes PostgREST relationship embedding errors from not-found errors', async () => {
      const pgrstError = {
        code: 'PGRST201',
        message: "Could not embed because more than one relationship was found for 'representative_assignments' and 'profiles'",
        details: [
          { relationship: 'representative_assignments_assigned_by_fkey' },
          { relationship: 'representative_assignments_profile_id_fkey' },
        ],
      };

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: pgrstError }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.notEqual(res.error, 'Representative assignment record not found.');
      assert.match(res.error || '', /Database query failure: Could not embed/i);
    });

    it('deactivating representative A updates only representative A leaving representative B active', async () => {
      const ASSIGN_A_ID = '11111111-aaaa-4111-8111-111111111111';
      const ASSIGN_B_ID = '22222222-bbbb-4222-8222-222222222222';
      let updatedAssignmentId: string | null = null;
      let updatedFields: any = null;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: (col: string, val: string) => {
                  if (col === 'id' && val === ASSIGN_A_ID) {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: ASSIGN_A_ID,
                          profile_id: 'prof-a-id',
                          section_id: SEC_3B_ID,
                          is_active: true,
                          profile: { telegram_user_id: 1111, full_name: 'Rep A' },
                          section: { name: 'Section B', academic_year: { name: '3rd Year' } },
                        },
                        error: null,
                      }),
                    };
                  }
                  if (col === 'profile_id') {
                    return {
                      eq: async () => ({ data: [] }), // No other active assignments for Rep A
                    };
                  }
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              }),
              update: (fields: any) => {
                updatedFields = fields;
                return {
                  eq: async (col: string, val: string) => {
                    if (col === 'id') updatedAssignmentId = val;
                    return { error: null };
                  },
                };
              },
            };
          }
          if (table === 'profiles') return { update: () => ({ eq: async () => ({ error: null }) }) };
          if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
          if (table === 'notifications') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
              insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-1' } }) }) }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_A_ID,
        { skipNotification: true }
      );

      assert.equal(res.success, true);
      assert.equal(updatedAssignmentId, ASSIGN_A_ID, 'Only Representative A assignment ID was updated');
      assert.notEqual(updatedAssignmentId, ASSIGN_B_ID, 'Representative B assignment was not modified');
      assert.equal(updatedFields?.is_active, false);
    });

    it('student access and submission records remain completely untouched after deactivation', async () => {
      const accessedTables: string[] = [];

      const mockSupabase = {
        from: (table: string) => {
          accessedTables.push(table);
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: ASSIGN_ID,
                      profile_id: REP_USER_ID,
                      section_id: SEC_3B_ID,
                      is_active: true,
                      profile: { telegram_user_id: 11111111, full_name: 'Hamza Rep' },
                      section: { name: 'Section B', academic_year: { name: '3rd Year' } },
                    },
                    error: null,
                  }),
                  eq: async () => ({ data: [] }),
                }),
              }),
              update: () => ({ eq: async () => ({ error: null }) }),
            };
          }
          if (table === 'profiles') return { update: () => ({ eq: async () => ({ error: null }) }) };
          if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
          if (table === 'notifications') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
              insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-1' } }) }) }),
            };
          }
          throw new Error(`Unexpected table accessed: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        { skipNotification: true }
      );

      assert.equal(res.success, true);
      assert.ok(!accessedTables.includes('students'), 'students table must never be queried or mutated during deactivation');
      assert.ok(!accessedTables.includes('submissions'), 'submissions table must never be mutated during deactivation');
      assert.ok(!accessedTables.includes('submission_files'), 'submission_files must never be mutated during deactivation');
      assert.ok(!accessedTables.includes('submission_members'), 'submission_members must never be mutated during deactivation');
    });

    it('unauthorized non-system-owner cannot deactivate a representative', async () => {
      const repContext: UserSessionContext = {
        userId: 'some-student-id',
        email: 'student@hu.edu.et',
        isOwner: false,
        isRepresentative: false,
        assignments: [],
        profile: {
          id: 'some-student-id',
          role: 'representative',
          full_name: 'Non Owner',
          email: 'student@hu.edu.et',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      const mockSupabase = {} as any;

      const res = await executeDeactivateRepresentative(mockSupabase, repContext, ASSIGN_ID, { skipNotification: true });
      assert.equal(res.success, false);
      assert.match(res.error || '', /System Owner privileges required/i);
    });

    it('repeated deactivation of an already deactivated assignment returns safe documented error', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: ASSIGN_ID,
                      profile_id: REP_USER_ID,
                      section_id: SEC_3B_ID,
                      is_active: false, // Already deactivated
                      profile: { telegram_user_id: 11111111, full_name: 'Hamza Rep' },
                      section: { name: 'Section B', academic_year: { name: '3rd Year' } },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        { skipNotification: true }
      );

      assert.equal(res.success, false);
      assert.equal(res.error, 'Representative assignment is already deactivated.');
    });

    it('profile remains active when representative holds another active section assignment', async () => {
      let profileDeactivated = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: (col: string) => {
                  if (col === 'id') {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: ASSIGN_ID,
                          profile_id: REP_USER_ID,
                          section_id: SEC_3B_ID,
                          is_active: true,
                          profile: { telegram_user_id: 11111111, full_name: 'Hamza Rep' },
                          section: { name: 'Section B', academic_year: { name: '3rd Year' } },
                        },
                        error: null,
                      }),
                    };
                  }
                  if (col === 'profile_id') {
                    return {
                      eq: async () => ({
                        data: [{ id: 'other-active-assignment-id' }], // Still has an active assignment in Section A!
                      }),
                    };
                  }
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              }),
              update: () => ({ eq: async () => ({ error: null }) }),
            };
          }
          if (table === 'profiles') {
            return {
              update: (fields: any) => {
                if (fields.is_active === false) profileDeactivated = true;
                return { eq: async () => ({ error: null }) };
              },
            };
          }
          if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
          if (table === 'notifications') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
              insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'notif-1' } }) }) }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeDeactivateRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        { skipNotification: true }
      );

      assert.equal(res.success, true);
      assert.equal(profileDeactivated, false, 'Profile must NOT be deactivated when remaining active assignments exist');
    });

    it('reassigning representative deactivates previous assignment and records audit history', async () => {
      let oldDeactivated = false;
      let newAssignmentCreated = false;
      let auditLogged = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'representative_assignments') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: ASSIGN_ID,
                      profile_id: REP_USER_ID,
                      section_id: SEC_3B_ID,
                      is_active: true,
                    },
                  }),
                }),
              }),
              update: (fields: any) => {
                if (fields.is_active === false) oldDeactivated = true;
                return { eq: async () => ({ error: null }) };
              },
              upsert: (record: any) => {
                newAssignmentCreated = true;
                return {
                  select: () => ({
                    single: async () => ({ data: { id: 'new-assign-id', ...record }, error: null }),
                  }),
                };
              },
            };
          }
          if (table === 'profiles') {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          if (table === 'audit_logs') {
            return {
              insert: async (entry: any) => {
                if (entry.action === 'REPRESENTATIVE_REASSIGNED') auditLogged = true;
                return { error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeReassignRepresentative(
        mockSupabase,
        createOwnerContext(),
        ASSIGN_ID,
        SEC_2A_ID
      );

      assert.equal(res.success, true);
      assert.equal(oldDeactivated, true);
      assert.equal(newAssignmentCreated, true);
      assert.equal(auditLogged, true);
    });
  });

  describe('Workflow 3: Representative-to-Teacher Delivery', () => {
    it('prevents duplicate delivery preparation when submissions are already in active batch', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'sections') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: SEC_3B_ID, academic_year_id: YEAR_3_ID },
                  }),
                }),
              }),
            };
          }
          if (table === 'projects') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: PROJ_ID,
                      teacher_id: TEACHER_ID,
                      is_active: true,
                      targets: [{ section_id: SEC_3B_ID }],
                    },
                  }),
                }),
              }),
            };
          }
          if (table === 'teachers') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: TEACHER_ID, is_active: true },
                  }),
                }),
              }),
            };
          }
          if (table === 'submissions') {
            return {
              select: () => ({
                in: async () => ({
                  data: [
                    { id: SUB_1_ID, section_id: SEC_3B_ID, project_id: PROJ_ID, status: 'active' },
                  ],
                }),
              }),
            };
          }
          if (table === 'delivery_items') {
            return {
              select: () => ({
                in: () => ({
                  in: async () => ({
                    data: [
                      { submission_id: SUB_1_ID, delivery: { id: 'prior-deliv', status: 'prepared' } },
                    ],
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executePrepareDeliveryBatch(mockSupabase, createRepContext([SEC_3B_ID]), {
        sectionId: SEC_3B_ID,
        projectId: PROJ_ID,
        teacherId: TEACHER_ID,
        channel: 'telegram',
        submissionIds: [SUB_1_ID],
      });

      assert.equal(res.success, false);
      assert.match(res.error || '', /Duplicate delivery prevented/);
    });

    it('marking delivery as failed updates status and records reason', async () => {
      let markedStatus = '';
      let savedNotes = '';
      let auditLogged = false;

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'deliveries') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: DELIV_ID, section_id: SEC_3B_ID, status: 'prepared' },
                  }),
                }),
              }),
              update: (fields: any) => {
                markedStatus = fields.status;
                savedNotes = fields.delivery_notes;
                return {
                  eq: () => ({
                    in: () => ({
                      select: async () => ({ data: [{ id: DELIV_ID }] }),
                    }),
                  }),
                };
              },
            };
          }
          if (table === 'audit_logs') {
            return {
              insert: async (entry: any) => {
                if (entry.action === 'TEACHER_DELIVERY_FAILED') auditLogged = true;
                return { error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      } as any;

      const res = await executeFailDelivery(
        mockSupabase,
        createRepContext([SEC_3B_ID]),
        DELIV_ID,
        'Instructor Telegram bot returned 403 chat not found'
      );

      assert.equal(res.success, true);
      assert.equal(markedStatus, 'failed');
      assert.match(savedNotes, /chat not found/);
      assert.equal(auditLogged, true);
    });
  });
});
