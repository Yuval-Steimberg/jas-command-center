'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, MessageCircle, Users } from 'lucide-react'

const TABS = [
  { href: '/schedule', label: 'השבוע', icon: CalendarDays },
  { href: '/schedule/team', label: 'קבועים', icon: Users },
  { href: '/schedule/assistant', label: 'עוזר', icon: MessageCircle },
] as const

const tabOf = (path: string) => (path.startsWith('/schedule/team') ? '/schedule/team' : path.startsWith('/schedule/assistant') ? '/schedule/assistant' : '/schedule')

/** Schedule mode's bottom bar: three places, the same on every screen (like shop mode). */
export function ScheduleTabBar() {
  const path = usePathname()
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => setPending(null), [path])
  const active = tabOf(pending ?? path)
  return (
    <nav aria-label="ניווט שיבוץ" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur print:hidden">
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((t) => {
          const on = active === t.href
          return (
            <li key={t.href} className="flex-1">
              <Link href={t.href} aria-current={on ? 'page' : undefined} onClick={() => { if (path !== t.href) setPending(t.href) }} className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${on ? 'font-semibold text-ink' : 'font-medium text-muted hover:text-ink'}`}>
                <span className={`inline-flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ${on ? 'bg-sage-soft text-forest' : ''}`}><t.icon aria-hidden className="h-5 w-5" strokeWidth={on ? 2.25 : 1.75} /></span>
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Back on every screen below a tab's top: to where Dafna came from, or up to the week. */
export function ScheduleBack() {
  const path = usePathname()
  const router = useRouter()
  if (TABS.some((t) => t.href === path)) return null
  return (
    <button type="button" aria-label="חזרה" onClick={() => (window.history.length > 1 ? router.back() : router.push('/schedule'))} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-sunken">
      <ArrowRight aria-hidden className="h-5 w-5" />
    </button>
  )
}
