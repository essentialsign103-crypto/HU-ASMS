// HU-ASMS: University Structure Management (Departments, Years, Sections)
import React from 'react';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { ensureSystemOwnerPage } from '../../../lib/auth/page-guards';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Building, Calendar, Layers } from 'lucide-react';

export default async function UniversityStructurePage() {
  const supabase = await createServerSupabaseClient();
  await ensureSystemOwnerPage(supabase);

  const [
    { data: departments },
    { data: academicYears },
    { data: sections },
  ] = await Promise.all([
    supabase.from('departments').select('*').order('name', { ascending: true }),
    supabase.from('academic_years').select('*').order('year_level', { ascending: true }),
    supabase.from('sections').select('*, academic_year:academic_years(*)').order('name', { ascending: true }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">University Organizational Structure</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage academic years, sections, and department hierarchy. Zero hardcoding is enforced across all structures.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Departments */}
        <Card
          title="Departments"
          subtitle={`${departments?.length || 0} active departments`}
          headerAction={<Building className="w-4 h-4 text-slate-400" />}
        >
          <div className="space-y-3">
            {departments?.map((dept: any) => (
              <div key={dept.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{dept.name}</div>
                  <div className="text-xs text-slate-500 font-mono">Code: {dept.code}</div>
                </div>
                <Badge variant={dept.is_active ? 'success' : 'neutral'}>
                  {dept.is_active ? 'Active' : 'Archived'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Academic Years */}
        <Card
          title="Academic Years"
          subtitle={`${academicYears?.length || 0} configured academic levels`}
          headerAction={<Calendar className="w-4 h-4 text-slate-400" />}
        >
          <div className="space-y-3">
            {academicYears?.map((year: any) => (
              <div key={year.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{year.name}</div>
                  <div className="text-xs text-slate-500">Year Level {year.year_level}</div>
                </div>
                <Badge variant={year.is_active ? 'success' : 'neutral'}>
                  {year.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Sections */}
        <Card
          title="Academic Sections"
          subtitle={`${sections?.length || 0} partitioned student sections`}
          headerAction={<Layers className="w-4 h-4 text-slate-400" />}
        >
          <div className="space-y-3">
            {sections?.map((sec: any) => (
              <div key={sec.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{sec.name}</div>
                  <div className="text-xs text-slate-500">{sec.academic_year?.name}</div>
                </div>
                <Badge variant={sec.is_active ? 'success' : 'neutral'}>
                  {sec.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
