// HU-ASMS: Project Studio & Multi-Scope Targeting Management
import React from 'react';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';
import { Card } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { FolderGit2, Calendar, FileCode, Users } from 'lucide-react';
import { formatDateUTC, formatFileSize } from '@hu-asms/shared';

export default async function ProjectStudioPage() {
  const supabase = await createServerSupabaseClient();

  const { data: projects } = await supabase
    .from('projects')
    .select(`
      *,
      course:courses(*),
      teacher:teachers(*),
      file_rules:project_file_rules(*),
      targets:project_targets(*, academic_year:academic_years(*), section:sections(*))
    `)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Project Studio & Dynamic Targeting</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure academic submission specifications, deadlines, file constraints, and multi-scope targets.
        </p>
      </div>

      <div className="space-y-6">
        {projects?.map((proj: any) => {
          const isGroup = proj.submission_type === 'group';
          const isBoth = proj.submission_type === 'both';
          const typeBadge = isGroup ? '👥 Group' : isBoth ? '👥 / 👤 Both' : '👤 Individual';
          const rules = proj.file_rules;

          return (
            <Card key={proj.id} className="hover:border-slate-300 transition-colors">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-bold text-slate-900">{proj.title}</span>
                    <Badge variant={proj.is_active ? 'success' : 'neutral'}>
                      {proj.is_active ? 'Active' : 'Closed'}
                    </Badge>
                    <Badge variant="info">{typeBadge}</Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Course: <span className="font-semibold text-slate-700">{proj.course?.title} ({proj.course?.code})</span> • Teacher: <span className="font-semibold text-slate-700">{proj.teacher?.full_name}</span>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase">Deadline (UTC)</div>
                      <div className="font-semibold">{formatDateUTC(proj.deadline)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 text-xs">
                {/* Targeting Scope */}
                <div>
                  <div className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    <span>Targeted Academic Scope:</span>
                  </div>
                  <div className="space-y-1">
                    {proj.targets?.map((t: any) => (
                      <div key={t.id} className="p-1.5 bg-slate-50 rounded border border-slate-200/60 font-mono text-[11px] text-slate-700">
                        {t.academic_year?.name} {t.section ? `— ${t.section.name}` : '(All Sections)'}
                      </div>
                    ))}
                  </div>
                </div>

                {/* File Rules */}
                <div>
                  <div className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-slate-500" />
                    <span>File Requirements:</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded border border-slate-200/60 space-y-1 text-slate-600">
                    <div>Allowed: <code className="text-green-700 font-bold">{rules?.allowed_extensions?.join(', ') || 'pdf'}</code></div>
                    <div>Max Size: <span className="font-semibold">{rules?.max_file_size_bytes ? formatFileSize(rules.max_file_size_bytes) : '20 MB'}</span></div>
                    <div>Resubmissions: <span className="font-semibold">{proj.resubmission_allowed ? 'Allowed (Versioned)' : 'Disabled'}</span></div>
                  </div>
                </div>

                {/* Team Rules (if applicable) */}
                <div>
                  <div className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Submission Mode Rules:</span>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded border border-slate-200/60 space-y-1 text-slate-600">
                    {isGroup || isBoth ? (
                      <>
                        <div>Team Capacity: <span className="font-semibold">{rules?.min_group_size || 2} to {rules?.max_group_size || 5} members</span></div>
                        <div>Verification Gate: <span className="font-semibold text-emerald-700">100% Confirmation Required</span></div>
                      </>
                    ) : (
                      <div className="text-slate-500 italic">Individual student uploads only</div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
