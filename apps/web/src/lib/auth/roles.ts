// HU-ASMS: Role Resolution & Permission Enforcement
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, RepresentativeAssignment } from '@hu-asms/types';
import { isValidUuid } from '@hu-asms/validation';
import {
  isSystemOwnerRole,
  isRepresentativeRole,
  resolvePostLoginPath,
  SYSTEM_OWNER_ROLE,
  REPRESENTATIVE_ROLE,
} from './role-policy';

export {
  isSystemOwnerRole,
  isRepresentativeRole,
  resolvePostLoginPath,
  SYSTEM_OWNER_ROLE,
  REPRESENTATIVE_ROLE,
};

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
  const isOwner = isSystemOwnerRole(profile.role);
  const isRep = isRepresentativeRole(profile.role);

  if (isRep) {
    const { data: assigns, error: assignErr } = await supabase
      .from('representative_assignments')
      .select('*, section:sections(*, academic_year:academic_years(*))')
      .eq('profile_id', profile.id)
      .eq('is_active', true);

    assignments = !assignErr && assigns ? assigns : [];
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

export type AuthorizedSessionContext = UserSessionContext & {
  profile: NonNullable<UserSessionContext['profile']>;
};

/**
 * Resolves the session and enforces active System Owner authorization.
 */
export async function requireSystemOwnerContext(
  supabase: SupabaseClient
): Promise<UserSessionContext> {
  const context = await resolveUserSessionContext(supabase);
  assertSystemOwner(context);
  return context as UserSessionContext;
}

/**
 * Resolves the session and enforces an active Section Representative (or System Owner) account.
 */
export async function requireRepresentativeContext(
  supabase: SupabaseClient
): Promise<AuthorizedSessionContext> {
  const context = await resolveUserSessionContext(supabase);
  if (
    !context ||
    !context.profile ||
    context.profile.is_active !== true ||
    !context.isRepresentative ||
    !isRepresentativeRole(context.profile.role)
  ) {
    throw new Error('Unauthorized: Active Representative session required.');
  }
  return context as AuthorizedSessionContext;
}

/**
 * Extracts unique active assigned section IDs for an authorized representative session.
 */
export function getActiveAssignedSectionIds(
  context: AuthorizedSessionContext | UserSessionContext | null
): string[] {
  if (
    !context ||
    !context.profile ||
    context.profile.is_active !== true ||
    !context.isRepresentative ||
    !isRepresentativeRole(context.profile.role)
  ) {
    return [];
  }
  const ids = context.assignments
    .filter(
      (assignment) =>
        !('is_active' in assignment) ||
        (assignment as { is_active?: boolean }).is_active !== false
    )
    .map((assignment) => assignment.section_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return Array.from(new Set(ids));
}

/**
 * Security Guard: Validates that the user is an active System Owner.
 */
export function assertSystemOwner(context: UserSessionContext | null): void {
  if (
    !context ||
    !context.profile ||
    context.profile.is_active !== true ||
    !context.isOwner ||
    !isSystemOwnerRole(context.profile.role)
  ) {
    throw new Error('Forbidden: System Owner privileges required.');
  }
}

/**
 * Security Guard: Validates that the user has an active staff profile authorized for the given section.
 */
export function assertRepresentativeSectionScope(
  context: UserSessionContext | null,
  sectionId: string
): void {
  if (!context || !context.profile) {
    throw new Error('Unauthorized: Authentication required.');
  }

  if (context.profile.is_active !== true) {
    throw new Error('Forbidden: Active staff profile required.');
  }

  // Verified System Owner has global access
  if (context.isOwner && isSystemOwnerRole(context.profile.role)) {
    return;
  }

  if (!context.isRepresentative || !isRepresentativeRole(context.profile.role)) {
    throw new Error('Forbidden: Representative privileges required.');
  }

  const hasAssignment = context.assignments.some(
    (a) => a.section_id === sectionId && a.is_active === true
  );

  if (!hasAssignment) {
    throw new Error(`Forbidden: Access denied for section ${sectionId}.`);
  }
}

export type SectionScopeResolution =
  | { authorized: true; sectionId: string }
  | { authorized: false; status: 400 | 401 | 403; error: string };

/**
 * Validates an optional sectionId route parameter and enforces active representative section scope.
 */
export function resolveAuthorizedSectionScope(
  context: UserSessionContext | null,
  requestedSectionId?: string | null
): SectionScopeResolution {
  if (!context || !context.profile) {
    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Active staff authentication required.',
    };
  }

  if (context.profile.is_active !== true) {
    return {
      authorized: false,
      status: 403,
      error: 'Forbidden: Active staff profile required.',
    };
  }

  const isVerifiedOwner = context.isOwner && isSystemOwnerRole(context.profile.role);
  const isVerifiedRep =
    context.isRepresentative && isRepresentativeRole(context.profile.role);

  if (!isVerifiedOwner && !isVerifiedRep) {
    return {
      authorized: false,
      status: 403,
      error: 'Forbidden: Representative privileges required.',
    };
  }

  if (requestedSectionId !== undefined && requestedSectionId !== null) {
    const trimmed = requestedSectionId.trim();
    if (!isValidUuid(trimmed)) {
      return {
        authorized: false,
        status: 400,
        error: 'Invalid section identifier.',
      };
    }

    try {
      assertRepresentativeSectionScope(context, trimmed);
      return { authorized: true, sectionId: trimmed };
    } catch (err) {
      return {
        authorized: false,
        status: 403,
        error: err instanceof Error ? err.message : 'Forbidden: Section access denied.',
      };
    }
  }

  const defaultSectionId = context.assignments.find((a) => a.is_active)?.section_id;
  if (!defaultSectionId) {
    return {
      authorized: false,
      status: 403,
      error: isVerifiedOwner
        ? 'No section selected. Specify a valid sectionId parameter.'
        : 'Forbidden: No active section assignment is configured for your account.',
    };
  }

  if (!isValidUuid(defaultSectionId)) {
    return {
      authorized: false,
      status: 400,
      error: 'Invalid assigned section identifier.',
    };
  }

  try {
    assertRepresentativeSectionScope(context, defaultSectionId);
    return { authorized: true, sectionId: defaultSectionId };
  } catch (err) {
    return {
      authorized: false,
      status: 403,
      error: err instanceof Error ? err.message : 'Forbidden: Section access denied.',
    };
  }
}
