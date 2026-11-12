// HU-ASMS: Server Page Authorization Helpers (Defense-in-Depth beyond Edge Middleware)
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  requireRepresentativeContext,
  requireSystemOwnerContext,
  type AuthorizedSessionContext,
  type UserSessionContext,
} from './roles';

/**
 * Ensures the current Server Component request has an active System Owner session.
 */
export async function ensureSystemOwnerPage(
  supabase: SupabaseClient
): Promise<UserSessionContext> {
  try {
    return await requireSystemOwnerContext(supabase);
  } catch {
    redirect('/login?error=owner_required');
  }
}

/**
 * Ensures the current Server Component request has an active Representative (or System Owner) session.
 */
export async function ensureRepresentativePage(
  supabase: SupabaseClient
): Promise<AuthorizedSessionContext> {
  try {
    return await requireRepresentativeContext(supabase);
  } catch {
    redirect('/login?error=representative_required');
  }
}
