// HU-ASMS: Section Representative Scope Overview
import React from 'react';
import Link from 'next/link';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { ensureRepresentativePage } from '../../lib/auth/page-guards';
import { getActiveAssignedSectionIds } from '../../lib/auth/roles';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Users, FileCheck2, UsersRound, ArrowRight } from 'lucide-react';

export default async function RepOverviewPage() {
  const supabase = await createServerSupabaseClient();
  const context = await ensureRepresentativePage(supabase);

  const assignedSectionIds = getActiveAssignedSectionIds(context);

  if (assignedSectionIds.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h1 className="text-lg font-semibold">No Active Section Assignments</h1>
          <p className="mt-2 text-sm text-amber-800">
            Your representative account is active, but no active academic section assignments are currently linked to your profile. Contact the System Owner to assign your section scope.
          </p>
        </div>
      </div>
    );
  }

  // Parallel fetch section-scoped data
  const [
    { data: students },
    { data: submissions },
    { data: groups },
  ] = await Promise.all([
    supabase.from('students').select('id, section_id').in('section_id', assignedSectionIds),
    supabase.from('submissions').select('id, section_id, status').in('section_id', assignedSectionIds).eq('status', 'active'),
    supabase.from('groups').select('id, section_id, status').in('section_id', assignedSectionIds),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Scope Overview & Submission Telemetry</h1>
        <p className="text-sm text-slate-500 mt-1">
          Real-time metrics strictly partitioned to your assigned academic sections.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Enrolled Students</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{students?.length || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Submissions</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{submissions?.length || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <FileCheck2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Teams</div>
            <div className="text-2xl font-bold text-purple-700 mt-1">{groups?.length || 0}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
            <UsersRound className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Assigned Sections Breakdown */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900">Your Assigned Academic Scopes</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {context.assignments.map((assign) => {
            const sec = assign.section;
            const secStudents = (students || []).filter((s) => s.section_id === assign.section_id);
            const secSubs = (submissions || []).filter((s) => s.section_id === assign.section_id);
            const secGroups = (groups || []).filter((g) => g.section_id === assign.section_id);

            return (
              <Card
                key={assign.id}
                title={`${sec?.academic_year?.name || 'Academic Year'} — ${sec?.name || 'Section'}`}
                subtitle="Strict scope partitioning active"
                headerAction={
                  <Link
                    href={`/rep/reports?sectionId=${assign.section_id}`}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                  >
                    <span>Section Reports</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                }
              >
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="text-xs text-slate-500 font-medium">Students</div>
                    <div className="text-lg font-bold text-slate-900 mt-0.5">{secStudents.length}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="text-xs text-slate-500 font-medium">Submissions</div>
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">{secSubs.length}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="text-xs text-slate-500 font-medium">Teams</div>
                    <div className="text-lg font-bold text-purple-700 mt-0.5">{secGroups.length}</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
