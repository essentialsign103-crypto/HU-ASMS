// HU-ASMS: System Owner Navigation Component
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Building2,
  GraduationCap,
  FolderGit2,
  Users,
  ShieldCheck,
  FileClock,
  LogOut,
  ExternalLink,
} from 'lucide-react';

const NAV_ITEMS = [
  { name: 'Overview', href: '/admin', icon: LayoutDashboard },
  { name: 'University Structure', href: '/admin/structure', icon: Building2 },
  { name: 'Academic Directory', href: '/admin/academics', icon: GraduationCap },
  { name: 'Project Studio', href: '/admin/academics/projects', icon: FolderGit2 },
  { name: 'Student Identity', href: '/admin/students', icon: Users },
  { name: 'Representatives', href: '/admin/representatives', icon: ShieldCheck },
  { name: 'Audit Logs', href: '/admin/audit-logs', icon: FileClock },
];

export function AdminNav({ ownerName }: { ownerName?: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col min-h-screen border-r border-slate-800">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-green-700 flex items-center justify-center font-bold text-white text-lg">
          HU
        </div>
        <div>
          <div className="font-semibold text-white tracking-wide text-sm">HU-ASMS</div>
          <div className="text-xs text-slate-400 font-medium">System Owner Console</div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-800/60 bg-slate-950/40">
        <div className="text-xs text-slate-400">Authenticated Administrator:</div>
        <div className="text-sm font-semibold text-green-400 truncate mt-0.5">{ownerName || 'System Owner'}</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-green-700 text-white font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}

        <div className="pt-4 mt-4 border-t border-slate-800">
          <Link
            href="/rep"
            className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <span className="flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Representative Portal</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">Switch</span>
          </Link>
        </div>
      </nav>

      <div className="p-4 border-t border-slate-800">
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
