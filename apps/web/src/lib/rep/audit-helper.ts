// HU-ASMS: Scoped Audit Log Helper
// Routes rep/owner portal workflow audit writes through the hardened record_scoped_audit_log RPC

import type { SupabaseClient } from '@supabase/supabase-js';

export type ScopedAuditAction =
  | 'GROUP_PRECREATED'
  | 'TEACHER_DELIVERY_PREPARED'
  | 'TEACHER_DELIVERY_DISPATCHED'
  | 'TEACHER_DELIVERY_ACKNOWLEDGED';

export interface ScopedAuditLogEntry {
  actorId: string;
  actorRole: 'representative' | 'system_owner';
  action: ScopedAuditAction;
  entityType: 'group' | 'delivery';
  entityId: string;
  metadata?: Record<string, any>;
}

/**
 * Records an immutable audit event via the SECURITY DEFINER `record_scoped_audit_log` RPC.
 * Falls back to direct insert only on lightweight unit-test mocks without `.rpc()`.
 */
export async function writeScopedAuditLog(
  supabase: SupabaseClient,
  entry: ScopedAuditLogEntry
): Promise<void> {
  const client = supabase as any;

  if (typeof client.rpc === 'function') {
    const res = await client.rpc('record_scoped_audit_log', {
      p_action: entry.action,
      p_entity_type: entry.entityType,
      p_entity_id: entry.entityId,
      p_metadata: entry.metadata ?? {},
    });

    if (res?.error) {
      throw new Error(`Audit log recording failed: ${res.error.message}`);
    }
    return;
  }

  const res = await client.from('audit_logs').insert({
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    metadata: entry.metadata ?? {},
  });

  if (res?.error) {
    throw new Error(`Audit log recording failed: ${res.error.message}`);
  }
}
