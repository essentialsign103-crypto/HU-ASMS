// HU-ASMS: System Owner Single-Use Verification & Account Recovery Token Issuer UI
'use client';

import React, { useState, useTransition } from 'react';
import { KeyRound, Copy, Check, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import { issueStudentVerificationTokenAction } from './actions';

export interface RosterStudentRow {
  id: string;
  hu_student_id: string;
  full_name: string;
  registration_status: string;
  telegram_user_id: number | null;
  telegram_username?: string | null;
  departmentName: string;
  academicScope: string;
}

interface IssuedBannerState {
  token: string;
  huStudentId: string;
  fullName?: string;
  purpose: 'roster_claim' | 'account_recovery';
  expiresAt?: string;
}

export function StudentVerificationRosterConsole({
  students,
}: {
  students: RosterStudentRow[];
}) {
  const [huStudentIdInput, setHuStudentIdInput] = useState('');
  const [purposeInput, setPurposeInput] = useState<'roster_claim' | 'account_recovery'>('roster_claim');
  const [expiresHoursInput, setExpiresHoursInput] = useState<number>(24);
  const [issuedBanner, setIssuedBanner] = useState<IssuedBannerState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function triggerIssue(params: {
    studentId?: string;
    huStudentId?: string;
    purpose: 'roster_claim' | 'account_recovery';
    expiresHours?: number;
    fallbackHuId?: string;
    fallbackName?: string;
  }) {
    setErrorMsg(null);
    setCopied(false);
    setActiveRowId(params.studentId || 'form');

    startTransition(async () => {
      const res = await issueStudentVerificationTokenAction({
        studentId: params.studentId,
        huStudentId: params.huStudentId,
        purpose: params.purpose,
        expiresHours: params.expiresHours ?? 24,
      });

      setActiveRowId(null);

      if (!res.success || !res.token) {
        setErrorMsg(res.error || 'Failed to issue verification token.');
        return;
      }

      setIssuedBanner({
        token: res.token,
        huStudentId: res.huStudentId || params.fallbackHuId || params.huStudentId || 'Student',
        fullName: res.fullName || params.fallbackName,
        purpose: res.purpose || params.purpose,
        expiresAt: res.expiresAt,
      });
    });
  }

  async function copyIssuedToken() {
    if (!issuedBanner?.token || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(issuedBanner.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Single-Use Verification & Recovery Code Issuer"
        subtitle="Generate one-time SHA-256 hashed codes for verified students claiming a roster entry or recovering a lost Telegram account."
      >
        <div className="space-y-4">
          {issuedBanner && (
            <div
              role="status"
              className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span>
                    One-Time {issuedBanner.purpose === 'account_recovery' ? 'Account Recovery' : 'Roster Claim'} Code Issued for{' '}
                    <code className="font-mono">{issuedBanner.huStudentId}</code>
                    {issuedBanner.fullName ? ` (${issuedBanner.fullName})` : ''}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setIssuedBanner(null)}
                >
                  Dismiss
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="px-3 py-1.5 rounded bg-white border border-emerald-300 font-mono text-sm font-bold tracking-wider text-slate-900 select-all">
                  {issuedBanner.token}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={copyIssuedToken}
                  className="gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Code'}</span>
                </Button>
              </div>
              <p className="text-[11px] text-emerald-900">
                Shown once only — share securely with the verified student. Only the SHA-256 digest is stored in the database.
                {issuedBanner.expiresAt ? ` Expires UTC: ${new Date(issuedBanner.expiresAt).toUTCString()}.` : ''}
              </p>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form
            className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              triggerIssue({
                huStudentId: huStudentIdInput,
                purpose: purposeInput,
                expiresHours: expiresHoursInput,
              });
            }}
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                HU Student ID
              </label>
              <input
                type="text"
                required
                placeholder="HU/10002/14"
                value={huStudentIdInput}
                onChange={(e) => setHuStudentIdInput(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Verification Purpose
              </label>
              <select
                value={purposeInput}
                onChange={(e) =>
                  setPurposeInput(
                    e.target.value === 'account_recovery' ? 'account_recovery' : 'roster_claim'
                  )
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-green-600"
              >
                <option value="roster_claim">Roster Claim (Unlinked Student)</option>
                <option value="account_recovery">Account Recovery (Re-link Telegram)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Expiration Window (Hours)
              </label>
              <input
                type="number"
                min={1}
                max={168}
                value={expiresHoursInput}
                onChange={(e) => setExpiresHoursInput(Math.min(Math.max(Number(e.target.value) || 24, 1), 168))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>

            <div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isPending && activeRowId === 'form'}
                disabled={isPending}
                className="w-full gap-1.5"
              >
                <KeyRound className="w-4 h-4" />
                <span>Issue Single-Use Code</span>
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <Card
        title="Enrolled Student Roster"
        subtitle={`Showing up to 50 enrolled students across all university departments`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Student Name</th>
                <th className="px-4 py-3">HU ID</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Academic Scope</th>
                <th className="px-4 py-3">Telegram Binding</th>
                <th className="px-4 py-3">Identity Status</th>
                <th className="px-4 py-3 text-right">Verification Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {students.map((s) => {
                const defaultPurpose: 'roster_claim' | 'account_recovery' =
                  s.telegram_user_id !== null && s.telegram_user_id !== undefined
                    ? 'account_recovery'
                    : 'roster_claim';
                const isSuspended = s.registration_status === 'suspended';

                return (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">{s.full_name}</td>
                    <td className="px-4 py-3 font-mono text-slate-800">{s.hu_student_id}</td>
                    <td className="px-4 py-3">{s.departmentName}</td>
                    <td className="px-4 py-3">{s.academicScope}</td>
                    <td className="px-4 py-3">
                      {s.telegram_user_id !== null && s.telegram_user_id !== undefined ? (
                        <span className="font-mono text-[11px] text-slate-700">
                          {s.telegram_username ? `@${s.telegram_username} ` : ''}({s.telegram_user_id})
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unlinked</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          s.registration_status === 'locked'
                            ? 'success'
                            : isSuspended
                            ? 'danger'
                            : 'warning'
                        }
                      >
                        {s.registration_status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSuspended || isPending}
                        isLoading={isPending && activeRowId === s.id}
                        onClick={() =>
                          triggerIssue({
                            studentId: s.id,
                            purpose: defaultPurpose,
                            expiresHours: 24,
                            fallbackHuId: s.hu_student_id,
                            fallbackName: s.full_name,
                          })
                        }
                        className="gap-1.5"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>
                          {defaultPurpose === 'account_recovery' ? 'Recovery Code' : 'Claim Code'}
                        </span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
