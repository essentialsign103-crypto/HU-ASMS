// HU-ASMS: Student Identity, Registration Approvals & Correction Console
import React from 'react';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { UserCheck, UserX, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';

// Server Action: Approve Student Registration
async function approveRegistration(formData: FormData) {
  'use server';
  const requestId = formData.get('requestId') as string;
  const supabase = await createServerSupabaseClient();

  const { data: req, error: fetchErr } = await supabase
    .from('registration_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (fetchErr || !req) return;

  // Insert or update approved student
  await supabase.from('students').insert({
    hu_student_id: req.hu_student_id,
    full_name: req.full_name,
    department_id: req.department_id,
    academic_year_id: req.academic_year_id,
    section_id: req.section_id,
    telegram_user_id: req.telegram_user_id,
    telegram_username: req.telegram_username,
    registration_status: 'locked',
    is_locked: true,
  });

  // Update request status
  await supabase
    .from('registration_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', requestId);

  revalidatePath('/admin/students');
  revalidatePath('/admin');
}

// Server Action: Reject Student Registration
async function rejectRegistration(formData: FormData) {
  'use server';
  const requestId = formData.get('requestId') as string;
  const reason = (formData.get('reason') as string) || 'Identity verification mismatch';
  const supabase = await createServerSupabaseClient();

  await supabase
    .from('registration_requests')
    .update({ status: 'rejected', admin_notes: reason, reviewed_at: new Date().toISOString() })
    .eq('id', requestId);

  revalidatePath('/admin/students');
  revalidatePath('/admin');
}

export default async function StudentManagementPage() {
  const supabase = await createServerSupabaseClient();

  const [
    { data: pendingRegistrations },
    { data: correctionRequests },
    { data: students },
  ] = await Promise.all([
    supabase
      .from('registration_requests')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('identity_change_requests')
      .select('*, student:students(*)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .order('full_name', { ascending: true })
      .limit(50),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Student Identity Lifecycle & Registrations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review first-time Telegram bindings, identity locking, correction requests, and enrolled student rosters.
        </p>
      </div>

      {/* Pending Registration Requests */}
      <Card
        title="First-Time Registration Approvals"
        subtitle={`${pendingRegistrations?.length || 0} student identity bindings waiting for administrative locking`}
      >
        {(!pendingRegistrations || pendingRegistrations.length === 0) ? (
          <div className="text-center py-6 text-sm text-slate-500">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <div>All student registrations have been approved and locked.</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pendingRegistrations.map((req: any) => (
              <div key={req.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">{req.full_name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    HU ID: <code className="text-slate-800 font-mono font-semibold">{req.hu_student_id}</code> • {req.academic_year?.name} ({req.section?.name})
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Telegram: @{req.telegram_username || 'N/A'} (ID: {req.telegram_user_id}) • Requested {formatDateUTC(req.created_at)}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <form action={approveRegistration}>
                    <input type="hidden" name="requestId" value={req.id} />
                    <Button type="submit" variant="primary" size="sm" className="gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Approve & Lock</span>
                    </Button>
                  </form>

                  <form action={rejectRegistration}>
                    <input type="hidden" name="requestId" value={req.id} />
                    <Button type="submit" variant="danger" size="sm" className="gap-1.5">
                      <UserX className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Identity Correction Requests */}
      {correctionRequests && correctionRequests.length > 0 && (
        <Card
          title="Identity Correction Requests"
          subtitle={`${correctionRequests.length} students requesting academic detail corrections`}
        >
          <div className="divide-y divide-slate-100">
            {correctionRequests.map((corr: any) => (
              <div key={corr.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">{corr.student?.full_name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Reason: <span className="italic">"{corr.reason}"</span>
                  </div>
                </div>
                <Badge variant="warning">Correction Pending</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Enrolled Students Roster */}
      <Card
        title="Approved Student Roster"
        subtitle={`Showing up to 50 active students across all university departments`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Student Name</th>
                <th className="px-4 py-3">HU ID</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Academic Scope</th>
                <th className="px-4 py-3">Identity Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {students?.map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-900">{s.full_name}</td>
                  <td className="px-4 py-3 font-mono text-slate-800">{s.hu_student_id}</td>
                  <td className="px-4 py-3">{s.department?.name || 'Department'}</td>
                  <td className="px-4 py-3">{s.academic_year?.name} — {s.section?.name}</td>
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
