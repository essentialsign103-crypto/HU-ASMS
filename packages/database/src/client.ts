// HU-ASMS: Supabase Client Factories and Service Role Helpers
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export { createClient, SupabaseClient };

export interface DatabaseEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
}

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Creates or retrieves the Supabase Admin client with Service Role privileges.
 * NEVER expose this client to frontend code or client-side bundles.
 */
export function getSupabaseAdminClient(env?: Partial<DatabaseEnvConfig>): SupabaseClient {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const supabaseUrl = env?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = env?.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Missing Supabase configuration. Please provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  cachedAdminClient = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}

/**
 * Creates a scoped Supabase client for authenticated users (Owner or Section Representative)
 * using an access token, strictly subject to Row Level Security (RLS).
 */
export function createScopedUserClient(
  accessToken: string,
  env?: Partial<DatabaseEnvConfig>
): SupabaseClient {
  const supabaseUrl = env?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = env?.supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase public configuration (URL or Anon Key).');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
