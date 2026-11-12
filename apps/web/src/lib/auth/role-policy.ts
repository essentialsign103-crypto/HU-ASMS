// HU-ASMS: Canonical Portal Role Policy Helpers (Shared across Client, Edge, and Server)

export const SYSTEM_OWNER_ROLE = 'system_owner' as const;
export const REPRESENTATIVE_ROLE = 'representative' as const;

export function isSystemOwnerRole(role: string | null | undefined): boolean {
  return role === SYSTEM_OWNER_ROLE;
}

export function isRepresentativeRole(role: string | null | undefined): boolean {
  return role === REPRESENTATIVE_ROLE || isSystemOwnerRole(role);
}

export function resolvePostLoginPath(role: string | null | undefined): '/admin' | '/rep' | null {
  if (isSystemOwnerRole(role)) {
    return '/admin';
  }
  if (role === REPRESENTATIVE_ROLE) {
    return '/rep';
  }
  return null;
}
