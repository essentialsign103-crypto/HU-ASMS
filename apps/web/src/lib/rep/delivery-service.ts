// HU-ASMS: Teacher Delivery Service (Phase 12 / Track B Hardening)
// Manual, representative-controlled submission batching, dispatching, acknowledgment, and manifest generation
// Execution model: `executeDispatchDelivery` invokes the atomic PostgreSQL RPC
// `mark_delivery_sent_with_audit` when `.rpc()` is available so status transition and
// `TEACHER_DELIVERY_DISPATCHED` audit logging commit in a single database transaction.
// `executePrepareDeliveryBatch` and `executeAcknowledgeDelivery` run via PostgREST with compensating
// guards (never reverting `'sent' -> 'prepared'` after external delivery).

import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidUuid } from '@hu-asms/validation';
import {
  assertRepresentativeSectionScope,
  getActiveAssignedSectionIds,
  isRepresentativeRole,
  isSystemOwnerRole,
  type UserSessionContext,
} from '../auth/roles';
import { assertRateLimit } from '../security/rate-limiter';
import { writeScopedAuditLog } from './audit-helper';
import { validateDeliveryBatchUuids } from './input-validation';

export interface PrepareDeliveryInput {
  sectionId: string;
  projectId: string;
  teacherId: string;
  channel: 'telegram' | 'email' | 'in_person';
  deliveryNotes?: string;
  submissionIds: string[];
}

export interface DeliveryActionResult {
  success: boolean;
  deliveryId?: string;
  error?: string;
}

export interface DeliveryManifestItem {
  submissionId: string;
  submitterName: string;
  fileName: string;
  fileSizeBytes: number;
  signedUrl: string;
}

export interface DeliveryManifestResult {
  delivery?: any;
  items?: DeliveryManifestItem[];
  error?: string;
}

const VALID_DELIVERY_CHANNELS = new Set(['telegram', 'email', 'in_person']);

function validateActiveDeliveryActor(context: UserSessionContext | null): string | null {
  if (!context || !context.profile) {
    return 'Authentication required.';
  }
  if (context.profile.is_active !== true) {
    return 'Forbidden: Active staff profile required.';
  }

  const isVerifiedOwner = context.isOwner && isSystemOwnerRole(context.profile.role);
  const isVerifiedRep =
    context.isRepresentative && isRepresentativeRole(context.profile.role);

  if (!isVerifiedOwner && !isVerifiedRep) {
    return 'Forbidden: Representative privileges required.';
  }
  if (!isVerifiedOwner && getActiveAssignedSectionIds(context).length === 0) {
    return 'Forbidden: No active section assignment is configured for your account.';
  }
  return null;
}

function isProjectTargetedToSection(
  targets: Array<{ academic_year_id?: string | null; section_id?: string | null }> | null | undefined,
  sectionId: string,
  sectionAcademicYearId: string
): boolean {
  if (!Array.isArray(targets) || targets.length === 0) {
    return false;
  }
  return targets.some(
    (t) =>
      t.section_id === sectionId ||
      ((t.section_id === null || t.section_id === undefined) &&
        t.academic_year_id === sectionAcademicYearId)
  );
}

async function compensateCreatedDelivery(
  supabase: SupabaseClient,
  deliveryId: string
): Promise<boolean> {
  try {
    const client = supabase as any;
    const tableApi = client?.from?.('deliveries');
    if (typeof tableApi?.delete !== 'function') {
      return false;
    }
    const res = await tableApi.delete().eq('id', deliveryId);
    return !res?.error;
  } catch {
    return false;
  }
}

async function compensateDeliveryStatusRevert(
  supabase: SupabaseClient,
  deliveryId: string,
  expectedCurrentStatus: string,
  revertFields: Record<string, unknown>
): Promise<boolean> {
  try {
    const client = supabase as any;
    const tableApi = client?.from?.('deliveries');
    if (typeof tableApi?.update !== 'function') {
      return false;
    }
    const chain = tableApi.update(revertFields).eq('id', deliveryId).eq('status', expectedCurrentStatus);
    const res = typeof chain?.select === 'function' ? await chain.select('id') : await chain;
    if (res?.error) {
      return false;
    }
    return Array.isArray(res?.data) ? res.data.length > 0 : true;
  } catch {
    return false;
  }
}

