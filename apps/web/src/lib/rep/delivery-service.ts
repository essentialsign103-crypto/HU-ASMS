// HU-ASMS: Teacher Delivery Service (Phase 12)
// Manual, representative-controlled submission batching, dispatching, acknowledgment, and manifest generation

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertRepresentativeSectionScope, type UserSessionContext } from '../auth/roles';

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

/**
 * Prepares a verified batch of submissions for teacher delivery.
 */
export async function executePrepareDeliveryBatch(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  input: PrepareDeliveryInput
): Promise<DeliveryActionResult> {
  try {
    if (!context || !context.profile) {
      return { success: false, error: 'Authentication required.' };
    }

    // 1. Strict Scope Assertion: Representative must be assigned to section
    assertRepresentativeSectionScope(context, input.sectionId);

    if (!input.submissionIds || input.submissionIds.length === 0) {
      return { success: false, error: 'At least one submission must be selected for delivery.' };
    }

    // 2. Fetch project to resolve course_id and verify project targeting
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, course_id, title')
      .eq('id', input.projectId)
      .single();

    if (projErr || !project) {
      return { success: false, error: 'Academic project record not found.' };
    }

    // 3. Verify all selected submissions belong strictly to the assigned section and project
    const { data: submissions, error: subErr } = await supabase
      .from('submissions')
      .select('id, section_id, project_id, status')
      .in('id', input.submissionIds);

    if (subErr || !submissions || submissions.length !== input.submissionIds.length) {
      return { success: false, error: 'One or more selected submissions could not be verified.' };
    }

    const invalidScopeSub = submissions.find(
      (s) => s.section_id !== input.sectionId || s.project_id !== input.projectId
    );

    if (invalidScopeSub) {
      return {
        success: false,
        error: 'Security Violation: Cannot attach submissions outside your assigned section or project.',
      };
    }

    // 4. Create Master Delivery Record (Status: 'prepared')
    const { data: delivery, error: insertDeliveryErr } = await supabase
      .from('deliveries')
      .insert({
        project_id: input.projectId,
        section_id: input.sectionId,
        course_id: project.course_id,
        teacher_id: input.teacherId,
        representative_id: context.profile.id,
        batch_count: submissions.length,
        status: 'prepared',
        channel: input.channel,
        delivery_notes: input.deliveryNotes || null,
        prepared_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertDeliveryErr || !delivery) {
      return { success: false, error: `Failed to create delivery record: ${insertDeliveryErr?.message}` };
    }

    // 5. Insert Delivery Items
    const deliveryItems = submissions.map((s) => ({
      delivery_id: delivery.id,
      submission_id: s.id,
    }));

    const { error: insertItemsErr } = await supabase
      .from('delivery_items')
      .insert(deliveryItems);

    if (insertItemsErr) {
      return { success: false, error: `Failed to attach delivery items: ${insertItemsErr.message}` };
    }

    // 6. Record Audit Event
    await supabase.from('audit_logs').insert({
      actor_id: context.profile.id,
      actor_role: 'representative',
      action: 'TEACHER_DELIVERY_PREPARED',
      entity_type: 'delivery',
      entity_id: delivery.id,
      metadata: {
        section_id: input.sectionId,
        project_id: input.projectId,
        teacher_id: input.teacherId,
        batch_count: submissions.length,
        channel: input.channel,
      },
    });

    return { success: true, deliveryId: delivery.id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unexpected delivery preparation error.' };
  }
}

/**
 * Marks a prepared delivery batch as dispatched (sent) to the teacher.
 */
export async function executeDispatchDelivery(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  deliveryId: string,
  dispatchNotes?: string
): Promise<DeliveryActionResult> {
  try {
    if (!context || !context.profile) {
      return { success: false, error: 'Authentication required.' };
    }

    const { data: delivery, error: fetchErr } = await supabase
      .from('deliveries')
      .select('*, section_id')
      .eq('id', deliveryId)
      .single();

    if (fetchErr || !delivery) {
      return { success: false, error: 'Delivery record not found.' };
    }

    assertRepresentativeSectionScope(context, delivery.section_id);

    const updateData: any = {
      status: 'sent',
      sent_at: new Date().toISOString(),
    };
    if (dispatchNotes) {
      updateData.delivery_notes = dispatchNotes;
    }

    const { error: updateErr } = await supabase
      .from('deliveries')
      .update(updateData)
      .eq('id', deliveryId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    await supabase.from('audit_logs').insert({
      actor_id: context.profile.id,
      actor_role: 'representative',
      action: 'TEACHER_DELIVERY_DISPATCHED',
      entity_type: 'delivery',
      entity_id: deliveryId,
      metadata: { section_id: delivery.section_id, notes: dispatchNotes },
    });

    return { success: true, deliveryId };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to dispatch delivery.' };
  }
}

/**
 * Records official teacher acknowledgment for a delivered batch.
 */
export async function executeAcknowledgeDelivery(
  supabase: SupabaseClient,
  context: UserSessionContext | null,
  deliveryId: string
): Promise<DeliveryActionResult> {
  try {
    if (!context || !context.profile) {
      return { success: false, error: 'Authentication required.' };
    }

    const { data: delivery, error: fetchErr } = await supabase
      .from('deliveries')
      .select('*, section_id')
      .eq('id', deliveryId)
      .single();

    if (fetchErr || !delivery) {
      return { success: false, error: 'Delivery record not found.' };
    }

    assertRepresentativeSectionScope(context, delivery.section_id);

    const { error: updateErr } = await supabase
      .from('deliveries')
      .update({
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    await supabase.from('audit_logs').insert({
      actor_id: context.profile.id,
      actor_role: 'representative',
      action: 'TEACHER_DELIVERY_ACKNOWLEDGED',
      entity_type: 'delivery',
      entity_id: deliveryId,
      metadata: { section_id: delivery.section_id },
    });

    return { success: true, deliveryId };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to record delivery acknowledgment.' };
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
    if (!context || !context.profile) {
      return { error: 'Authentication required.' };
    }

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
      .eq('id', deliveryId)
      .single();

    if (fetchErr || !delivery) {
      return { error: 'Delivery record not found.' };
    }

    assertRepresentativeSectionScope(context, delivery.section_id);

    const itemsWithSignedUrls: DeliveryManifestItem[] = [];

    for (const item of delivery.items || []) {
      const sub = item.submission;
      const file = sub?.files?.[0];
      const isGroup = sub?.submission_type === 'group';
      const submitterName = isGroup
        ? `${sub.group?.group_code} (Team)`
        : sub.student?.full_name || 'Student';

      let signedUrl = '';
      if (file?.storage_path) {
        const { data: signRes } = await supabase.storage
          .from('submission-files-vault')
          .createSignedUrl(file.storage_path, 900); // 15 min TTL

        signedUrl = signRes?.signedUrl || '';
      }

      itemsWithSignedUrls.push({
        submissionId: sub?.id,
        submitterName,
        fileName: file?.original_filename || 'Unknown Attachment',
        fileSizeBytes: file?.file_size_bytes || 0,
        signedUrl,
      });
    }

    return {
      delivery,
      items: itemsWithSignedUrls,
    };
  } catch (err: any) {
    return { error: err.message || 'Failed to generate delivery package manifest.' };
  }
}
