'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isActive, type NavGroup } from './nav'
import { NAV_ICONS as ICONS } from './icons'


function Group({ g, onNavigate }: { g: NavGroup; onNavigate?: () => void }) {
  const path = usePathname()
  const params = useSearchParams()
  const range = params.get('range')
  const id = `nav-${g.section.replace(/\W+/g, '-').toLowerCase() || 'root'}`
  return (
        <div role={g.section ? 'group' : undefined} aria-labelledby={g.section ? id : undefined}>
          {g.section ? <div id={id} className="px-3 pb-1 text-xs font-medium text-cream/55">{g.section}</div> : null}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(path, it.href)
              const Icon = ICONS[it.icon]
              return (
                <li key={it.href}>
                  <Link
                    href={range ? `${it.href}?range=${range}` : it.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={it.hint}
                    className={cn(
                      'flex min-h-[40px] items-center gap-2.5 rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-cream',
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
  )
}

/** Task groups at the top; help and setup pinned to the bottom of the column. */
function Links({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const main = groups.filter((g) => !g.footer)
  const foot = groups.filter((g) => g.footer)
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-4">
      {main.map((g) => <Group key={g.section || 'root'} g={g} onNavigate={onNavigate} />)}
      {foot.length ? (
        <div className="mt-auto flex flex-col gap-4 border-t border-cream/10 pt-4">
          {foot.map((g) => <Group key={g.section} g={g} onNavigate={onNavigate} />)}
        </div>
      ) : null}
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

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto bg-forest px-2 py-4 lg:flex">
      <Brand />
      <Links groups={groups} />
    </aside>
  )
}

export function MobileNav({ groups }: { groups: NavGroup[] }) {
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
      {/* Portalled to <body>: the topbar's backdrop-blur makes it the containing block of any
          `fixed` child, which shrank this drawer to the 56px header on phones. */}
      {open ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-forest/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-forest px-2 py-4">
            <div className="flex items-center justify-between pe-2">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="grid h-10 w-10 place-items-center rounded-md text-cream hover:bg-cream/10 focus-visible:outline-cream">
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>
            <Links groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
