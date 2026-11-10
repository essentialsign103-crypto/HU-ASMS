// HU-ASMS: Section Representative Navigation Component
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Users,
  FileCheck2,
  UsersRound,
  BarChart3,
  LogOut,
  Shield,
  PackageCheck,
} from 'lucide-react';
import type { RepresentativeAssignment } from '@hu-asms/types';

const REP_NAV_ITEMS = [
  { name: 'Scope Overview', href: '/rep', icon: LayoutDashboard },
  { name: 'Section Roster', href: '/rep/students', icon: Users },
  { name: 'Submissions & Vault', href: '/rep/submissions', icon: FileCheck2 },
  { name: 'Group Verification', href: '/rep/groups', icon: UsersRound },
  { name: 'Teacher Deliveries', href: '/rep/deliveries', icon: PackageCheck },
  { name: 'Compliance Reports', href: '/rep/reports', icon: BarChart3 },
];

export function RepNav({
  repName,
  assignments,
  currentSectionId,
}: {
  repName?: string;
  assignments: RepresentativeAssignment[];
  currentSectionId?: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col min-h-screen border-r border-slate-800">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-700 flex items-center justify-center font-bold text-white text-lg">
          HU
        </div>
        <div>
          <div className="font-semibold text-white tracking-wide text-sm">HU-ASMS</div>
          <div className="text-xs text-slate-400 font-medium">Representative Portal</div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <div className="text-xs text-slate-400">Section Representative:</div>
        </div>
        <div className="text-sm font-semibold text-emerald-400 truncate mt-0.5">{repName || 'Representative'}</div>
      </div>

      {/* Assigned Scope Pills */}
      <div className="px-4 py-2 border-b border-slate-800/60 bg-slate-900/60">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
          Assigned Scope:
        </div>
        <div className="flex flex-col gap-1">
          {assignments.length === 0 ? (
            <div className="text-xs text-amber-400 italic">No section assigned</div>
          ) : (
            assignments.map((a) => {
              const label = `${a.section?.academic_year?.name || ''} — ${a.section?.name || ''}`;
              const isSelected = a.section_id === currentSectionId;
              return (
                <div
                  key={a.id}
                  className={clsx(
                    'text-xs px-2 py-1 rounded border flex items-center justify-between',
                    isSelected
                      ? 'border-emerald-600 bg-emerald-950/50 text-emerald-300 font-medium'
                      : 'border-slate-800 bg-slate-950/40 text-slate-400'
                  )}
                >
                  <span className="truncate">{label}</span>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
                </div>
              );
            })
          )}
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {REP_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/rep' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-emerald-700 text-white font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
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
