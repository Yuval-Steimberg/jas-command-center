'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Store, MessageCircle, Sofa, MapPinned, Gift, ChartLine, FileText, Sparkles, Bell, Cable, Settings, Menu, X,
  Users, Package, ShoppingBag, Truck, ListChecks, Factory, HeartHandshake,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NavItem } from './nav'

const ICONS = {
  overview: LayoutDashboard, crm: Users, inventory: Package, sales: ShoppingBag, truck: Truck, tasks: ListChecks, supplier: Factory, volunteers: HeartHandshake, website: Store, agent: MessageCircle, furniture: Sofa, map: MapPinned, gift: Gift,
  analytics: ChartLine, report: FileText, assistant: Sparkles, bell: Bell, plug: Cable, settings: Settings,
} as const

function Links({ groups, onNavigate }: { groups: { section: string; items: NavItem[] }[]; onNavigate?: () => void }) {
  const path = usePathname()
  const params = useSearchParams()
  const range = params.get('range')
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.section || 'root'}>
          {g.section ? <div className="px-3 pb-1 text-meta font-semibold uppercase tracking-[0.12em] text-cream/50">{g.section}</div> : null}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = it.href === '/' ? path === '/' : path === it.href || path.startsWith(`${it.href}/`)
              const Icon = ICONS[it.icon]
              return (
                <li key={it.href}>
                  <Link
                    href={range ? `${it.href}?range=${range}` : it.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[40px] items-center gap-2.5 rounded-md px-3 text-sm transition-colors duration-150',
                      active ? 'bg-cream/10 font-medium text-cream' : 'text-cream/70 hover:bg-cream/5 hover:text-cream',
                    )}
                  >
                    <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {it.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-cream text-[13px] font-black tracking-tight text-forest">JAS</span>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-cream">Command Center</div>
        <div className="text-meta text-cream/55">Just A Second</div>
      </div>
    </div>
  )
}

export function Sidebar({ groups }: { groups: { section: string; items: NavItem[] }[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto bg-forest px-2 py-4 lg:flex">
      <Brand />
      <Links groups={groups} />
    </aside>
  )
}

export function MobileNav({ groups }: { groups: { section: string; items: NavItem[] }[] }) {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="grid h-10 w-10 place-items-center rounded-md text-ink hover:bg-sunken lg:hidden">
        <Menu aria-hidden className="h-5 w-5" />
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-forest/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-forest px-2 py-4">
            <div className="flex items-center justify-between pe-2">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="grid h-10 w-10 place-items-center rounded-md text-cream hover:bg-cream/10">
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>
            <Links groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  )
}
