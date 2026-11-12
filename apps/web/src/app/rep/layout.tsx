// HU-ASMS: Section Representative Portal Layout
import React from 'react';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { ensureRepresentativePage } from '../../lib/auth/page-guards';
import { RepNav } from '../../components/rep/rep-nav';

export default async function RepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const context = await ensureRepresentativePage(supabase);

  return (
    <div className="flex min-h-screen bg-slate-100">
      <RepNav
        repName={context.profile.full_name}
        assignments={context.assignments}
      />
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Section Representative Scope
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span>HU-ASMS Version 2.0</span>
          </div>
        </header>
        <div className="p-8 max-w-7xl w-full mx-auto space-y-8">{children}</div>
      </main>
    </div>
  );
}
