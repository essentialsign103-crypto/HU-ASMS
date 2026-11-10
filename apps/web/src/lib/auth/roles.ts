// HU-ASMS: Role Resolution & Permission Enforcement
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, RepresentativeAssignment } from '@hu-asms/types';

export interface UserSessionContext {
  userId: string;
  email?: string;
  profile: Profile | null;
  isOwner: boolean;
  isRepresentative: boolean;
  assignments: RepresentativeAssignment[];
}

/**
 * Resolves current user's profile and active representative assignments.
 */
export async function resolveUserSessionContext(
  supabase: SupabaseClient
): Promise<UserSessionContext | null> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();

  if (authErr || !user) {
    return null;
  }

  // 1. Fetch user profile
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !profile || !profile.is_active) {
    return {
      userId: user.id,
      email: user.email,
      profile: null,
      isOwner: false,
      isRepresentative: false,
      assignments: [],
    };
  }

  // 2. If representative or owner, fetch active section assignments
  let assignments: RepresentativeAssignment[] = [];
  const isOwner = profile.role === 'system_owner' || (profile.role as string) === 'owner';
  const isRep = profile.role === 'representative' || isOwner;

  if (isRep) {
    const { data: assigns } = await supabase
      .from('representative_assignments')
      .select('*, section:sections(*, academic_year:academic_years(*))')
      .eq('profile_id', profile.id)
      .eq('is_active', true);

    assignments = assigns || [];
  }

  return {
    userId: user.id,
    email: user.email,
    profile,
    isOwner,
    isRepresentative: isRep,
    assignments,
  };
}

/**
 * Security Guard: Validates that the user is the System Owner.
 */
export function assertSystemOwner(context: UserSessionContext | null): void {
  if (!context || !context.profile || !context.isOwner) {
    throw new Error('Forbidden: System Owner privileges required.');
  }
}

/**
 * Security Guard: Validates that the user is authorized for the given section.
 */
export function assertRepresentativeSectionScope(
  context: UserSessionContext | null,
  sectionId: string
): void {
  if (!context || !context.profile) {
    throw new Error('Unauthorized: Authentication required.');
  }

  // Owner has global access
  if (context.isOwner) {
    return;
  }

  const hasAssignment = context.assignments.some(
    (a) => a.section_id === sectionId && a.is_active
  );

  if (!hasAssignment) {
    throw new Error(`Forbidden: Access denied for section ${sectionId}.`);
  }
}
