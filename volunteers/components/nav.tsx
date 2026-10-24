'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Compass, Home, LogIn, UserRound } from 'lucide-react'
import { cn } from '@/lib/cn'

/** The bottom tab bar: four places, always in the same order, thumb-reachable. */
export function BottomNav({ signedIn }: { signedIn: boolean }) {
  const path = usePathname()
  const tabs = signedIn
    ? [
        { href: '/', label: 'בית', icon: Home },
        { href: '/activities', label: 'פעילויות', icon: Compass },
        { href: '/my', label: 'המשמרות שלי', icon: CalendarCheck },
        { href: '/profile', label: 'פרופיל', icon: UserRound },
      ]
    : [
        { href: '/', label: 'בית', icon: Home },
        { href: '/activities', label: 'פעילויות', icon: Compass },
        { href: '/login', label: 'כניסה', icon: LogIn },
      ]
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`))
  return (
    <nav aria-label="ניווט ראשי" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ground/95 pb-safe backdrop-blur supports-[backdrop-filter]:bg-ground/85">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const on = active(t.href)
          const Icon = t.icon
          return (
            <li key={t.href} className="flex-1">
              <Link href={t.href} aria-current={on ? 'page' : undefined} className={cn('flex min-h-16 flex-col items-center justify-center gap-0.5 text-[0.8125rem] font-medium transition', on ? 'text-forest' : 'text-slate hover:text-forest')}>
                <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition', on && 'bg-sage-soft')}>
                  <Icon aria-hidden className="h-[1.375rem] w-[1.375rem]" strokeWidth={1.75} />
                </span>
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
