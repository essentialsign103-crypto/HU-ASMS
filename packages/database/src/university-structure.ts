// HU-ASMS: University Structure Service (Phase 03)
// Handles Academic Years, Sections, Departments, Student Roster, and Representative Assignments

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Department,
  AcademicYear,
  Section,
  Student,
  RepresentativeAssignment,
} from '@hu-asms/types';
import { sanitizeHuStudentId, isValidHuStudentId } from '@hu-asms/validation';

export interface CreateDepartmentDTO {
  code: string;
  name: string;
  description?: string;
}

export interface CreateAcademicYearDTO {
  name: string;
  year_level: number;
  is_active?: boolean;
}

export interface CreateSectionDTO {
  academic_year_id: string;
  name: string;
}

export interface AddStudentToRosterDTO {
  hu_student_id: string;
  full_name: string;
  department_id: string;
  academic_year_id: string;
  section_id: string;
  phone?: string;
}

export interface AssignRepresentativeDTO {
  profile_id: string;
  section_id: string;
  assigned_by?: string;
}

export interface AcademicYearHierarchy extends AcademicYear {
  sections: Array<Section & {
    assigned_representatives: RepresentativeAssignment[];
    student_count?: number;
  }>;
}

export class UniversityStructureService {
  constructor(private client: SupabaseClient) {}

  // ===========================================================================
  // 1. DEPARTMENT MANAGEMENT
  // ===========================================================================

