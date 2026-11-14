'use client';

// HU-ASMS: Representative Assignment Form with Academic Scope Cascading
import React, { useState, useMemo } from 'react';
import { Button } from '../../../components/ui/button';
import { Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { assignRepresentativeAction } from './actions';

interface Section {
  id: string;
  name: string;
  academic_year_id?: string;
  academic_year?: any;
}

interface Student {
  id: string;
  full_name: string;
  hu_student_id: string;
  telegram_user_id?: number | null;
  section_id?: string | null;
  department?: any;
  section?: any;
}

interface RepresentativeAssignFormProps {
  eligibleStudents: any[];
  sections: any[];
}

export function RepresentativeAssignForm({ eligibleStudents, sections }: RepresentativeAssignFormProps) {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [filterYearId, setFilterYearId] = useState<string>('all');

  // Extract unique academic years from sections
  const academicYears = useMemo(() => {
    const map = new Map<string, string>();
    for (const sec of sections) {
      const yr = Array.isArray(sec.academic_year) ? sec.academic_year[0] : sec.academic_year;
      if (yr?.id && yr?.name) {
        map.set(yr.id, yr.name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [sections]);

  // Selected student object
  const selectedStudent = useMemo(() => {
    return eligibleStudents.find((s) => s.id === selectedStudentId);
  }, [eligibleStudents, selectedStudentId]);

  // When student is selected, auto-cascade section to their exact enrolled section
  const handleStudentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStudentId = e.target.value;
    setSelectedStudentId(newStudentId);

    const stud = eligibleStudents.find((s) => s.id === newStudentId);
    if (stud?.section_id) {
      setSelectedSectionId(stud.section_id);
    } else {
      setSelectedSectionId('');
    }
  };

  // Filtered sections: cascaded by academic year or student scope
  const visibleSections = useMemo(() => {
    if (filterYearId !== 'all') {
      return sections.filter((s) => s.academic_year_id === filterYearId);
    }
    return sections;
  }, [sections, filterYearId]);

  // Filtered students by academic year if selected
  const visibleStudents = useMemo(() => {
    if (filterYearId === 'all') return eligibleStudents;
    return eligibleStudents.filter((s) => {
      const sec = sections.find((sec) => sec.id === s.section_id);
      return sec?.academic_year_id === filterYearId;
    });
  }, [eligibleStudents, sections, filterYearId]);

  const isScopeMismatch = Boolean(
    selectedStudent &&
      selectedStudent.section_id &&
      selectedSectionId &&
      selectedStudent.section_id !== selectedSectionId
  );

  const hasNoSection = Boolean(selectedStudent && !selectedStudent.section_id);

  return (
    <form action={assignRepresentativeAction} className="space-y-4">
      {/* Scope Cascading Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="text-xs text-slate-600 font-medium">
          Scope Filter: <span className="text-slate-400">Cascades student and section selectors</span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">Academic Year:</label>
          <select
            value={filterYearId}
            onChange={(e) => {
              setFilterYearId(e.target.value);
              setSelectedStudentId('');
              setSelectedSectionId('');
            }}
            className="text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800"
          >
            <option value="all">All Academic Years</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Student Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Eligible Approved Student
          </label>
          <select
            name="studentId"
            required
            value={selectedStudentId}
            onChange={handleStudentChange}
            className="w-full text-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">-- Select Approved Student ({visibleStudents.length} available) --</option>
            {visibleStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({s.hu_student_id}) — {s.section?.academic_year?.name || 'No Year'} ({s.section?.name || 'No Section'})
              </option>
            ))}
          </select>

          {selectedStudent && (
            <div className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5">
              <span>Enrolled Section:</span>
              <strong className={selectedStudent.section_id ? 'text-emerald-700' : 'text-amber-700'}>
                {selectedStudent.section?.name || 'Unassigned (NULL)'}
              </strong>
            </div>
          )}
        </div>

        {/* 2. Cascaded Section Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Academic Section Scope (Enforced Same-Section)
          </label>
          <select
            name="sectionId"
            required
            value={selectedSectionId}
            onChange={(e) => setSelectedSectionId(e.target.value)}
            className={`w-full text-xs rounded-lg border bg-white px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 ${
              isScopeMismatch
                ? 'border-red-400 focus:ring-red-500'
                : 'border-slate-300 focus:ring-emerald-500'
            }`}
          >
            <option value="">-- Select Target Section --</option>
            {visibleSections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.academic_year?.name} — {sec.name}
              </option>
            ))}
          </select>

          {isScopeMismatch && (
            <div className="mt-1.5 p-2 rounded bg-red-50 border border-red-200 text-[11px] text-red-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Scope Mismatch: Selected section does not match student enrolled section.</span>
            </div>
          )}

          {hasNoSection && (
            <div className="mt-1.5 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Warning: Student has no assigned section (NULL). Assignment will fail closed.</span>
            </div>
          )}

          {selectedStudent && selectedStudent.section_id && !isScopeMismatch && (
            <div className="mt-1.5 text-[11px] text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Scope matched: Student enrolled in {selectedStudent.section?.name}.</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isScopeMismatch || hasNoSection || !selectedStudentId || !selectedSectionId}
          className="gap-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Assign &amp; Activate Representative</span>
        </Button>
      </div>
    </form>
  );
}
