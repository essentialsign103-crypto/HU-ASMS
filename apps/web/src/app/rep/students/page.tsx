// HU-ASMS: Section Representative Student Roster
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureRepresentativePage } from '../../../lib/auth/page-guards';
import { getActiveAssignedSectionIds } from '../../../lib/auth/roles';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';

export default async function RepStudentsPage() {
  const supabase = await createServerSupabaseClient();
  const context = await ensureRepresentativePage(supabase);

  const assignedSectionIds = getActiveAssignedSectionIds(context);

  const { data: students } =
    assignedSectionIds.length === 0
      ? { data: null }
      : await supabase
          .from('students')
          .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
          .in('section_id', assignedSectionIds)
          .order('full_name', { ascending: true });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Section Students Roster</h1>
        <p className="text-sm text-slate-500 mt-1">
          Registered students enrolled in your assigned sections. Data for outside sections is strictly restricted.
        </p>
      </div>

      <Card
        title="Enrolled Students"
        subtitle={`${students?.length || 0} students across your assigned academic scopes`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Student Full Name</th>
                <th className="px-4 py-3">HU Student ID</th>
                <th className="px-4 py-3">Assigned Scope</th>
                <th className="px-4 py-3">Telegram Linked</th>
                <th className="px-4 py-3">Registration Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {students?.map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-900">{s.full_name}</td>
                  <td className="px-4 py-3 font-mono text-slate-800">{s.hu_student_id}</td>
                  <td className="px-4 py-3">{s.academic_year?.name} — {s.section?.name}</td>
                  <td className="px-4 py-3">
                    {s.telegram_user_id ? (
                      <Badge variant="success">Linked (ID: {s.telegram_user_id})</Badge>
                    ) : (
                      <Badge variant="warning">Not Linked</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={s.registration_status === 'locked' ? 'success' : s.registration_status === 'suspended' ? 'danger' : 'warning'}>
                      {s.registration_status.toUpperCase()}
                    </Badge>
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
