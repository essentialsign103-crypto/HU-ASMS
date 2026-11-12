// HU-ASMS: Fail-Closed Edge Route Guard Decision Engine
import { isRepresentativeRole, isSystemOwnerRole } from './role-policy';

export interface RouteGuardInput {
  pathname: string;
  method: string;
  hasNextActionHeader?: boolean;
  hasSupabaseConfig: boolean;
  userId?: string | null;
  authError?: boolean;
  profile?: { role?: string | null; is_active?: boolean | null } | null;
  profileError?: boolean;
}

export type MiddlewareDecision =
  | { action: 'allow' }
  | { action: 'redirect'; pathname: string; error?: string; redirectTo?: string }
  | { action: 'deny'; status: 401 | 403 | 503; error: string };

function isMutationOrActionRequest(method: string, hasNextActionHeader?: boolean): boolean {
  const upperMethod = method.toUpperCase();
  return Boolean(hasNextActionHeader) || (upperMethod !== 'GET' && upperMethod !== 'HEAD');
}

/**
 * Evaluates protected /admin and /rep route requests using fail-closed defaults.
 */
export function evaluateRouteGuard(input: RouteGuardInput): MiddlewareDecision {
  const isAdminRoute = input.pathname.startsWith('/admin');
  const isRepRoute = input.pathname.startsWith('/rep');

  if (!isAdminRoute && !isRepRoute) {
    return { action: 'allow' };
  }

  // Fail closed when required authentication configuration is absent.
  if (!input.hasSupabaseConfig) {
    return {
      action: 'deny',
      status: 503,
      error: 'Authentication service is not configured.',
    };
  }

  const isMutation = isMutationOrActionRequest(input.method, input.hasNextActionHeader);

  if (input.authError || !input.userId) {
    if (isMutation) {
      return {
        action: 'deny',
        status: 401,
        error: 'Authentication required.',
      };
    }
    return {
      action: 'redirect',
      pathname: '/login',
      redirectTo: input.pathname,
    };
  }

  if (input.profileError) {
    if (isMutation) {
      return {
        action: 'deny',
        status: 503,
        error: 'Unable to verify authorization profile.',
      };
    }
    return {
      action: 'redirect',
      pathname: '/login',
      error: 'auth_verification_failed',
    };
  }

  if (!input.profile || input.profile.is_active !== true) {
    if (isMutation) {
      return {
        action: 'deny',
        status: 403,
        error: 'Inactive or missing staff profile.',
      };
    }
    return {
      action: 'redirect',
      pathname: '/login',
      error: 'inactive_account',
    };
  }

  const isOwner = isSystemOwnerRole(input.profile.role);
  const isRep = isRepresentativeRole(input.profile.role);

  if (isAdminRoute && !isOwner) {
    if (isMutation) {
      return {
        action: 'deny',
        status: 403,
        error: 'Forbidden: System Owner privileges required.',
      };
    }
    if (isRep) {
      return {
        action: 'redirect',
        pathname: '/rep',
      };
    }
    return {
      action: 'redirect',
      pathname: '/login',
      error: 'unauthorized_role',
    };
  }

  if (isRepRoute && !isRep) {
    if (isMutation) {
      return {
        action: 'deny',
        status: 403,
        error: 'Forbidden: Representative privileges required.',
      };
    }
    return {
      action: 'redirect',
      pathname: '/login',
      error: 'unauthorized_role',
    };
  }

  return { action: 'allow' };
}
