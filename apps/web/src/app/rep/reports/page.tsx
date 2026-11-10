// HU-ASMS: Representative Section Compliance Reports
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { BarChart3, AlertCircle, FileCheck2, UserX } from 'lucide-react';
import { formatDateUTC, formatFileSize } from '@hu-asms/shared';

export default async function RepReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ sectionId?: string; projectId?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  if (!context || !context.profile) {
    return null;
  }

  const assignedSectionIds = context.assignments.map((a) => a.section_id);
  const selectedSectionId = params.sectionId || assignedSectionIds[0];

  // Fetch projects targeted to assigned sections
  const { data: projects } = await supabase
    .from('projects')
    .select(`
      *,
      course:courses(*),
      teacher:teachers(*),
      targets:project_targets(*)
    `)
    .eq('is_active', true)
    .order('deadline', { ascending: true });

  // Filter projects targeted to current section
  const sectionProjects = (projects || []).filter((p) =>
    p.targets?.some((t: any) => !t.section_id || t.section_id === selectedSectionId)
  );

  const selectedProjectId = params.projectId || sectionProjects[0]?.id;
  const currentProject = sectionProjects.find((p) => p.id === selectedProjectId);

  // Fetch submissions and students for selected section & project
  const [
    { data: sectionStudents },
    { data: activeSubmissions },
  ] = await Promise.all([
    supabase.from('students').select('*').eq('section_id', selectedSectionId).order('full_name', { ascending: true }),
    selectedProjectId
      ? supabase
          .from('submissions')
          .select('*, files:submission_files(*), student:students(*), group:groups(*)')
          .eq('project_id', selectedProjectId)
          .eq('section_id', selectedSectionId)
          .eq('status', 'active')
      : Promise.resolve({ data: [] }),
  ]);

  const studentsList = sectionStudents || [];
  const submissionsList = activeSubmissions || [];

  const submittedStudentIds = new Set(submissionsList.map((s: any) => s.student_id).filter(Boolean));
  const missingStudents = studentsList.filter((s: any) => !submittedStudentIds.has(s.id));

  const totalExpected = studentsList.length;
  const submittedCount = submissionsList.length;
  const completionPct = totalExpected > 0 ? Math.round((submittedCount / totalExpected) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Compliance & Monitoring Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Section-scoped submission progress, submitted artifacts, and missing student diagnostics.
          </p>
        </div>

        {/* Section Scope Selector if multi-assigned */}
        {context.assignments.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Switch Section:</span>
            <div className="flex gap-1.5">
              {context.assignments.map((a) => (
                <a
                  key={a.id}
                  href={`/rep/reports?sectionId=${a.section_id}`}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${
                    a.section_id === selectedSectionId
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {a.section?.name}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Project Selector Bar */}
      {sectionProjects.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200">
          <span className="text-xs font-semibold text-slate-500 shrink-0">Projects:</span>
          {sectionProjects.map((p) => (
            <a
              key={p.id}
              href={`/rep/reports?sectionId=${selectedSectionId}&projectId=${p.id}`}
              className={`text-xs px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                p.id === selectedProjectId
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.title}
            </a>
          ))}
        </div>
      )}

      {currentProject && (
        <div className="space-y-6">
          {/* Progress Header Card */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">{currentProject.title}</h2>
                <Badge variant={currentProject.submission_type === 'group' ? 'info' : 'neutral'}>
                  {currentProject.submission_type.toUpperCase()}
                </Badge>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Course: {currentProject.course?.title} • Deadline: {formatDateUTC(currentProject.deadline)}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-xs text-slate-500">Progress Completion</div>
                <div className="text-2xl font-bold text-emerald-700 mt-0.5">
                  {submittedCount} / {totalExpected} ({completionPct}%)
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Submitted Roster */}
            <Card
              title={`Submitted Artifacts (${submittedCount})`}
              subtitle="Received and secured in private vault"
              headerAction={<FileCheck2 className="w-4 h-4 text-emerald-600" />}
            >
              {submissionsList.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400 italic">No submissions received yet</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {submissionsList.map((sub: any) => {
                    const file = sub.files?.[0];
                    const label = sub.student?.full_name || sub.group?.group_code || 'Unknown';
                    return (
                      <div key={sub.id} className="py-3 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-slate-900">{label}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {file?.original_filename || 'Document'} ({file?.file_size_bytes ? formatFileSize(file.file_size_bytes) : '0 B'})
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] font-mono text-slate-400">{formatDateUTC(sub.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Missing Students Roster */}
            <Card
              title={`Missing Submissions (${missingStudents.length})`}
              subtitle="Enrolled students with no active submission recorded"
              headerAction={<UserX className="w-4 h-4 text-amber-600" />}
            >
              {missingStudents.length === 0 ? (
                <div className="text-center py-8 text-xs text-emerald-600 font-medium">
                  🎉 100% submission compliance! No missing students.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {missingStudents.map((s: any) => (
                    <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">{s.full_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">HU ID: {s.hu_student_id}</div>
                      </div>
                      <Badge variant={s.telegram_user_id ? 'neutral' : 'warning'}>
                        {s.telegram_user_id ? 'Telegram Linked' : 'No Telegram'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
