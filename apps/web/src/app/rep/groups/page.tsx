// HU-ASMS: Representative Group Verification & Confirmation Console
import React from 'react';
import Link from 'next/link';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureRepresentativePage } from '../../../lib/auth/page-guards';
import { getActiveAssignedSectionIds } from '../../../lib/auth/roles';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { UsersRound, CheckCircle2, Clock, XCircle, Plus } from 'lucide-react';

export default async function RepGroupsPage() {
  const supabase = await createServerSupabaseClient();
  const context = await ensureRepresentativePage(supabase);

  const assignedSectionIds = getActiveAssignedSectionIds(context);

  const { data: groups } =
    assignedSectionIds.length === 0
      ? { data: null }
      : await supabase
    .from('groups')
    .select(`
      *,
      project:projects(*),
      section:sections(*, academic_year:academic_years(*)),
      leader:students!groups_group_leader_id_fkey(*),
      members:group_members(*, student:students(*))
    `)
    .in('section_id', assignedSectionIds)
    .order('group_code', { ascending: true });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Group Management & Verification Tracker</h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitor independent membership confirmations across pre-created project groups in your assigned sections.
          </p>
        </div>

        <Link
          href="/rep/groups/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-semibold hover:bg-emerald-800 transition-colors shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Pre-Create New Group</span>
        </Link>
      </div>

      <div className="space-y-6">
        {(!groups || groups.length === 0) ? (
          <Card>
            <div className="text-center py-12 text-sm text-slate-500">
              No groups assigned in your sections.
            </div>
          </Card>
        ) : (
          groups.map((group: any) => {
            const members = group.members || [];
            const confirmedCount = members.filter((m: any) => m.confirmation_status === 'confirmed').length;
            const pendingCount = members.filter((m: any) => m.confirmation_status === 'pending').length;
            const declinedCount = members.filter((m: any) => m.confirmation_status === 'declined').length;
            const isVerified = group.status === 'verified';
            const isSubmitted = group.status === 'submitted';

            return (
              <Card key={group.id} className="hover:border-slate-300 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold text-slate-900">{group.group_code}</span>
                      <Badge variant={isSubmitted ? 'info' : isVerified ? 'success' : 'warning'}>
                        {group.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Project: <span className="font-semibold text-slate-700">{group.project?.title}</span> • Scope: <span className="font-semibold text-slate-700">{group.section?.academic_year?.name} — {group.section?.name}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Designated Leader: <span className="font-semibold text-slate-800">{group.leader?.full_name || 'None Assigned'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium">
                    <span className="text-emerald-700">{confirmedCount} Confirmed</span>
                    {pendingCount > 0 && <span className="text-amber-600">{pendingCount} Pending</span>}
                    {declinedCount > 0 && <span className="text-red-600">{declinedCount} Declined</span>}
                  </div>
                </div>

                {/* Member Breakdown */}
                <div className="pt-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Team Members & Confirmation Lifecycle:</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {members.map((m: any) => {
                      const isConfirmed = m.confirmation_status === 'confirmed';
                      const isDeclined = m.confirmation_status === 'declined';
                      const isLeader = m.student_id === group.group_leader_id;

                      return (
                        <div
                          key={m.id}
                          className="p-3 bg-slate-50 rounded-lg border border-slate-200/60 flex items-center justify-between"
                        >
                          <div>
                            <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>{m.student?.full_name}</span>
                              {isLeader && (
                                <span className="px-1 py-0.2 bg-purple-100 text-purple-700 text-[10px] rounded font-bold">
                                  LEADER
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              {m.student?.hu_student_id}
                            </div>
                          </div>

                          <div>
                            {isConfirmed ? (
                              <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Confirmed</span>
                              </div>
                            ) : isDeclined ? (
                              <div className="flex items-center gap-1 text-[11px] font-medium text-red-600">
                                <XCircle className="w-3.5 h-3.5 text-red-600" />
                                <span>Declined</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                                <Clock className="w-3.5 h-3.5 text-amber-500" />
                                <span>Pending</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
