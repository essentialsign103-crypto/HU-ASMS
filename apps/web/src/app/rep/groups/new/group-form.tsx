// HU-ASMS: Representative Group Pre-Creation Client Form Component
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectGroup } from '../actions';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { UsersRound, CheckSquare, Square, AlertCircle, Shield } from 'lucide-react';

export function GroupForm({
  sectionId,
  projects,
  students,
}: {
  sectionId: string;
  projects: any[];
  students: any[];
}) {
  const router = useRouter();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [groupCode, setGroupCode] = useState('');
  const [leaderId, setLeaderId] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentProject = projects.find((p) => p.id === selectedProjectId);
  const minSize = currentProject?.file_rules?.min_group_size || 2;
  const maxSize = currentProject?.file_rules?.max_group_size || 5;

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) => {
      const exists = prev.includes(id);
      const updated = exists ? prev.filter((item) => item !== id) : [...prev, id];
      // If leader was unselected, reset leader
      if (exists && leaderId === id) {
        setLeaderId(updated[0] || '');
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupCode.trim()) {
      setErrorMsg('Group Code/Number is required (e.g. "Group 01" or "GRP-01").');
      return;
    }

    if (!leaderId) {
      setErrorMsg('Please designate a group leader among the selected members.');
      return;
    }

    if (selectedMemberIds.length < minSize || selectedMemberIds.length > maxSize) {
      setErrorMsg(`Group must contain between ${minSize} and ${maxSize} members.`);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    const res = await createProjectGroup({
      sectionId,
      projectId: selectedProjectId,
      groupCode: groupCode.trim(),
      leaderStudentId: leaderId,
      memberStudentIds: selectedMemberIds,
    });

    if (!res.success) {
      setErrorMsg(res.error || 'Failed to create group.');
      setIsLoading(false);
    } else {
      router.push('/rep/groups');
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

      <Card title="1. Group Identity & Project Assignment">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Target Academic Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSelectedMemberIds([]);
                setLeaderId('');
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.course?.code})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Required capacity: {minSize} to {maxSize} members per group
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Group Code / Number
            </label>
            <input
              type="text"
              required
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              placeholder="e.g. GRP-01 or Group 1"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Must be unique within this project and section.
            </p>
          </div>
        </div>
      </Card>

      <Card
        title={`2. Assign Section Students (${selectedMemberIds.length} selected)`}
        subtitle={`Select ${minSize} to ${maxSize} students from your section roster.`}
      >
        <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {students.map((s) => {
            const isSelected = selectedMemberIds.includes(s.id);
            const isLeader = leaderId === s.id;

            return (
              <div
                key={s.id}
                className={`p-3 flex items-center justify-between rounded-lg transition-colors ${
                  isSelected ? 'bg-emerald-50/70 border border-emerald-200' : 'hover:bg-slate-50'
                }`}
              >
                <div
                  onClick={() => toggleMember(s.id)}
                  className="flex items-center gap-3 cursor-pointer flex-1"
                >
                  <div className="text-slate-400">
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{s.full_name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">HU ID: {s.hu_student_id}</div>
                  </div>
                </div>

                {isSelected && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setLeaderId(s.id)}
                      className={`text-xs px-2.5 py-1 rounded-md font-semibold transition-colors ${
                        isLeader
                          ? 'bg-purple-700 text-white'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                      }`}
                    >
                      {isLeader ? '★ Designated Leader' : 'Set Leader'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200/60 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Independent Confirmation Lifecycle:</span> Groups are created in <code className="text-amber-700 font-mono font-bold">pending</code> status. All assigned members must independently confirm membership via Telegram before the group becomes verified.
        </div>
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
          disabled={selectedMemberIds.length < minSize || !leaderId}
        >
          <UsersRound className="w-4 h-4" />
          <span>Pre-Create Project Group</span>
        </Button>
      </div>
    </form>
  );
}
