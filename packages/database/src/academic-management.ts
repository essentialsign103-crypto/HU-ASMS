// HU-ASMS: Academic Management Service (Phase 06)
// Handles Courses, Teachers, Dynamic Projects, Multi-Scope Targeting, and File Rules

import { SupabaseClient } from '@supabase/supabase-js';
import { SYSTEM_CONSTANTS } from '@hu-asms/shared';
import type {
  Course,
  Teacher,
  Project,
  ProjectTarget,
  ProjectFileRules,
  SubmissionType,
} from '@hu-asms/types';

export interface CreateCourseDTO {
  code: string;
  title: string;
  department_id: string;
  description?: string;
  is_active?: boolean;
}

export interface CreateTeacherDTO {
  full_name: string;
  email?: string;
  phone?: string;
  telegram_user_id?: number;
  department_id?: string;
  is_active?: boolean;
}

export interface CreateProjectDTO {
  course_id: string;
  teacher_id: string;
  title: string;
  description?: string;
  submission_type: SubmissionType;
  opening_date: string; // ISO string
  deadline: string; // ISO string
  resubmission_allowed?: boolean;
  is_active?: boolean;
  created_by?: string;
  targets: Array<{
    academic_year_id: string;
    section_id?: string | null; // null applies to all sections in that academic year
  }>;
  file_rules: {
    allowed_extensions: string[];
    allowed_mime_types?: string[];
    max_file_size_bytes?: number;
    min_group_size?: number;
    max_group_size?: number;
  };
}

export interface ProjectWithDetails extends Project {
  course: Course;
  teacher: Teacher;
  targets: ProjectTarget[];
  file_rules: ProjectFileRules;
}

export class AcademicManagementService {
  constructor(private client: SupabaseClient) {}

  // ===========================================================================
  // 1. COURSE MANAGEMENT
  // ===========================================================================

