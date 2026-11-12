// HU-ASMS: Teacher Delivery Server Actions (Phase 12)
// Manual, representative-controlled submission batching, dispatching, and acknowledgment

'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { assertDistributedRateLimit } from '../../../lib/security/rate-limiter';
import {
  validateDeliveryBatchUuids,
  validateUuidIdentifier,
} from '../../../lib/rep/input-validation';
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
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);
    if (!context || !context.profile) {
      await assertDistributedRateLimit('web:rep-delivery:unauth', 15, 60000, 'delivery batch operations');
      return { success: false, error: 'Authentication required.' };
    }
    await assertDistributedRateLimit(`web:rep-delivery:${context.userId}`, 20, 60000, 'delivery batch operations');
    const uuidError = validateDeliveryBatchUuids(input);
    if (uuidError) {
      return { success: false, error: uuidError };
    }
    const result = await executePrepareDeliveryBatch(supabase, context, input);
    if (result.success) {
      revalidatePath('/rep/deliveries');
      revalidatePath('/rep');
    }
    return result;
  } catch (err: any) {
    return { success: false, error: err.message || 'Rate limit exceeded.' };
  }
}

/**
 * Marks a prepared delivery batch as dispatched (sent) to the teacher.
 */
export async function dispatchDelivery(
  deliveryId: string,
  dispatchNotes?: string
): Promise<DeliveryActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);
    if (!context || !context.profile) {
      await assertDistributedRateLimit('web:rep-delivery:unauth', 15, 60000, 'delivery batch operations');
      return { success: false, error: 'Authentication required.' };
    }
    await assertDistributedRateLimit(`web:rep-delivery:${context.userId}`, 20, 60000, 'delivery batch operations');
    const uuidError = validateUuidIdentifier(deliveryId, 'delivery');
    if (uuidError) {
      return { success: false, error: uuidError };
    }
    const result = await executeDispatchDelivery(supabase, context, deliveryId, dispatchNotes);
    if (result.success) {
      revalidatePath('/rep/deliveries');
      revalidatePath('/rep');
    }
    return result;
  } catch (err: any) {
    return { success: false, error: err.message || 'Rate limit exceeded.' };
  }
}

/**
 * Records official teacher acknowledgment for a delivered batch.
 */
export async function acknowledgeDelivery(
  deliveryId: string
): Promise<DeliveryActionResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);
    if (!context || !context.profile) {
      await assertDistributedRateLimit('web:rep-delivery:unauth', 15, 60000, 'delivery batch operations');
      return { success: false, error: 'Authentication required.' };
    }
    await assertDistributedRateLimit(`web:rep-delivery:${context.userId}`, 20, 60000, 'delivery batch operations');
    const uuidError = validateUuidIdentifier(deliveryId, 'delivery');
    if (uuidError) {
      return { success: false, error: uuidError };
    }
    const result = await executeAcknowledgeDelivery(supabase, context, deliveryId);
    if (result.success) {
      revalidatePath('/rep/deliveries');
      revalidatePath('/rep');
    }
    return result;
  } catch (err: any) {
    return { success: false, error: err.message || 'Rate limit exceeded.' };
  }
}

/**
 * Generates temporary 15-minute signed URLs for all submission files in a delivery batch.
 */
export async function getDeliveryPackageManifest(deliveryId: string): Promise<DeliveryManifestResult> {
  try {
    const supabase = await createServerSupabaseClient();
    const context = await resolveUserSessionContext(supabase);
    if (!context || !context.profile) {
      await assertDistributedRateLimit('web:rep-delivery-manifest:unauth', 15, 60000, 'delivery manifest generation');
      return { error: 'Authentication required.' };
    }
    await assertDistributedRateLimit(`web:rep-delivery-manifest:${context.userId}`, 30, 60000, 'delivery manifest generation');
    const uuidError = validateUuidIdentifier(deliveryId, 'delivery');
    if (uuidError) {
      return { error: uuidError };
    }
    return executeGetDeliveryPackageManifest(supabase, context, deliveryId);
  } catch (err: any) {
    return { error: err.message || 'Rate limit exceeded.' };
  }
}
