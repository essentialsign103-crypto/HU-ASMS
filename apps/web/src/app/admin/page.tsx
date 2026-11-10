// HU-ASMS: System Owner Overview Dashboard
import React from 'react';
import Link from 'next/link';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Users, UserPlus, FolderGit2, FileCheck2, ShieldCheck, ArrowRight } from 'lucide-react';
import { formatDateUTC } from '@hu-asms/shared';

export default async function AdminOverviewPage() {
  const supabase = await createServerSupabaseClient();

  // Parallel fetch telemetry
  const [
    { count: studentCount },
    { count: pendingRegCount },
    { count: projectCount },
    { count: submissionCount },
    { count: repCount },
    { data: pendingRegistrations },
    { data: recentAuditLogs },
  ] = await Promise.all([
    supabase.from('students').select('*', { count: 'exact', head: true }),
    supabase.from('registration_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('projects').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('representative_assignments').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase
      .from('registration_requests')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(5),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Telemetry & Control</h1>
        <p className="text-sm text-slate-500 mt-1">
          Real-time institutional metrics across Haramaya University academic submission hierarchy.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Enrolled Students</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{studentCount || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Approvals</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{pendingRegCount || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <UserPlus className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Projects</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{projectCount || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <FolderGit2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Submissions</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{submissionCount || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-green-50 text-green-700 flex items-center justify-center">
            <FileCheck2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Reps</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{repCount || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pending Registration Queue */}
        <Card
          title="Registration Approval Queue"
          subtitle="New student accounts requiring official identity locking."
          headerAction={
            <Link
              href="/admin/students"
              className="text-xs font-semibold text-green-700 hover:text-green-800 flex items-center gap-1"
            >
              <span>Manage Roster</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {(!pendingRegistrations || pendingRegistrations.length === 0) ? (
            <div className="text-sm text-slate-500 text-center py-6">
              ✅ No pending student registration requests. All identities verified.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingRegistrations.map((req: any) => (
                <div key={req.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{req.full_name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      HU ID: <code className="text-slate-800 font-mono">{req.hu_student_id}</code> • {req.academic_year?.name} ({req.section?.name})
                    </div>
                  </div>
                  <Badge variant="warning">Pending Approval</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Security & Audit Trail */}
        <Card
          title="Recent System Audit Events"
          subtitle="Immutable operational log of security & academic events."
          headerAction={
            <Link
              href="/admin/audit-logs"
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1"
            >
              <span>View Full Trail</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {(!recentAuditLogs || recentAuditLogs.length === 0) ? (
            <div className="text-sm text-slate-500 text-center py-6">No audit records recorded yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentAuditLogs.map((log: any) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">{log.action}</span>
                    <span className="text-slate-400 mx-1.5">•</span>
                    <span className="text-slate-500">{log.entity_type}</span>
                  </div>
                  <div className="text-slate-400 font-mono">{formatDateUTC(log.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
