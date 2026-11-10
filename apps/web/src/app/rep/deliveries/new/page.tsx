// HU-ASMS: Prepare New Delivery Package Page
import React from 'react';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';
import { resolveUserSessionContext } from '../../../../lib/auth/roles';
import { DeliveryForm } from './delivery-form';

export default async function NewDeliveryPage({
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

  // Fetch projects targeted to section
  const { data: projects } = await supabase
    .from('projects')
    .select('*, course:courses(*), targets:project_targets(*)')
    .eq('is_active', true)
    .order('deadline', { ascending: true });

  const sectionProjects = (projects || []).filter((p) =>
    p.targets?.some((t: any) => !t.section_id || t.section_id === selectedSectionId)
  );

  // Fetch active submissions for section
  const { data: submissions } = await supabase
    .from('submissions')
    .select('*, files:submission_files(*), student:students(*), group:groups(*)')
    .eq('section_id', selectedSectionId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  // Fetch teachers
  const { data: teachers } = await supabase
    .from('teachers')
    .select('*')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Prepare Teacher Delivery Package</h1>
        <p className="text-sm text-slate-500 mt-1">
          Select verified submissions to assemble a delivery batch for course teachers. Delivery is strictly representative-controlled.
        </p>
      </div>

      <DeliveryForm
        sectionId={selectedSectionId}
        projects={sectionProjects}
        submissions={submissions || []}
        teachers={teachers || []}
      />
    </div>
  );
}
