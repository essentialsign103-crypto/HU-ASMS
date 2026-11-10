// HU-ASMS: Dynamic Academic Directory (Courses & Teachers)
import React from 'react';
import Link from 'next/link';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { BookOpen, UserCheck, ArrowRight } from 'lucide-react';

export default async function AcademicManagementPage() {
  const supabase = await createServerSupabaseClient();

  const [
    { data: courses },
    { data: teachers },
  ] = await Promise.all([
    supabase.from('courses').select('*, department:departments(*)').order('code', { ascending: true }),
    supabase.from('teachers').select('*, department:departments(*)').order('full_name', { ascending: true }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Academic Directory & Teachers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Maintain dynamic courses and delivery recipient teachers for Haramaya University.
          </p>
        </div>
        <Link
          href="/admin/academics/projects"
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold hover:bg-green-800 transition-colors shadow-sm"
        >
          <span>Open Project Studio</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Courses */}
        <Card
          title="Dynamic Courses"
          subtitle={`${courses?.length || 0} registered courses`}
          headerAction={<BookOpen className="w-4 h-4 text-slate-400" />}
        >
          <div className="divide-y divide-slate-100">
            {courses?.map((course: any) => (
              <div key={course.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{course.title}</div>
                  <div className="text-xs text-slate-500">
                    <code className="text-green-700 font-mono font-medium">{course.code}</code> • {course.department?.name || 'Department'}
                  </div>
                </div>
                <Badge variant={course.is_active ? 'success' : 'neutral'}>
                  {course.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Teachers */}
        <Card
          title="Delivery Recipient Teachers"
          subtitle={`${teachers?.length || 0} instructors receiving submission batches`}
          headerAction={<UserCheck className="w-4 h-4 text-slate-400" />}
        >
          <div className="divide-y divide-slate-100">
            {teachers?.map((teacher: any) => (
              <div key={teacher.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{teacher.full_name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {teacher.email} {teacher.phone ? `• ${teacher.phone}` : ''}
                  </div>
                  {teacher.telegram_user_id && (
                    <div className="text-[11px] text-emerald-600 font-mono mt-0.5">
                      Telegram ID: {teacher.telegram_user_id}
                    </div>
                  )}
                </div>
                <Badge variant={teacher.is_active ? 'success' : 'neutral'}>
                  {teacher.is_active ? 'Active Recipient' : 'Inactive'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
