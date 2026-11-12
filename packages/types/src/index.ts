// HU-ASMS: Core TypeScript Type Definitions

export type UserRole = 'system_owner' | 'representative';

export type StudentRegistrationStatus = 'pending' | 'approved' | 'locked' | 'suspended';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export type SubmissionType = 'individual' | 'group' | 'both';

export type GroupStatus = 'pending' | 'verified' | 'submitted' | 'cancelled';

export type MembershipStatus = 'pending' | 'confirmed' | 'declined' | 'removed';

export type SubmissionRecordStatus = 'active' | 'superseded' | 'delivered';

export type DeliveryStatus = 'pending' | 'prepared' | 'sent' | 'failed' | 'acknowledged';

// --- University Hierarchy ---
export interface Department {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcademicYear {
  id: string;
  name: string; // e.g. "2nd Year", "3rd Year"
  year_level: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  academic_year_id: string;
  name: string; // e.g. "Section A", "Section B"
  created_at: string;
  updated_at: string;
  academic_year?: AcademicYear;
}

// --- Profiles & Representative Assignments ---
export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone?: string | null;
  telegram_user_id?: number | null;
  telegram_username?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RepresentativeAssignment {
  id: string;
  profile_id: string;
  section_id: string;
  assigned_by?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  profile?: Profile;
  section?: Section;
}

// --- Student Identity ---
export interface Student {
  id: string;
  hu_student_id: string; // Unique HU ID e.g. "HU/10294/14"
  full_name: string;
  department_id: string;
  academic_year_id: string;
  section_id: string;
  telegram_user_id?: number | null;
  telegram_username?: string | null;
  phone?: string | null;
  registration_status: StudentRegistrationStatus;
  is_locked: boolean;
  suspension_reason?: string | null;
  created_at: string;
  updated_at: string;
  department?: Department;
  academic_year?: AcademicYear;
  section?: Section;
}

export type RegistrationRequestType =
  | 'new_registration'
  | 'roster_claim'
  | 'account_recovery';

export interface RegistrationRequest {
  id: string;
  hu_student_id: string;
  full_name: string;
  department_id: string;
  academic_year_id: string;
  section_id: string;
  telegram_user_id: number;
  telegram_username?: string | null;
  request_type?: RegistrationRequestType;
  target_student_id?: string | null;
  recovery_reason?: string | null;
  status: RequestStatus;
  admin_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentVerificationToken {
  id: string;
  student_id: string;
  token_hash: string;
  purpose: 'roster_claim' | 'account_recovery';
  issued_by?: string | null;
  expires_at: string;
  used_at?: string | null;
  used_by_telegram_id?: number | null;
  created_at: string;
}

export interface IdentityChangeRequest {
  id: string;
  student_id: string;
  reason: string;
  requested_changes: Partial<{
    hu_student_id: string;
    full_name: string;
    department_id: string;
    academic_year_id: string;
    section_id: string;
    phone: string;
  }>;
  status: RequestStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
}

// --- Courses & Teachers ---
export interface Course {
  id: string;
  code: string;
  title: string;
  department_id: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  department?: Department;
}

export interface Teacher {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  telegram_user_id?: number | null;
  department_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- Academic Projects ---
export interface ProjectFileRules {
  id: string;
  project_id: string;
  allowed_extensions: string[];
  allowed_mime_types: string[];
  max_file_size_bytes: number;
  min_group_size: number;
  max_group_size: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectTarget {
  id: string;
  project_id: string;
  academic_year_id: string;
  section_id?: string | null; // NULL applies to all sections in that year
  academic_year?: AcademicYear;
  section?: Section;
}

export interface Project {
  id: string;
  course_id: string;
  teacher_id: string;
  title: string;
  description?: string | null;
  submission_type: SubmissionType;
  opening_date: string;
  deadline: string;
  resubmission_allowed: boolean;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  course?: Course;
  teacher?: Teacher;
  targets?: ProjectTarget[];
  file_rules?: ProjectFileRules;
}

// --- Group Management ---
export interface GroupMember {
  id: string;
  group_id: string;
  student_id: string;
  confirmation_status: MembershipStatus;
  is_group_leader: boolean;
  confirmed_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
}

export interface Group {
  id: string;
  project_id: string;
  section_id: string;
  group_code: string; // e.g. "Group 01"
  group_leader_id?: string | null;
  status: GroupStatus;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  project?: Project;
  section?: Section;
  leader?: Student;
  members?: GroupMember[];
}

// --- Submissions ---
export interface SubmissionFile {
  id: string;
  submission_id: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  checksum_sha256?: string | null;
  telegram_file_id?: string | null;
  created_at: string;
}

export interface SubmissionMember {
  id: string;
  submission_id: string;
  student_id: string;
  hu_student_id: string;
  student_name: string;
  is_submitter: boolean;
  created_at: string;
}

export interface Submission {
  id: string;
  project_id: string;
  section_id: string;
  submission_type: SubmissionType;
  student_id?: string | null;
  group_id?: string | null;
  version: number;
  status: SubmissionRecordStatus;
  submitted_by_telegram_id: number;
  created_at: string;
  updated_at: string;
  project?: Project;
  section?: Section;
  student?: Student;
  group?: Group;
  files?: SubmissionFile[];
  members?: SubmissionMember[];
}

// --- Teacher Delivery ---
export interface DeliveryItem {
  id: string;
  delivery_id: string;
  submission_id: string;
  created_at: string;
  submission?: Submission;
}

export interface Delivery {
  id: string;
  project_id: string;
  section_id: string;
  course_id: string;
  teacher_id: string;
  representative_id: string;
  batch_count: number;
  status: DeliveryStatus;
  channel: string;
  delivery_notes?: string | null;
  failure_reason?: string | null;
  prepared_at?: string | null;
  sent_at?: string | null;
  acknowledged_at?: string | null;
  created_at: string;
  updated_at: string;
  project?: Project;
  course?: Course;
  teacher?: Teacher;
  representative?: Profile;
  items?: DeliveryItem[];
}

// --- Audit & Notifications ---
export interface AuditLog {
  id: string;
  actor_id?: string | null;
  actor_telegram_id?: number | null;
  actor_role?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_telegram_id: number;
  recipient_type: 'student' | 'representative' | 'owner';
  message: string;
  payload?: Record<string, unknown>;
  status: 'pending' | 'sent' | 'failed';
  retry_count: number;
  sent_at?: string | null;
  error_message?: string | null;
  created_at: string;
}

// --- Bot Interaction Types ---
export interface BotSessionData {
  step?: string;
  tempRegistration?: Partial<RegistrationRequest>;
  selectedProjectId?: string;
  selectedGroupId?: string;
}
