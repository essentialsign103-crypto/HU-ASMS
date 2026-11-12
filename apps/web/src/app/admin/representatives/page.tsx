// HU-ASMS: Representative Management Console
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureSystemOwnerPage } from '../../../lib/auth/page-guards';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { ShieldCheck, UserCheck } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';

export default async function RepresentativesPage() {
  const supabase = await createServerSupabaseClient();
  await ensureSystemOwnerPage(supabase);

  const [
    { data: representatives },
    { data: sections },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('*, assignments:representative_assignments(*, section:sections(*, academic_year:academic_years(*)))')
      .eq('role', 'representative')
      .order('full_name', { ascending: true }),
    supabase.from('sections').select('*, academic_year:academic_years(*)').order('name', { ascending: true }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Academic Section Representatives</h1>
        <p className="text-sm text-slate-500 mt-1">
          Assign and audit authorized student representatives with strictly partitioned section access.
        </p>
      </div>

      <div className="space-y-6">
        <Card
          title="Active Representative Assignments"
          subtitle={`${representatives?.length || 0} designated section representatives`}
          headerAction={<ShieldCheck className="w-4 h-4 text-slate-400" />}
        >
          <div className="divide-y divide-slate-100">
            {representatives?.map((rep: any) => (
              <div key={rep.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{rep.full_name}</span>
                    <Badge variant={rep.is_active ? 'success' : 'neutral'}>
                      {rep.is_active ? 'Active' : 'Deactivated'}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Telegram Numeric ID: <code className="text-emerald-700 font-mono font-medium">{rep.telegram_user_id || 'Not Linked'}</code>
                  </div>
                  {rep.telegram_username && (
                    <div className="text-[11px] text-slate-400">@{rep.telegram_username}</div>
                  )}
                </div>

                <div className="flex flex-col items-start md:items-end gap-1.5">
                  <div className="text-xs font-semibold text-slate-700">Assigned Sections:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {rep.assignments?.length === 0 ? (
                      <span className="text-xs text-amber-600 italic">No section assigned</span>
                    ) : (
                      rep.assignments?.map((a: any) => (
                        <span
                          key={a.id}
                          className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium"
                        >
                          {a.section?.academic_year?.name} — {a.section?.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
