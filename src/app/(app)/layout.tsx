import { AtSign, BarChart3, CalendarDays, CheckSquare, LayoutDashboard, LogOut, Settings, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { requireUser } from '@/server/auth/session';

import { logoutAction } from '../(auth)/login/actions';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/studio', label: 'AI Content Studio', icon: Sparkles },
  { href: '/approvals', label: 'Approval Center', icon: CheckSquare },
  { href: '/calendar', label: 'Content Calendar', icon: CalendarDays },
  { href: '/accounts', label: 'Instagram Accounts', icon: AtSign },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-paper lg:min-h-dvh lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 lg:block">
          <Link href="/" className="block">
            <span className="block text-base font-semibold">Instagram Studio</span>
            <span className="block text-xs text-muted">Euro Digital</span>
          </Link>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-slate-100">
              <Icon className="size-4 text-muted" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden px-4 py-4 text-xs text-muted lg:block">
          <p className="truncate">{user.email}</p>
          <form action={logoutAction} className="mt-2">
            <button type="submit" className="inline-flex items-center gap-1 text-accent hover:underline">
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
