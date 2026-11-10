// HU-ASMS: Interactive Delivery Package Builder Client Component
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { prepareDeliveryBatch } from '../actions';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { PackageCheck, CheckSquare, Square, AlertCircle, FileText, User, Users } from 'lucide-react';
import { formatFileSize, formatDateUTC } from '@hu-asms/shared';

export function DeliveryForm({
  sectionId,
  projects,
  submissions,
  teachers,
}: {
  sectionId: string;
  projects: any[];
  submissions: any[];
  teachers: any[];
}) {
  const router = useRouter();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<'telegram' | 'email' | 'in_person'>('telegram');
  const [notes, setNotes] = useState('');
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentProject = projects.find((p) => p.id === selectedProjectId);

  // Filter submissions by selected project
  const projectSubmissions = submissions.filter((s) => s.project_id === selectedProjectId);

  // Set default teacher from project if not set
  React.useEffect(() => {
    if (currentProject?.teacher_id && !selectedTeacherId) {
      setSelectedTeacherId(currentProject.teacher_id);
    }
  }, [currentProject, selectedTeacherId]);

  const toggleSelectAll = () => {
    if (selectedSubIds.length === projectSubmissions.length) {
      setSelectedSubIds([]);
    } else {
      setSelectedSubIds(projectSubmissions.map((s) => s.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedSubIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSubIds.length === 0) {
      setErrorMsg('Please select at least one submission to include in the delivery batch.');
      return;
    }

    if (!selectedTeacherId) {
      setErrorMsg('Please select a recipient course teacher.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    const res = await prepareDeliveryBatch({
      sectionId,
      projectId: selectedProjectId,
      teacherId: selectedTeacherId,
      channel: selectedChannel,
      deliveryNotes: notes,
      submissionIds: selectedSubIds,
    });

    if (!res.success) {
      setErrorMsg(res.error || 'Failed to prepare delivery package.');
      setIsLoading(false);
    } else {
      router.push('/rep/deliveries');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errorMsg && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 1. Project Selection */}
      <Card title="1. Select Project & Recipient Teacher">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Targeted Academic Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSelectedSubIds([]);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.course?.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Recipient Course Instructor
            </label>
            <select
              value={selectedTeacherId}
              onChange={(e) => setSelectedTeacherId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name} ({t.email})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pt-4 border-t border-slate-100">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Delivery Channel
            </label>
            <div className="flex gap-4 text-xs font-medium text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="channel"
                  value="telegram"
                  checked={selectedChannel === 'telegram'}
                  onChange={() => setSelectedChannel('telegram')}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <span>Telegram Direct Forward</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="channel"
                  value="email"
                  checked={selectedChannel === 'email'}
                  onChange={() => setSelectedChannel('email')}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <span>Official Email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="channel"
                  value="in_person"
                  checked={selectedChannel === 'in_person'}
                  onChange={() => setSelectedChannel('in_person')}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <span>In-Person Handover</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Delivery Cover Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Section B Final Lab Submissions Batch 1"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* 2. Submissions Selection */}
      <Card
        title={`2. Select Submissions (${selectedSubIds.length} of ${projectSubmissions.length} selected)`}
        subtitle="Only active submissions in your assigned section can be included in the batch"
        headerAction={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleSelectAll}
            className="text-xs text-slate-600 gap-1.5"
          >
            {selectedSubIds.length === projectSubmissions.length ? (
              <>
                <Square className="w-3.5 h-3.5" />
                <span>Deselect All</span>
              </>
            ) : (
              <>
                <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                <span>Select All</span>
              </>
            )}
          </Button>
        }
      >
        {projectSubmissions.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400 italic">
            No active submissions recorded yet for this project.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {projectSubmissions.map((sub) => {
              const isSelected = selectedSubIds.includes(sub.id);
              const isGroup = sub.submission_type === 'group';
              const file = sub.files?.[0];
              const submitterLabel = isGroup
                ? `${sub.group?.group_code} (Team)`
                : sub.student?.full_name || 'Student';

              return (
                <div
                  key={sub.id}
                  onClick={() => toggleSelect(sub.id)}
                  className={`p-3 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${
                    isSelected ? 'bg-emerald-50/70 border border-emerald-200' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-slate-400">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-700" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-300" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        {isGroup ? <Users className="w-3.5 h-3.5 text-purple-600" /> : <User className="w-3.5 h-3.5 text-blue-600" />}
                        <span>{submitterLabel}</span>
                        <span className="font-mono text-[10px] text-slate-400">v{sub.version}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <FileText className="w-3 h-3 text-slate-400" />
                        <span>{file?.original_filename || 'Document'}</span>
                        <span>({file?.file_size_bytes ? formatFileSize(file.file_size_bytes) : '0 B'})</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-[11px] text-slate-400 font-mono">
                    {formatDateUTC(sub.created_at)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="gap-2 bg-emerald-700 hover:bg-emerald-800"
          isLoading={isLoading}
          disabled={selectedSubIds.length === 0}
        >
          <PackageCheck className="w-4 h-4" />
          <span>Prepare Delivery Package ({selectedSubIds.length})</span>
        </Button>
      </div>
    </form>
  );
}
