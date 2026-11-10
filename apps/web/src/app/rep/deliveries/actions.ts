// HU-ASMS: Teacher Delivery Server Actions (Phase 12)
// Manual, representative-controlled submission batching, dispatching, and acknowledgment

'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import {
  executePrepareDeliveryBatch,
  executeDispatchDelivery,
  executeAcknowledgeDelivery,
  executeGetDeliveryPackageManifest,
  type PrepareDeliveryInput,
  type DeliveryActionResult,
  type DeliveryManifestResult,
} from '../../../lib/rep/delivery-service';

export type { PrepareDeliveryInput, DeliveryActionResult, DeliveryManifestResult };

/**
 * Prepares a verified batch of submissions for teacher delivery.
 */
export async function prepareDeliveryBatch(
  input: PrepareDeliveryInput
): Promise<DeliveryActionResult> {
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);
  const result = await executePrepareDeliveryBatch(supabase, context, input);
  if (result.success) {
    revalidatePath('/rep/deliveries');
    revalidatePath('/rep');
  }
  return result;
}

/**
 * Marks a prepared delivery batch as dispatched (sent) to the teacher.
 */
export async function dispatchDelivery(
  deliveryId: string,
  dispatchNotes?: string
): Promise<DeliveryActionResult> {
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);
  const result = await executeDispatchDelivery(supabase, context, deliveryId, dispatchNotes);
  if (result.success) {
    revalidatePath('/rep/deliveries');
    revalidatePath('/rep');
  }
  return result;
}

/**
 * Records official teacher acknowledgment for a delivered batch.
 */
export async function acknowledgeDelivery(
  deliveryId: string
): Promise<DeliveryActionResult> {
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);
  const result = await executeAcknowledgeDelivery(supabase, context, deliveryId);
  if (result.success) {
    revalidatePath('/rep/deliveries');
    revalidatePath('/rep');
  }
  return result;
}

/**
 * Generates temporary 15-minute signed URLs for all submission files in a delivery batch.
 */
export async function getDeliveryPackageManifest(deliveryId: string): Promise<DeliveryManifestResult> {
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);
  return executeGetDeliveryPackageManifest(supabase, context, deliveryId);
}