  async listDepartments(): Promise<Department[]> {
    const { data, error } = await this.client
      .from('departments')
      .select('*')
      .order('code', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async getDepartmentById(id: string): Promise<Department | null> {
    const { data, error } = await this.client
      .from('departments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async createDepartment(dto: CreateDepartmentDTO): Promise<Department> {
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();

    if (!code || !name) {
      throw new Error('Department code and name are required.');
    }

    const { data, error } = await this.client
      .from('departments')
      .insert({
        code,
        name,
        description: dto.description?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateDepartment(
    id: string,
    dto: Partial<CreateDepartmentDTO>
  ): Promise<Department> {
    const updates: Record<string, unknown> = {};
    if (dto.code !== undefined) updates.code = dto.code.trim().toUpperCase();
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.description !== undefined) updates.description = dto.description.trim() || null;

    const { data, error } = await this.client
      .from('departments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ===========================================================================
  // 2. ACADEMIC YEAR MANAGEMENT
  // ===========================================================================

  async listAcademicYears(onlyActive = false): Promise<AcademicYear[]> {
    let query = this.client
      .from('academic_years')
      .select('*')
      .order('year_level', { ascending: true });

    if (onlyActive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async createAcademicYear(dto: CreateAcademicYearDTO): Promise<AcademicYear> {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new Error('Academic year name is required (e.g., "2nd Year").');
    }
    if (!dto.year_level || dto.year_level <= 0) {
      throw new Error('Year level must be a positive integer.');
    }

    const { data, error } = await this.client
      .from('academic_years')
      .insert({
        name: dto.name.trim(),
        year_level: dto.year_level,
        is_active: dto.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async setAcademicYearStatus(id: string, isActive: boolean): Promise<AcademicYear> {
    const { data, error } = await this.client
      .from('academic_years')
      .update({ is_active: isActive })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ===========================================================================
  // 3. SECTION MANAGEMENT
  // ===========================================================================

  async listSectionsByYear(academicYearId: string): Promise<Section[]> {
    const { data, error } = await this.client
      .from('sections')
      .select('*, academic_year:academic_years(*)')
      .eq('academic_year_id', academicYearId)
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async createSection(dto: CreateSectionDTO): Promise<Section> {
    const name = dto.name.trim();
    if (!name) {
      throw new Error('Section name is required (e.g., "Section A").');
    }

    // Verify academic year exists
    const { data: year, error: yearErr } = await this.client
      .from('academic_years')
      .select('id')
      .eq('id', dto.academic_year_id)
      .maybeSingle();

    if (yearErr || !year) {
      throw new Error(`Academic year with ID "${dto.academic_year_id}" not found.`);
    }

    const { data, error } = await this.client
      .from('sections')
      .insert({
        academic_year_id: dto.academic_year_id,
        name,
      })
      .select('*, academic_year:academic_years(*)')
      .single();

    if (error) throw error;
    return data;
  }

  async getAcademicHierarchy(): Promise<AcademicYearHierarchy[]> {
    const { data, error } = await this.client
      .from('academic_years')
      .select(`
        *,
        sections:sections(
          *,
          assigned_representatives:representative_assignments(
            *,
            profile:profiles(*)
          )
        )
      `)
      .order('year_level', { ascending: true });

    if (error) throw error;
    return (data as AcademicYearHierarchy[]) || [];
  }

  // ===========================================================================
  // 4. STUDENT ROSTER MANAGEMENT
  // ===========================================================================

  async addStudentToRoster(dto: AddStudentToRosterDTO): Promise<Student> {
    const sanitizedHuId = sanitizeHuStudentId(dto.hu_student_id);

    if (!isValidHuStudentId(sanitizedHuId)) {
      throw new Error(`Invalid Haramaya University Student ID format: "${dto.hu_student_id}".`);
    }

    if (!dto.full_name || dto.full_name.trim().length < 3) {
      throw new Error('Full name must be at least 3 characters long.');
    }

    const { data, error } = await this.client
      .from('students')
      .insert({
        hu_student_id: sanitizedHuId,
        full_name: dto.full_name.trim(),
        department_id: dto.department_id,
        academic_year_id: dto.academic_year_id,
        section_id: dto.section_id,
        phone: dto.phone?.trim() || null,
        registration_status: 'approved',
        is_locked: true,
      })
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .single();

    if (error) throw error;
    return data;
  }

  async bulkImportRoster(students: AddStudentToRosterDTO[]): Promise<{
    importedCount: number;
    errors: Array<{ hu_student_id: string; error: string }>;
  }> {
    const errors: Array<{ hu_student_id: string; error: string }> = [];
    let importedCount = 0;

    for (const s of students) {
      try {
        await this.addStudentToRoster(s);
        importedCount++;
      } catch (err: unknown) {
        errors.push({
          hu_student_id: s.hu_student_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { importedCount, errors };
  }

  async updateStudentAcademicAssignment(
    studentId: string,
    newAssignment: {
      academic_year_id: string;
      section_id: string;
      department_id?: string;
    },
    reason: string,
    changedByProfileId?: string
  ): Promise<Student> {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A detailed reason is required to reassign a student.');
    }

    // 1. Fetch current student record
    const { data: currentStudent, error: fetchErr } = await this.client
      .from('students')
      .select('*')
      .eq('id', studentId)
      .single();

    if (fetchErr || !currentStudent) {
      throw new Error(`Student record not found.`);
    }

    const oldValues = {
      department_id: currentStudent.department_id,
      academic_year_id: currentStudent.academic_year_id,
      section_id: currentStudent.section_id,
    };

    const newValues = {
      department_id: newAssignment.department_id || currentStudent.department_id,
      academic_year_id: newAssignment.academic_year_id,
      section_id: newAssignment.section_id,
    };

    // 2. Update student assignment
    const { data: updatedStudent, error: updateErr } = await this.client
      .from('students')
      .update(newValues)
      .eq('id', studentId)
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .single();

    if (updateErr) throw updateErr;

    // 3. Record audit history in identity_change_history
    await this.client.from('identity_change_history').insert({
      student_id: studentId,
      changed_by: changedByProfileId || null,
      old_values: oldValues,
      new_values: newValues,
      reason,
    });

    return updatedStudent;
  }

  async listStudentsBySection(sectionId: string): Promise<Student[]> {
    const { data, error } = await this.client
      .from('students')
      .select('*, department:departments(*), academic_year:academic_years(*), section:sections(*)')
      .eq('section_id', sectionId)
      .order('full_name', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // ===========================================================================
  // 5. REPRESENTATIVE ASSIGNMENT MANAGEMENT
  // ===========================================================================

  async assignRepresentative(dto: AssignRepresentativeDTO): Promise<RepresentativeAssignment> {
    // 1. Verify profile exists and is active
    const { data: profile, error: profErr } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', dto.profile_id)
      .maybeSingle();

    if (profErr || !profile) {
      throw new Error(`Profile with ID "${dto.profile_id}" not found.`);
    }

    // 2. Insert or reactivate assignment
    const { data, error } = await this.client
      .from('representative_assignments')
      .upsert(
        {
          profile_id: dto.profile_id,
          section_id: dto.section_id,
          assigned_by: dto.assigned_by || null,
          is_active: true,
        },
        { onConflict: 'profile_id,section_id' }
      )
      .select('*, profile:profiles(*), section:sections(*)')
      .single();

    if (error) throw error;
    return data;
  }

  async deactivateRepresentative(assignmentId: string): Promise<void> {
    const { error } = await this.client
      .from('representative_assignments')
      .update({ is_active: false })
      .eq('id', assignmentId);

    if (error) throw error;
  }

  async listAssignmentsForProfile(profileId: string): Promise<RepresentativeAssignment[]> {
    const { data, error } = await this.client
      .from('representative_assignments')
      .select('*, section:sections(*, academic_year:academic_years(*))')
      .eq('profile_id', profileId)
      .eq('is_active', true);

    if (error) throw error;
    return data || [];
  }

  /**
   * Strictly verifies whether a Telegram user is authorized as representative
   * for a specific section.
   */
  async verifyRepresentativeScope(
    telegramUserId: number,
    sectionId: string
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from('representative_assignments')
      .select('id, profile:profiles!inner(telegram_user_id, is_active)')
      .eq('section_id', sectionId)
      .eq('is_active', true)
      .eq('profile.telegram_user_id', telegramUserId)
      .eq('profile.is_active', true)
      .maybeSingle();

    if (error) {
      return false;
    }

    return !!data;
  }
}
