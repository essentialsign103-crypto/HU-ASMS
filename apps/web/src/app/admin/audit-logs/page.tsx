// HU-ASMS: System Audit Logs Viewer
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureSystemOwnerPage } from '../../../lib/auth/page-guards';
import { Card } from '../../../components/ui/card';
import { FileClock } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';

export default async function AuditLogsPage() {
  const supabase = await createServerSupabaseClient();
  await ensureSystemOwnerPage(supabase);

  const { data: logs } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Institutional Audit Logs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Complete, immutable timeline of identity, academic, submission, and administrative events.
        </p>
      </div>

      <Card
        title="Audit Events Log"
        subtitle={`Showing recent ${logs?.length || 0} events in chronological order`}
        headerAction={<FileClock className="w-4 h-4 text-slate-400" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Timestamp (UTC)</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor Role</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Event Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
              {logs?.map((log: any) => (
                <tr key={log.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-500">{formatDateUTC(log.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 font-sans">{log.action}</td>
                  <td className="px-4 py-3 text-slate-600">{log.actor_role || 'system'}</td>
                  <td className="px-4 py-3 text-slate-600">{log.entity_type}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                    {JSON.stringify(log.metadata || {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
