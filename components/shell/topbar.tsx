import Link from 'next/link'
import { Suspense } from 'react'
import { Bell, Search, LogOut } from 'lucide-react'
import { notificationState, liveHealth } from '@/lib/live'
import { rollup } from '@/lib/integrations/types'
import { StatusBadge } from '@/components/ui/status'
import { ROLE_LABELS } from '@/lib/auth/rbac'
import type { CurrentUser } from '@/lib/auth/session'
import { MobileNav } from './sidebar'
import { RangeSelect } from './range-select'
import { NAV } from './nav'
import { signOut } from '@/app/login/actions'

async function SystemStatus() {
  const health = await liveHealth()
  const status = rollup(health.map((h) => ({ name: h.product, status: h.status, detail: '', checkedAt: null, latencyMs: null })))
  return (
    <Link href="/integrations" className="hidden rounded-full sm:block" aria-label="System status">
      <StatusBadge status={status} />
    </Link>
  )
}

async function AlertsBell() {
  const state = await notificationState()
  // Unread when history is available; otherwise every open non-info alert, as before.
  const count = state.error ? state.live.filter((a) => a.severity !== 'info').length : state.open.filter((n) => n.unread && n.severity !== 'info').length
  return (
    <Link href="/notifications" aria-label={`Notifications: ${count} unread`} className="relative grid h-9 w-9 place-items-center rounded-md text-ink hover:bg-sunken">
      <Bell aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {count ? <span className="num absolute -end-0.5 -top-0.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-meta font-semibold leading-[18px] text-cream">{count}</span> : null}
    </Link>
  )
}

export function Topbar({ user, nav }: { user: CurrentUser; nav: typeof NAV }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-ground/95 px-3 backdrop-blur-sm sm:px-5">
      <MobileNav groups={nav} />
      <form action="/search" role="search" className="relative hidden max-w-sm flex-1 md:block">
        <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <label>
          <span className="sr-only">Search across systems</span>
          <input name="q" dir="auto" maxLength={100} placeholder="Search items, orders, customers, pages…" className="h-9 w-full rounded-md border border-line bg-surface ps-8 pe-3 text-sm placeholder:text-faint" />
        </label>
      </form>
      <Link href="/search" aria-label="Search" className="grid h-9 w-9 place-items-center rounded-md text-ink hover:bg-sunken md:hidden">
        <Search aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </Link>
      <div className="ms-auto flex items-center gap-2">
        <RangeSelect />
        <Suspense fallback={<span className="hidden h-6 w-24 animate-pulse rounded-full bg-sunken sm:block" />}>
          <SystemStatus />
        </Suspense>
        <Suspense fallback={<span className="h-9 w-9" />}>
          <AlertsBell />
        </Suspense>
        <details className="group relative">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 hover:bg-sunken">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-sage-soft text-xs font-semibold text-forest">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-sm sm:inline">{user.name}</span>
          </summary>
          <div className="absolute end-0 mt-1 w-56 rounded-md border border-line bg-surface p-1 shadow-lift">
            <div className="px-3 py-2 text-xs text-muted">
              <div className="truncate font-medium text-ink">{user.email}</div>
              <div>{ROLE_LABELS[user.role]}{user.dev ? ' · local dev login' : ''}</div>
            </div>
            <form action={signOut}>
              <button className="flex w-full items-center gap-2 rounded px-3 py-2 text-start text-sm hover:bg-sunken">
                <LogOut aria-hidden className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  )
}
