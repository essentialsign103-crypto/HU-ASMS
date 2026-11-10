// HU-ASMS: Section Submissions & File Vault Viewer
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../lib/auth/roles';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { DownloadButton } from './download-button';
import { FileText, Users, User } from 'lucide-react';
import { formatDateUTC, formatFileSize } from '@hu-asms/shared';

export default async function RepSubmissionsPage() {
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  if (!context || !context.profile) {
    return null;
  }

  const assignedSectionIds = context.assignments.map((a) => a.section_id);

  const { data: submissions } = await supabase
    .from('submissions')
    .select(`
      *,
      project:projects(*),
      section:sections(*, academic_year:academic_years(*)),
      student:students(*),
      group:groups(*),
      files:submission_files(*),
      snapshots:submission_members(*)
    `)
    .in('section_id', assignedSectionIds)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Submissions & File Vault</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review individual and group assignments received in your assigned sections. Download files via temporary signed URLs.
        </p>
      </div>

      <Card
        title="Received Submissions"
        subtitle={`${submissions?.length || 0} active & historical submissions in scope`}
      >
        {(!submissions || submissions.length === 0) ? (
          <div className="text-center py-12 text-sm text-slate-500">
            No submissions recorded yet in your assigned sections.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Project Title</th>
                  <th className="px-4 py-3">Submitter / Group</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Version & Status</th>
                  <th className="px-4 py-3">File Attachment</th>
                  <th className="px-4 py-3">Timestamp (UTC)</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {submissions.map((sub: any) => {
                  const isGroup = sub.submission_type === 'group';
                  const file = sub.files?.[0];
                  const submitterLabel = isGroup
                    ? `${sub.group?.group_code} (Team)`
                    : sub.student?.full_name || 'Individual Student';

                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-900">{sub.project?.title}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-medium text-slate-900">
                          {isGroup ? <Users className="w-3.5 h-3.5 text-purple-600" /> : <User className="w-3.5 h-3.5 text-blue-600" />}
                          <span>{submitterLabel}</span>
                        </div>
                        {isGroup && sub.snapshots?.length > 0 && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Credited: {sub.snapshots.map((s: any) => s.student_name).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={isGroup ? 'info' : 'neutral'}>
                          {isGroup ? 'Group' : 'Individual'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold">v{sub.version}</span>
                          <Badge variant={sub.status === 'active' ? 'success' : 'neutral'}>
                            {sub.status.toUpperCase()}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {file ? (
                          <div className="flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            <span className="truncate max-w-xs">{file.original_filename}</span>
                            <span className="text-slate-400">({formatFileSize(file.file_size_bytes)})</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">No file record</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono">{formatDateUTC(sub.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {file && (
                          <DownloadButton fileId={file.id} fileName={file.original_filename} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
