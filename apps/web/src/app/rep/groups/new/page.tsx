// HU-ASMS: Representative In-Browser Group Pre-Creation Page
import React from 'react';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../../lib/auth/roles';
import { GroupForm } from './group-form';

export default async function NewGroupPage({
  searchParams,
}: {
  searchParams: Promise<{ sectionId?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  if (!context || !context.profile) {
    return null;
  }

  const assignedSectionIds = context.assignments.map((a) => a.section_id);
  const selectedSectionId = params.sectionId || assignedSectionIds[0];

  // Fetch projects accepting group submissions targeted to section
  const { data: projects } = await supabase
    .from('projects')
    .select('*, course:courses(*), file_rules:project_file_rules(*), targets:project_targets(*)')
    .eq('is_active', true)
    .in('submission_type', ['group', 'both'])
    .order('deadline', { ascending: true });

  const sectionProjects = (projects || []).filter((p) =>
    p.targets?.some((t: any) => !t.section_id || t.section_id === selectedSectionId)
  );

  // Fetch active, non-suspended students in section
  const { data: students } = await supabase
    .from('students')
    .select('*')
    .eq('section_id', selectedSectionId)
    .neq('registration_status', 'suspended')
    .order('full_name', { ascending: true });

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pre-Create Project Group</h1>
        <p className="text-sm text-slate-500 mt-1">
          Form student project groups for your assigned section. Enforces Phase 08 group capacity and single-group invariants.
        </p>
      </div>

      <GroupForm
        sectionId={selectedSectionId}
        projects={sectionProjects}
        students={students || []}
      />
    </div>
  );
}
