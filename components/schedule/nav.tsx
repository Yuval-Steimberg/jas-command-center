'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowRight, BellRing, CalendarDays, MessageCircle, Users } from 'lucide-react'

const TABS = [
  { href: '/schedule', label: 'השבוע', icon: CalendarDays, edit: false },
  { href: '/schedule/team', label: 'קבועים', icon: Users, edit: false },
  { href: '/schedule/remind', label: 'תזכורת', icon: BellRing, edit: true },
  { href: '/schedule/assistant', label: 'עוזר', icon: MessageCircle, edit: false },
] as const

const tabOf = (path: string) => TABS.slice(1).find((t) => path.startsWith(t.href))?.href ?? '/schedule'

/** Schedule mode's bottom bar: the same places on every screen (like shop mode). The reminder is a scheduler's tab. */
export function ScheduleTabBar({ canEdit }: { canEdit: boolean }) {
  const path = usePathname()
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => setPending(null), [path])
  const active = tabOf(pending ?? path)
  const tabs = TABS.filter((t) => canEdit || !t.edit)
  return (
    <nav aria-label="ניווט שיבוץ" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur print:hidden">
      <ul className="mx-auto flex max-w-3xl">
        {tabs.map((t) => {
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
