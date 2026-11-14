// HU-ASMS: Representative Management Console
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureSystemOwnerPage } from '../../../lib/auth/page-guards';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { ShieldCheck, UserCheck, UserX, AlertTriangle, RefreshCw, Send } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';
import {
  deactivateRepresentativeAction,
  reassignRepresentativeAction,
} from './actions';
import { retryNotificationAction } from '../students/actions';
import { RepresentativeAssignForm } from './representative-assign-form';

export default async function RepresentativesPage() {
  const supabase = await createServerSupabaseClient();
  await ensureSystemOwnerPage(supabase);

  const [
    { data: representatives },
    { data: sections },
    { data: eligibleStudents },
    { data: failedNotifications },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('*, assignments:representative_assignments!representative_assignments_profile_id_fkey(*, section:sections(*, academic_year:academic_years(*)))')
      .eq('role', 'representative')
      .order('full_name', { ascending: true }),
    supabase
      .from('sections')
      .select('*, academic_year:academic_years(*)')
      .order('name', { ascending: true }),
    supabase
      .from('students')
      .select('id, full_name, hu_student_id, telegram_user_id, section_id, department:departments(name), section:sections(name, academic_year:academic_years(name))')
      .eq('registration_status', 'locked')
      .eq('is_locked', true)
      .not('telegram_user_id', 'is', null)
      .order('full_name', { ascending: true }),
    supabase
      .from('notifications')
      .select('*')
      .eq('recipient_type', 'representative')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Academic Section Representatives</h1>
        <p className="text-sm text-slate-500 mt-1">
          Assign, audit, and manage authorized student representatives with strictly partitioned section access.
        </p>
      </div>

      {/* Outbound Delivery Failures Alert Card */}
      {failedNotifications && failedNotifications.length > 0 && (
        <Card
          title="Failed Outbound Telegram Representative Alerts"
          subtitle={`${failedNotifications.length} alerts failed to deliver to representatives`}
          headerAction={<AlertTriangle className="w-5 h-5 text-amber-500" />}
        >
          <div className="divide-y divide-slate-100">
            {failedNotifications.map((notif: any) => (
              <div key={notif.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-slate-900">
                    Recipient Telegram ID: <code className="font-mono text-emerald-800">{notif.recipient_telegram_id}</code>
                  </div>
                  <div className="text-red-700 mt-0.5">Error: {notif.error_message || 'Delivery failure'}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Attempted: {formatDateUTC(notif.created_at)} • Retries: {notif.retry_count || 0}
                  </div>
                </div>
                <form action={retryNotificationAction}>
                  <input type="hidden" name="notificationId" value={notif.id} />
                  <Button type="submit" variant="secondary" size="sm" className="gap-1.5 shrink-0">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Dispatch</span>
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 1. Assign New Representative Form */}
      <Card
        title="Designate Section Representative"
        subtitle="Only approved, locked students with linked Telegram accounts are eligible for representative privileges"
        headerAction={<UserCheck className="w-4 h-4 text-emerald-600" />}
      >
        <RepresentativeAssignForm
          eligibleStudents={eligibleStudents || []}
          sections={sections || []}
        />
      </Card>

      {/* 2. Active Representative Assignments */}
      <div className="space-y-6">
        <Card
          title="Active Representative Assignments"
          subtitle={`${representatives?.length || 0} designated section representatives`}
          headerAction={<ShieldCheck className="w-4 h-4 text-slate-400" />}
        >
          {(!representatives || representatives.length === 0) ? (
            <div className="text-center py-8 text-sm text-slate-500">
              No section representatives designated yet. Assign an approved student above.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {representatives.map((rep: any) => {
                const activeAssignments = (rep.assignments || []).filter((a: any) => a.is_active);

                return (
                  <div key={rep.id} className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{rep.full_name}</span>
                        <Badge variant={rep.is_active && activeAssignments.length > 0 ? 'success' : 'neutral'}>
                          {rep.is_active && activeAssignments.length > 0 ? 'Active Representative' : 'Deactivated / Unassigned'}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-500">
                        Telegram Numeric ID: <code className="text-emerald-700 font-mono font-medium">{rep.telegram_user_id || 'Not Linked'}</code>
                        {rep.telegram_username && <span> • @{rep.telegram_username}</span>}
                      </div>
                      <div className="text-xs text-slate-400">{rep.email}</div>
                    </div>

                    <div className="flex flex-col items-start lg:items-end gap-2">
                      <div className="text-xs font-semibold text-slate-700">Assigned Sections:</div>
                      <div className="flex flex-wrap items-center gap-2">
                        {activeAssignments.length === 0 ? (
                          <span className="text-xs text-amber-600 italic">No active section assigned</span>
                        ) : (
                          activeAssignments.map((a: any) => (
                            <div key={a.id} className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium">
                                {a.section?.academic_year?.name} — {a.section?.name}
                              </span>
                              <form action={deactivateRepresentativeAction}>
                                <input type="hidden" name="assignmentId" value={a.id} />
                                <Button type="submit" variant="danger" size="sm" className="h-7 px-2 text-[11px] gap-1">
                                  <UserX className="w-3 h-3" />
                                  <span>Deactivate</span>
                                </Button>
                              </form>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Section Reassignment Form */}
                      {activeAssignments.length > 0 && (
                        <form action={reassignRepresentativeAction} className="flex items-center gap-2 mt-1">
                          <input type="hidden" name="assignmentId" value={activeAssignments[0].id} />
                          <select
                            name="newSectionId"
                            required
                            className="text-[11px] rounded border border-slate-300 bg-white px-2 py-1 text-slate-800"
                          >
                            <option value="">Reassign Section...</option>
                            {sections?.map((sec: any) => (
                              <option key={sec.id} value={sec.id}>
                                {sec.academic_year?.name} — {sec.name}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="secondary" size="sm" className="h-6 px-2 text-[10px]">
                            Reassign
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
