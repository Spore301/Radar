'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { Search, History, Users, FileText, Settings, LogOut, Sparkles, type LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { RadrLogo } from '@/components/brand/RadrLogo';
import { HistoryPanel } from '@/components/sessions/HistoryPanel';
import { RunTrackerProvider } from '@/components/runs/RunTracker';
import { RunToaster } from '@/components/runs/RunToaster';
import * as api from '@/lib/api/sessions';
import { SESSIONS_CHANGED_EVENT } from '@/lib/api/sessions';

// ---------------------------------------------------------------------------
// App shell: a 232px sidebar on the canvas, and the page content in a centred
// column beside it. "History" is a sidebar item that opens a panel to the
// right of the sidebar rather than a route, so a recruiter can glance at past
// sessions from any page without losing their place.
// ---------------------------------------------------------------------------

const NAV = [
  { label: 'New search', href: '/dashboard', icon: Search },
  { label: 'Agent', href: '/dashboard/agent', icon: Sparkles },
  { label: 'Pipeline', href: '/dashboard/pipeline', icon: Users },
  { label: 'Templates', href: '/dashboard/templates', icon: FileText },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
] as const;

export const SIDEBAR_WIDTH = 232;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [company, setCompany] = useState<string | null>(null);

  const activeSessionId = pathname === '/dashboard' || pathname === '/dashboard/agent' ? searchParams.get('session') : null;

  const refreshCount = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessionCount(list.length);
    } catch {
      // Count is decoration; the panel shows the real error if listing fails.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    window.addEventListener(SESSIONS_CHANGED_EVENT, refreshCount);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, refreshCount);
  }, [refreshCount]);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCompany(d?.profile?.company ?? null))
      .catch(() => {});
  }, []);

  // Close the panel on route change and on Escape.
  useEffect(() => {
    setHistoryOpen(false);
  }, [pathname, activeSessionId]);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen]);

  const user = session?.user;
  const displayName = user?.name ?? user?.email ?? 'Signed in';

  const isActive = (href: string) => (href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href));

  return (
    <RunTrackerProvider>
      <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside
        className="lg:w-[232px] lg:flex-shrink-0 lg:h-screen lg:sticky lg:top-0 bg-canvas border-b lg:border-b-0 lg:border-r border-hairline flex flex-col"
        aria-label="Primary"
      >
        <div className="px-3 pt-4 pb-3 flex items-center justify-between lg:justify-start">
          <Link href="/dashboard" className="flex items-center px-2 py-1.5 rounded-sm text-ink hover:bg-hairline-soft transition-colors" aria-label="RADR. home">
            <RadrLogo height={16} />
          </Link>
        </div>

        <nav className="px-3 flex lg:flex-col gap-0.5 overflow-x-auto no-scrollbar pb-3 lg:pb-0">
          {NAV.slice(0, 1).map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} active={isActive(item.href) && !historyOpen} />
          ))}
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls="history-panel"
            className={`flex items-center gap-2.5 h-[34px] px-2.5 rounded-sm text-body-sm font-medium transition-colors whitespace-nowrap ${
              historyOpen ? 'bg-elevated border border-hairline text-ink' : 'text-body hover:bg-hairline-soft hover:text-ink border border-transparent'
            }`}
          >
            <History className="w-4 h-4" strokeWidth={1.75} />
            <span>History</span>
            {sessionCount !== null && <span className="ml-auto text-body-xs text-mute tabular-nums">{sessionCount}</span>}
          </button>
          {NAV.slice(1).map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} active={isActive(item.href)} />
          ))}
        </nav>

        <div className="hidden lg:block flex-1" />

        <div className="hidden lg:flex items-center gap-2.5 px-3 py-3 border-t border-hairline">
          <Avatar name={displayName} src={user?.image} size={28} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-body-sm text-ink truncate">{displayName}</div>
            <div className="text-body-xs text-mute truncate">{company ?? user?.email ?? ''}</div>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/signin' })}
            className="btn-icon h-7 w-7"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* History panel — beside the sidebar, over the content */}
      {historyOpen && (
        <>
          <button
            type="button"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
            className="fixed inset-0 z-30 bg-transparent cursor-default"
          />
          <HistoryPanel
            activeSessionId={activeSessionId}
            onClose={() => setHistoryOpen(false)}
            onSelect={(id) => {
              setHistoryOpen(false);
              router.push(`/dashboard?session=${encodeURIComponent(id)}`);
            }}
            onNew={() => {
              setHistoryOpen(false);
              router.push('/dashboard');
            }}
          />
        </>
      )}

      {/* Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {pathname.startsWith('/dashboard/agent') ? (
          // The agent is a full-height chat surface, like a messaging app: no centred column, no page padding.
          <div className="flex-1 min-h-0 lg:h-screen flex flex-col">{children}</div>
        ) : (
          <div className="max-w-content mx-auto w-full px-5 sm:px-8 py-6 sm:py-8">{children}</div>
        )}
      </main>
        {/* Background search progress — bottom-right, survives every route change. */}
        <RunToaster />
      </div>
    </RunTrackerProvider>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 h-[34px] px-2.5 rounded-sm text-body-sm font-medium transition-colors whitespace-nowrap border border-transparent ${
        active ? 'bg-hairline-soft text-ink' : 'text-body hover:bg-hairline-soft hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} />
      <span>{label}</span>
    </Link>
  );
}
