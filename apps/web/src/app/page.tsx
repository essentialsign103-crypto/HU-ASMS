import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '../lib/supabase/server';
import { resolveUserSessionContext } from '../lib/auth/roles';

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const context = await resolveUserSessionContext(supabase);

  if (!context || !context.profile) {
    redirect('/login');
  }

  if (context.isOwner) {
    redirect('/admin');
  }

  if (context.isRepresentative) {
    redirect('/rep');
  }

  redirect('/login?error=unauthorized_role');
}
