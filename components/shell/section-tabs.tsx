'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/cn'
import { activeTab, sectionOf, type SECTIONS } from './nav'

/**
 * The pages of the current section, as tabs at the top of every page in it, so
 * nothing in a section is hidden behind another page's link. The list arrives
 * already filtered to what this person may open. The row scrolls sideways on
 * a phone; the page itself never does.
 */
export function SectionTabs({ sections }: { sections: typeof SECTIONS }) {
  const path = usePathname()
  const range = useSearchParams().get('range')
  const section = sectionOf(path)
  const tabs = section ? sections.find((s) => s.base === section.base)?.tabs ?? [] : []
  if (tabs.length < 2) return null
  const current = activeTab(path, tabs)
  return (
    <nav aria-label="Pages in this section" className="-mx-3 mb-5 overflow-x-auto border-b border-line px-3 sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const on = t.href === current
          return (
            <li key={t.href}>
              <Link
                href={range ? `${t.href}?range=${range}` : t.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  '-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors duration-150',
                  on ? 'border-forest font-medium text-ink' : 'border-transparent text-muted hover:border-line hover:text-ink',
                )}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