/**
 * Prepares a verified batch of active submissions for teacher delivery.
 */
export async function executePrepareDeliveryBatch(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  input: PrepareDeliveryInput
): Promise<DeliveryActionResult> {
  try {
    const actorError = validateActiveDeliveryActor(context);
    if (actorError) {
      return { success: false, error: actorError };
    }

    assertRateLimit(`rep-delivery:${context!.userId}`, 20, 60000, 'delivery batch operations');

    const uuidError = validateDeliveryBatchUuids(input);
    if (uuidError) {
      return { success: false, error: uuidError };
    }

    if (!isValidUuid(input.teacherId)) {
      return { success: false, error: 'Invalid teacher identifier.' };
    }

    if (!VALID_DELIVERY_CHANNELS.has(input.channel)) {
      return { success: false, error: 'Invalid delivery channel specified.' };
    }

    const cleanSectionId = input.sectionId.trim();
    const cleanProjectId = input.projectId.trim();
    const cleanTeacherId = input.teacherId.trim();

    // 1. Strict Scope Assertion: Representative must be assigned to section
    assertRepresentativeSectionScope(context, cleanSectionId);

    if (!Array.isArray(input.submissionIds) || input.submissionIds.length === 0) {
      return { success: false, error: 'At least one submission must be selected for delivery.' };
    }

    const cleanSubmissionIds = input.submissionIds.map((id) => id.trim());
    if (new Set(cleanSubmissionIds).size !== cleanSubmissionIds.length) {
      return {
        success: false,
        error: 'Duplicate submission identifiers are not allowed in a delivery batch.',
      };
    }

    // 2. Verify target section exists and resolve academic year for target checks
    const { data: section, error: secErr } = await supabase
      .from('sections')
      .select('id, academic_year_id')
      .eq('id', cleanSectionId)
      .single();

    if (secErr || !section) {
      return { success: false, error: 'Academic section record not found.' };
    }

    // 3. Fetch project with targeting and instructor assignment
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, course_id, teacher_id, title, is_active, targets:project_targets(academic_year_id, section_id)')
      .eq('id', cleanProjectId)
      .single();

    if (projErr || !project) {
      return { success: false, error: 'Academic project record not found.' };
    }

    if (project.is_active !== true) {
      return { success: false, error: 'Cannot prepare delivery for an inactive project.' };
    }

    if (!isProjectTargetedToSection(project.targets, cleanSectionId, section.academic_year_id)) {
      return {
        success: false,
        error: 'Security Violation: Academic project is not targeted to the specified section.',
      };
    }

    if (!project.teacher_id || project.teacher_id !== cleanTeacherId) {
      return {
        success: false,
        error: 'Teacher mismatch: Selected teacher is not assigned to this academic project.',
      };
    }

    // 4. Verify recipient teacher exists and is active
    const { data: teacher, error: teacherErr } = await supabase
      .from('teachers')
      .select('id, is_active')
      .eq('id', cleanTeacherId)
      .single();

    if (teacherErr || !teacher || teacher.is_active !== true) {
      return { success: false, error: 'Recipient teacher record not found or inactive.' };
    }

    // 5. Verify all selected submissions are active and strictly belong to this section & project
    const { data: submissions, error: subErr } = await supabase
      .from('submissions')
      .select('id, section_id, project_id, status')
      .in('id', cleanSubmissionIds);

    if (subErr || !submissions || submissions.length !== cleanSubmissionIds.length) {
      return { success: false, error: 'One or more selected submissions could not be verified.' };
    }

    const invalidScopeSub = submissions.find(
      (s) => s.section_id !== cleanSectionId || s.project_id !== cleanProjectId
    );

    if (invalidScopeSub) {
      return {
        success: false,
        error: 'Security Violation: Cannot attach submissions outside your assigned section or project.',
      };
    }

    const inactiveSub = submissions.find((s) => s.status !== 'active');
    if (inactiveSub) {
      return {
        success: false,
        error: `Invalid delivery batch: Only active submissions may be delivered (submission ${inactiveSub.id} has status "${inactiveSub.status}").`,
      };
    }

    const cleanNotes =
      typeof input.deliveryNotes === 'string' && input.deliveryNotes.trim().length > 0
        ? input.deliveryNotes.trim().slice(0, 1000)
        : null;

    // 6. Create Master Delivery Record (Status: 'prepared')
    const { data: delivery, error: insertDeliveryErr } = await supabase
      .from('deliveries')
      .insert({
        project_id: cleanProjectId,
        section_id: cleanSectionId,
        course_id: project.course_id,
        teacher_id: cleanTeacherId,
        representative_id: context!.profile!.id,
        batch_count: submissions.length,
        status: 'prepared',
        channel: input.channel,
        delivery_notes: cleanNotes,
        prepared_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertDeliveryErr || !delivery) {
      return { success: false, error: `Failed to create delivery record: ${insertDeliveryErr?.message}` };
    }

    // 7. Insert Delivery Items
    const deliveryItems = submissions.map((s) => ({
      delivery_id: delivery.id,
      submission_id: s.id,
    }));

    const { error: insertItemsErr } = await supabase
      .from('delivery_items')
      .insert(deliveryItems);

    if (insertItemsErr) {
      const rolledBack = await compensateCreatedDelivery(supabase, delivery.id);
      return {
        success: false,
        error: rolledBack
          ? `Failed to attach delivery items: ${insertItemsErr.message} (delivery batch rolled back)`
          : `Failed to attach delivery items: ${insertItemsErr.message} (warning: partial delivery ${delivery.id} requires reconciliation)`,
      };
    }

    // 8. Record Audit Event
    try {
      await writeScopedAuditLog(supabase, {
        actorId: context!.profile!.id,
        actorRole: context!.isOwner ? 'system_owner' : 'representative',
        action: 'TEACHER_DELIVERY_PREPARED',
        entityType: 'delivery',
        entityId: delivery.id,
        metadata: {
          section_id: cleanSectionId,
          project_id: cleanProjectId,
          teacher_id: cleanTeacherId,
          batch_count: submissions.length,
          channel: input.channel,
        },
      });
    } catch (auditErr: any) {
      const rolledBack = await compensateCreatedDelivery(supabase, delivery.id);
      const msg = auditErr?.message || 'Audit log recording failed.';
      return {
        success: false,
        error: rolledBack
          ? `${msg} (delivery batch rolled back)`
          : `${msg} (warning: un-audited delivery ${delivery.id} requires reconciliation)`,
      };
    }

    return { success: true, deliveryId: delivery.id };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Unexpected delivery preparation error.' };
  }
}

/**
 * Marks a prepared delivery batch as dispatched (sent) to the teacher.
 * Uses the transactional PostgreSQL RPC `mark_delivery_sent_with_audit` when available,
 * and never reverts `'sent'` back to `'prepared'` on downstream audit failures.
 */
export async function executeDispatchDelivery(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  deliveryId: string,
  dispatchNotes?: string
): Promise<DeliveryActionResult> {
  try {
    const actorError = validateActiveDeliveryActor(context);
    if (actorError) {
      return { success: false, error: actorError };
    }

    assertRateLimit(`rep-delivery:${context!.userId}`, 20, 60000, 'delivery batch operations');

    if (!isValidUuid(deliveryId)) {
      return { success: false, error: 'Invalid delivery identifier.' };
    }

    const cleanDeliveryId = deliveryId.trim();

    const { data: delivery, error: fetchErr } = await supabase
      .from('deliveries')
      .select('id, section_id, status, sent_at, delivery_notes')
      .eq('id', cleanDeliveryId)
      .single();

    if (fetchErr || !delivery) {
      return { success: false, error: 'Delivery record not found.' };
    }

    assertRepresentativeSectionScope(context, delivery.section_id);

    if (delivery.status !== 'prepared') {
      return {
        success: false,
        error: `Invalid delivery state transition: Expected "prepared" before dispatch, found "${delivery.status}".`,
      };
    }

    const cleanNotes =
      typeof dispatchNotes === 'string' && dispatchNotes.trim().length > 0
        ? dispatchNotes.trim().slice(0, 1000)
        : undefined;

    if (typeof (supabase as any).rpc === 'function') {
      const { error: rpcErr } = await supabase.rpc('mark_delivery_sent_with_audit', {
        p_delivery_id: cleanDeliveryId,
        p_dispatch_notes: cleanNotes ?? null,
      });

      if (rpcErr) {
        return {
          success: false,
          error: rpcErr.message || 'Failed to dispatch delivery.',
        };
      }

      return { success: true, deliveryId: cleanDeliveryId };
    }

    // Legacy fallback ONLY for lightweight test doubles lacking `.rpc()`.
    const updateData: Record<string, unknown> = {
      status: 'sent',
      sent_at: new Date().toISOString(),
    };
    if (cleanNotes) {
      updateData.delivery_notes = cleanNotes;
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('deliveries')
      .update(updateData)
      .eq('id', cleanDeliveryId)
      .eq('status', 'prepared')
      .select('id');

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return {
        success: false,
        error: 'Delivery dispatch rejected: Delivery is no longer in "prepared" status.',
      };
    }

    try {
      await writeScopedAuditLog(supabase, {
        actorId: context!.profile!.id,
        actorRole: context!.isOwner ? 'system_owner' : 'representative',
        action: 'TEACHER_DELIVERY_DISPATCHED',
        entityType: 'delivery',
        entityId: cleanDeliveryId,
        metadata: { section_id: delivery.section_id, notes: cleanNotes },
      });
    } catch (auditErr: any) {
      // Never revert 'sent' -> 'prepared' after external delivery handover to avoid duplicate dispatch.
      const msg = auditErr?.message || 'Audit log recording failed.';
      return {
        success: false,
        error: `${msg} (dispatch remains "sent"; audit reconciliation required for delivery ${cleanDeliveryId})`,
      };
    }

    return { success: true, deliveryId: cleanDeliveryId };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to dispatch delivery.' };
  }
}

/**
 * Records official teacher acknowledgment for a sent delivery batch.
 */
export async function executeAcknowledgeDelivery(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  deliveryId: string
): Promise<DeliveryActionResult> {
  try {
    const actorError = validateActiveDeliveryActor(context);
    if (actorError) {
      return { success: false, error: actorError };
    }

    assertRateLimit(`rep-delivery:${context!.userId}`, 20, 60000, 'delivery batch operations');

    if (!isValidUuid(deliveryId)) {
      return { success: false, error: 'Invalid delivery identifier.' };
    }

    const cleanDeliveryId = deliveryId.trim();

    const { data: delivery, error: fetchErr } = await supabase
      .from('deliveries')
      .select('id, section_id, status, acknowledged_at')
      .eq('id', cleanDeliveryId)
      .single();

    if (fetchErr || !delivery) {
      return { success: false, error: 'Delivery record not found.' };
    }

    assertRepresentativeSectionScope(context, delivery.section_id);

    if (delivery.status !== 'sent') {
      return {
        success: false,
        error: `Invalid delivery state transition: Expected "sent" before acknowledgment, found "${delivery.status}".`,
      };
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('deliveries')
      .update({
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', cleanDeliveryId)
      .eq('status', 'sent')
      .select('id');

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return {
        success: false,
        error: 'Delivery acknowledgment rejected: Delivery is no longer in "sent" status.',
      };
    }

    try {
      await writeScopedAuditLog(supabase, {
        actorId: context!.profile!.id,
        actorRole: context!.isOwner ? 'system_owner' : 'representative',
        action: 'TEACHER_DELIVERY_ACKNOWLEDGED',
        entityType: 'delivery',
        entityId: cleanDeliveryId,
        metadata: { section_id: delivery.section_id },
      });
    } catch (auditErr: any) {
      const reverted = await compensateDeliveryStatusRevert(supabase, cleanDeliveryId, 'acknowledged', {
        status: 'sent',
        acknowledged_at: delivery.acknowledged_at ?? null,
      });
      const msg = auditErr?.message || 'Audit log recording failed.';
      return {
        success: false,
        error: reverted
          ? `${msg} (acknowledgment reverted to sent)`
          : `${msg} (warning: delivery ${cleanDeliveryId} acknowledged without audit log)`,
      };
    }

    return { success: true, deliveryId: cleanDeliveryId };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to record delivery acknowledgment.' };
  }
}

/**
 * Generates temporary 15-minute signed URLs for all submission files in a delivery batch.
 */
export async function executeGetDeliveryPackageManifest(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  deliveryId: string
): Promise<DeliveryManifestResult> {
  try {
    const actorError = validateActiveDeliveryActor(context);
    if (actorError) {
      return { error: actorError };
    }

    assertRateLimit(`rep-delivery-manifest:${context!.userId}`, 30, 60000, 'delivery manifest generation');

    if (!isValidUuid(deliveryId)) {
      return { error: 'Invalid delivery identifier.' };
    }

    const cleanDeliveryId = deliveryId.trim();

    const { data: delivery, error: fetchErr } = await supabase
      .from('deliveries')
      .select(`
        *,
        course:courses(*),
        teacher:teachers(*),
        section:sections(*, academic_year:academic_years(*)),
        project:projects(*),
        items:delivery_items(
          *,
          submission:submissions(
            *,
            student:students(*),
            group:groups(*),
            files:submission_files(*)
          )
        )
      `)
      .eq('id', cleanDeliveryId)
      .single();

    if (fetchErr || !delivery) {
      return { error: 'Delivery record not found.' };
    }

    assertRepresentativeSectionScope(context, delivery.section_id);

    if (!Array.isArray(delivery.items) || delivery.items.length === 0) {
      return { error: 'Delivery batch contains no attached submissions.' };
    }

    if (typeof delivery.batch_count === 'number' && delivery.items.length !== delivery.batch_count) {
      return {
        error: 'Delivery batch integrity mismatch between recorded batch count and items.',
      };
    }

    const itemsWithSignedUrls: DeliveryManifestItem[] = [];

    for (const item of delivery.items) {
      const sub = item?.submission;
      if (!sub || !sub.id) {
        return { error: 'Delivery batch contains an item with a missing submission record.' };
      }

      if (!sub.section_id || sub.section_id !== delivery.section_id) {
        return {
          error: 'Security Violation: Delivery batch contains a submission outside the delivery section.',
        };
      }

      if (delivery.project_id && (!sub.project_id || sub.project_id !== delivery.project_id)) {
        return {
          error: 'Security Violation: Delivery batch contains a submission from another project.',
        };
      }

      if (sub.submission_type !== 'group' && sub.submission_type !== 'individual') {
        return { error: `Delivery submission ${sub.id} has an invalid submission type.` };
      }

      const isGroup = sub.submission_type === 'group';
      let submitterName = '';
      if (isGroup) {
        const groupCode = sub.group?.group_code;
        if (typeof groupCode !== 'string' || groupCode.trim().length === 0) {
          return { error: `Delivery submission ${sub.id} is missing its group relation.` };
        }
        submitterName = `${groupCode.trim()} (Team)`;
      } else {
        const studentName = sub.student?.full_name;
        if (typeof studentName !== 'string' || studentName.trim().length === 0) {
          return { error: `Delivery submission ${sub.id} is missing its student relation.` };
        }
        submitterName = studentName.trim();
      }

      const files = Array.isArray(sub.files) ? sub.files : [];
      const file = files.length <= 1
        ? files[0]
        : [...files].sort((a, b) =>
            String(a?.created_at || '').localeCompare(String(b?.created_at || ''))
          )[0];

      if (
        !file ||
        typeof file.storage_path !== 'string' ||
        file.storage_path.trim().length === 0 ||
        typeof file.original_filename !== 'string' ||
        file.original_filename.trim().length === 0
      ) {
        return { error: `Delivery submission ${sub.id} is missing its file metadata.` };
      }

      const { data: signRes, error: signErr } = await supabase.storage
        .from('submission-files-vault')
        .createSignedUrl(file.storage_path, 900); // 15 min TTL

      if (signErr || !signRes?.signedUrl) {
        return {
          error: `Failed to generate signed URL for submission ${sub.id}: ${signErr?.message || 'Storage error'}`,
        };
      }

      itemsWithSignedUrls.push({
        submissionId: sub.id,
        submitterName,
        fileName: file.original_filename.trim(),
        fileSizeBytes: typeof file.file_size_bytes === 'number' && file.file_size_bytes >= 0
          ? file.file_size_bytes
          : 0,
        signedUrl: signRes.signedUrl,
      });
    }

    return {
      delivery,
      items: itemsWithSignedUrls,
    };
  } catch (err: any) {
    return { error: err?.message || 'Failed to generate delivery package manifest.' };
  }
}