  async listCourses(departmentId?: string): Promise<Course[]> {
    let query = this.client
      .from('courses')
      .select('*, department:departments(*)')
      .order('code', { ascending: true });

    if (departmentId) {
      query = query.eq('department_id', departmentId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getCourseById(id: string): Promise<Course | null> {
    const { data, error } = await this.client
      .from('courses')
      .select('*, department:departments(*)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async createCourse(dto: CreateCourseDTO): Promise<Course> {
    const code = dto.code.trim().toUpperCase();
    const title = dto.title.trim();

    if (!code || !title) {
      throw new Error('Course code and title are required.');
    }
    if (!dto.department_id) {
      throw new Error('Associated department is required for course.');
    }

    const { data, error } = await this.client
      .from('courses')
      .insert({
        code,
        title,
        department_id: dto.department_id,
        description: dto.description?.trim() || null,
        is_active: dto.is_active ?? true,
      })
      .select('*, department:departments(*)')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A course with code "${code}" already exists.`);
      }
      throw error;
    }
    return data;
  }

  async updateCourse(id: string, dto: Partial<CreateCourseDTO>): Promise<Course> {
    const updates: Record<string, unknown> = {};
    if (dto.code !== undefined) updates.code = dto.code.trim().toUpperCase();
    if (dto.title !== undefined) updates.title = dto.title.trim();
    if (dto.department_id !== undefined) updates.department_id = dto.department_id;
    if (dto.description !== undefined) updates.description = dto.description.trim() || null;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    const { data, error } = await this.client
      .from('courses')
      .update(updates)
      .eq('id', id)
      .select('*, department:departments(*)')
      .single();

    if (error) throw error;
    return data;
  }

  // ===========================================================================
  // 2. TEACHER MANAGEMENT
  // ===========================================================================

  async listTeachers(departmentId?: string): Promise<Teacher[]> {
    let query = this.client
      .from('teachers')
      .select('*')
      .order('full_name', { ascending: true });

    if (departmentId) {
      query = query.eq('department_id', departmentId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getTeacherById(id: string): Promise<Teacher | null> {
    const { data, error } = await this.client
      .from('teachers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async createTeacher(dto: CreateTeacherDTO): Promise<Teacher> {
    const fullName = dto.full_name.trim();
    if (!fullName || fullName.length < 3) {
      throw new Error('Teacher full name must be at least 3 characters long.');
    }

    const { data, error } = await this.client
      .from('teachers')
      .insert({
        full_name: fullName,
        email: dto.email?.trim() || null,
        phone: dto.phone?.trim() || null,
        telegram_user_id: dto.telegram_user_id || null,
        department_id: dto.department_id || null,
        is_active: dto.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateTeacher(id: string, dto: Partial<CreateTeacherDTO>): Promise<Teacher> {
    const updates: Record<string, unknown> = {};
    if (dto.full_name !== undefined) updates.full_name = dto.full_name.trim();
    if (dto.email !== undefined) updates.email = dto.email.trim() || null;
    if (dto.phone !== undefined) updates.phone = dto.phone.trim() || null;
    if (dto.telegram_user_id !== undefined) updates.telegram_user_id = dto.telegram_user_id || null;
    if (dto.department_id !== undefined) updates.department_id = dto.department_id || null;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    const { data, error } = await this.client
      .from('teachers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // ===========================================================================
  // 3. DYNAMIC PROJECT CREATION & TARGETING
  // ===========================================================================

  /**
   * Creates a project atomically:
   * 1. Validates dates and group sizes.
   * 2. Inserts project record.
   * 3. Inserts project targets (multi-year & multi-section).
   * 4. Inserts project file rules.
   */
  async createProject(dto: CreateProjectDTO): Promise<ProjectWithDetails> {
    const title = dto.title.trim();
    if (!title) {
      throw new Error('Project title is required.');
    }

    const openingDate = new Date(dto.opening_date);
    const deadline = new Date(dto.deadline);

    if (isNaN(openingDate.getTime()) || isNaN(deadline.getTime())) {
      throw new Error('Invalid project opening date or deadline format.');
    }
    if (deadline <= openingDate) {
      throw new Error('Project deadline must be set after opening date.');
    }

    if (!dto.targets || dto.targets.length === 0) {
      throw new Error('Project must be targeted to at least one academic year or section.');
    }

    const minGroup = dto.file_rules.min_group_size ?? 1;
    const maxGroup = dto.file_rules.max_group_size ?? (dto.submission_type === 'individual' ? 1 : 10);
    if (minGroup > maxGroup) {
      throw new Error(`Minimum group size (${minGroup}) cannot exceed maximum group size (${maxGroup}).`);
    }

    const requestedMaxFileBytes =
      dto.file_rules.max_file_size_bytes ?? SYSTEM_CONSTANTS.DEFAULT_MAX_FILE_SIZE_BYTES;
    if (!Number.isFinite(requestedMaxFileBytes) || requestedMaxFileBytes <= 0) {
      throw new Error('Project maximum file size must be greater than 0 bytes.');
    }
    if (requestedMaxFileBytes > SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `Project maximum file size cannot exceed 20 MB (${SYSTEM_CONSTANTS.TELEGRAM_BOT_API_MAX_DOWNLOAD_BYTES} bytes), the Telegram Cloud Bot API download limit.`
      );
    }

    // 1. Insert Project master record
    const { data: project, error: projErr } = await this.client
      .from('projects')
      .insert({
        course_id: dto.course_id,
        teacher_id: dto.teacher_id,
        title,
        description: dto.description?.trim() || null,
        submission_type: dto.submission_type,
        opening_date: openingDate.toISOString(),
        deadline: deadline.toISOString(),
        resubmission_allowed: dto.resubmission_allowed ?? true,
        is_active: dto.is_active ?? true,
        created_by: dto.created_by || null,
      })
      .select('*, course:courses(*), teacher:teachers(*)')
      .single();

    if (projErr) throw projErr;

    // 2. Insert Project Targets
    const targetPayloads = dto.targets.map((t) => ({
      project_id: project.id,
      academic_year_id: t.academic_year_id,
      section_id: t.section_id || null,
    }));

    const { data: targets, error: targetErr } = await this.client
      .from('project_targets')
      .insert(targetPayloads)
      .select('*, academic_year:academic_years(*), section:sections(*)');

    if (targetErr) {
      // Rollback project if target insertion fails
      await this.client.from('projects').delete().eq('id', project.id);
      throw targetErr;
    }

    // 3. Insert Project File Rules
    const allowedExtensions = dto.file_rules.allowed_extensions.map((e) =>
      e.toLowerCase().replace('.', '')
    );
    const allowedMimes =
      dto.file_rules.allowed_mime_types && dto.file_rules.allowed_mime_types.length > 0
        ? dto.file_rules.allowed_mime_types
        : ['application/pdf'];

    const { data: fileRules, error: fileErr } = await this.client
      .from('project_file_rules')
      .insert({
        project_id: project.id,
        allowed_extensions: allowedExtensions,
        allowed_mime_types: allowedMimes,
        max_file_size_bytes: requestedMaxFileBytes,
        min_group_size: minGroup,
        max_group_size: maxGroup,
      })
      .select()
      .single();

    if (fileErr) {
      await this.client.from('projects').delete().eq('id', project.id);
      throw fileErr;
    }

    return {
      ...project,
      targets: targets || [],
      file_rules: fileRules,
    };
  }

  async getProjectDetails(projectId: string): Promise<ProjectWithDetails | null> {
    const { data, error } = await this.client
      .from('projects')
      .select(`
        *,
        course:courses(*),
        teacher:teachers(*),
        targets:project_targets(*, academic_year:academic_years(*), section:sections(*)),
        file_rules:project_file_rules(*)
      `)
      .eq('id', projectId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Resolves whether a project is open and eligible for a specific section & academic year
   */
  async isProjectEligibleForScope(
    projectId: string,
    academicYearId: string,
    sectionId: string
  ): Promise<boolean> {
    const now = new Date().toISOString();

    const { data: project, error } = await this.client
      .from('projects')
      .select(`
        id,
        is_active,
        opening_date,
        deadline,
        targets:project_targets!inner(*)
      `)
      .eq('id', projectId)
      .eq('is_active', true)
      .lte('opening_date', now)
      .gte('deadline', now)
      .or(`academic_year_id.eq.${academicYearId}`, { foreignTable: 'targets' })
      .or(`section_id.is.null,section_id.eq.${sectionId}`, { foreignTable: 'targets' })
      .maybeSingle();

    if (error || !project) return false;
    return true;
  }
}
