// HU-ASMS: Student Identity, Registration Approvals & Verification Token Console
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureSystemOwnerPage } from '../../../lib/auth/page-guards';
import {
  resolveTargetStudentForRequest,
  type TargetStudentSummary,
} from '../../../lib/admin/student-approval-service';
import { approveRegistration, rejectRegistration } from './actions';
import { StudentVerificationRosterConsole, type RosterStudentRow } from './token-issuer';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { UserCheck, UserX, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';
import { sanitizeHuStudentId } from '@hu-asms/validation';

export default async function StudentManagementPage() {
  const supabase = await createServerSupabaseClient();
  await ensureSystemOwnerPage(supabase);

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

  // Fetch bound target student records for every pending claim/account_recovery request
  const targetStudentIds = Array.from(
    new Set(
      (pendingRegistrations || [])
        .map((r: any) => r.target_student_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const claimOrRecoveryHuIds = Array.from(
    new Set(
      (pendingRegistrations || [])
        .filter((r: any) => r.request_type === 'account_recovery' || r.request_type === 'roster_claim')
        .map((r: any) => (typeof r.hu_student_id === 'string' ? sanitizeHuStudentId(r.hu_student_id) : ''))
        .filter((id: string) => id.length > 0)
    )
  );

  const targetSelect =
    'id, hu_student_id, full_name, telegram_user_id, telegram_username, registration_status, department:departments(*), academic_year:academic_years(*), section:sections(*)';
  const [byIdRes, byHuRes] = await Promise.all([
    targetStudentIds.length > 0
      ? supabase.from('students').select(targetSelect).in('id', targetStudentIds)
      : Promise.resolve({ data: [] as any[] }),
    claimOrRecoveryHuIds.length > 0
      ? supabase.from('students').select(targetSelect).in('hu_student_id', claimOrRecoveryHuIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const targetById = new Map<string, TargetStudentSummary>();
  const targetByHuId = new Map<string, TargetStudentSummary>();
  for (const row of [...(byIdRes.data || []), ...(byHuRes.data || [])] as TargetStudentSummary[]) {
    targetById.set(row.id, row);
    targetByHuId.set(sanitizeHuStudentId(row.hu_student_id), row);
  }

  const rosterRows: RosterStudentRow[] = (students || []).map((s: any) => ({
    id: s.id,
    hu_student_id: s.hu_student_id,
    full_name: s.full_name,
    registration_status: s.registration_status,
    telegram_user_id: s.telegram_user_id ?? null,
    telegram_username: s.telegram_username ?? null,
    departmentName: s.department?.name || 'Department',
    academicScope: `${s.academic_year?.name || 'Year'} — ${s.section?.name || 'Section'}`,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Student Identity Lifecycle & Registrations</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review first-time Telegram bindings, verified recovery requests, single-use verification tokens, and enrolled student rosters.
        </p>
      </div>

      {/* Pending Registration, Claim & Recovery Requests */}
      <Card
        title="Pending Registrations, Roster Claims & Account Recoveries"
        subtitle={`${pendingRegistrations?.length || 0} student identity requests waiting for administrative verification`}
      >
        {(!pendingRegistrations || pendingRegistrations.length === 0) ? (
          <div className="text-center py-6 text-sm text-slate-500">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <div>All student registrations and verification requests have been processed.</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pendingRegistrations.map((req: any) => {
              const reqType = req.request_type || 'new_registration';
              const isClaimOrRecovery = reqType === 'account_recovery' || reqType === 'roster_claim';
              const targetStudent = isClaimOrRecovery
                ? resolveTargetStudentForRequest(req, targetById, targetByHuId)
                : null;
              const nameDiffers =
                Boolean(targetStudent) &&
                targetStudent!.full_name.trim().toLowerCase() !==
                  String(req.full_name || '').trim().toLowerCase();

              const typeBadge =
                reqType === 'account_recovery'
                  ? { label: 'Telegram Account Recovery', variant: 'warning' as const }
                  : reqType === 'roster_claim'
                  ? { label: 'Roster Account Claim', variant: 'info' as const }
                  : { label: 'First-Time Registration', variant: 'neutral' as const };

              return (
                <div key={req.id} className="py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{req.full_name}</span>
                      <Badge variant={typeBadge.variant}>{typeBadge.label}</Badge>
                      {nameDiffers && (
                        <Badge variant="danger" className="gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Applicant Name Mismatch</span>
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Applicant HU ID: <code className="text-slate-800 font-mono font-semibold">{req.hu_student_id}</code> •{' '}
                      {req.department?.name || 'Department'} • {req.academic_year?.name} ({req.section?.name})
                    </div>
                    {req.recovery_reason && (
                      <div className="text-xs text-amber-800 italic">
                        Applicant Verification Reason: &quot;{req.recovery_reason}&quot;
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400">
                      Requesting Telegram: @{req.telegram_username || 'N/A'} (ID: {req.telegram_user_id}) • Requested {formatDateUTC(req.created_at)}
                    </div>

                    {isClaimOrRecovery && (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                        <div className="font-semibold text-slate-800">
                          Existing Enrolled Target Student Record ({reqType === 'account_recovery' ? 'Current Account Holder' : 'Unlinked Roster Target'}):
                        </div>
                        {targetStudent ? (
                          <div className="text-slate-600 space-y-0.5">
                            <div>
                              Enrolled Name: <span className="font-semibold text-slate-900">{targetStudent.full_name}</span> •{' '}
                              HU ID: <code className="font-mono text-slate-800">{targetStudent.hu_student_id}</code> •{' '}
                              Status: <span className="font-semibold uppercase">{targetStudent.registration_status}</span>
                            </div>
                            <div>
                              Enrolled Scope: {targetStudent.department?.name || 'Department'} — {targetStudent.academic_year?.name || 'Year'} ({targetStudent.section?.name || 'Section'})
                            </div>
                            <div>
                              Currently Linked Telegram:{' '}
                              {targetStudent.telegram_user_id !== null && targetStudent.telegram_user_id !== undefined ? (
                                <span className="font-mono text-slate-900">
                                  @{targetStudent.telegram_username || 'N/A'} (ID: {targetStudent.telegram_user_id})
                                </span>
                              ) : (
                                <span className="italic text-slate-500">Unlinked</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-red-700 font-medium">
                            Warning: Target student record could not be resolved. Verify HU Student ID before approving.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <form action={approveRegistration}>
                      <input type="hidden" name="requestId" value={req.id} />
                      <Button type="submit" variant="primary" size="sm" className="gap-1.5">
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Approve &amp; Lock</span>
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
              );
            })}
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
                    Reason: <span className="italic">&quot;{corr.reason}&quot;</span>
                  </div>
                </div>
                <Badge variant="warning">Correction Pending</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Single-Use Verification Token Issuer & Enrolled Student Roster */}
      <StudentVerificationRosterConsole students={rosterRows} />
    </div>
  );
}
