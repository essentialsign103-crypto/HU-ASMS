// HU-ASMS: Teacher Deliveries Dashboard (Phase 12)
import React from 'react';
import Link from 'next/link';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureRepresentativePage } from '../../../lib/auth/page-guards';
import { getActiveAssignedSectionIds } from '../../../lib/auth/roles';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { DeliveryActionsClient } from './delivery-actions-client';
import { PackageCheck, Plus, Clock, CheckCircle2, Send, AlertTriangle } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';

export default async function DeliveriesPage() {
  const supabase = await createServerSupabaseClient();
  const context = await ensureRepresentativePage(supabase);

  const assignedSectionIds = getActiveAssignedSectionIds(context);

  const { data: deliveries } =
    assignedSectionIds.length === 0
      ? { data: null }
      : await supabase
    .from('deliveries')
    .select(`
      *,
      project:projects(*),
      course:courses(*),
      teacher:teachers(*),
      section:sections(*, academic_year:academic_years(*))
    `)
    .in('section_id', assignedSectionIds)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Teacher Deliveries & Forwarding</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manual, representative-controlled submission batching, dispatching, and teacher acknowledgment tracking.
          </p>
        </div>

        <Link
          href="/rep/deliveries/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-semibold hover:bg-emerald-800 transition-colors shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Prepare Delivery Package</span>
        </Link>
      </div>

      <Card
        title="Delivery History & Active Batches"
        subtitle={`${deliveries?.length || 0} batches recorded across your assigned sections`}
      >
        {(!deliveries || deliveries.length === 0) ? (
          <div className="text-center py-12 text-sm text-slate-500">
            <PackageCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <div className="font-semibold text-slate-700">No Delivery Batches Prepared Yet</div>
            <p className="text-xs text-slate-400 mt-1">
              Select verified submissions to create your first teacher delivery package.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Project & Course</th>
                  <th className="px-4 py-3">Recipient Instructor</th>
                  <th className="px-4 py-3">Scope & Channel</th>
                  <th className="px-4 py-3">Batch Size</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Timeline (UTC)</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {deliveries.map((d: any) => {
                  const statusVariants: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
                    prepared: 'warning',
                    sent: 'info',
                    acknowledged: 'success',
                    failed: 'danger',
                  };

                  return (
                    <tr key={d.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div>{d.project?.title}</div>
                        <div className="text-[11px] text-slate-500 font-normal">
                          {d.course?.title} ({d.course?.code})
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{d.teacher?.full_name}</div>
                        <div className="text-[11px] text-slate-500">{d.teacher?.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{d.section?.academic_year?.name} — {d.section?.name}</div>
                        <Badge variant="neutral" className="mt-0.5 uppercase text-[10px]">
                          {d.channel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {d.batch_count} items
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariants[d.status] || 'neutral'}>
                          {d.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[11px] font-mono text-slate-500">
                        <div>Prepared: {formatDateUTC(d.prepared_at || d.created_at)}</div>
                        {d.sent_at && <div className="text-blue-600">Sent: {formatDateUTC(d.sent_at)}</div>}
                        {d.acknowledged_at && (
                          <div className="text-emerald-700 font-bold">Ack: {formatDateUTC(d.acknowledged_at)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeliveryActionsClient delivery={d} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
