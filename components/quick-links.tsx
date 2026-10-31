import Link from 'next/link'
import { ExternalLink, Gift, ShoppingBag, Sofa, type LucideIcon } from 'lucide-react'
import type { Permission } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { START_TASKS } from '@/components/shell/nav'
import { NAV_ICONS } from '@/components/shell/icons'


type QuickLink = { href: string; external: boolean; label: string; hint: string; icon: LucideIcon; permission: Permission }

/**
 * The other apps staff open from here. Gift cards and furniture open the apps
 * themselves (GIFT_CARDS_URL, FURNITURE_APP_URL) in a new tab; with the URL
 * unset they fall back to the console section.
 */
export function quickLinks(e: { giftCards?: string; furniture?: string }): QuickLink[] {
  return [
    { href: '/shop', external: false, label: 'Shop counter', hint: 'Sell, add, scan', icon: ShoppingBag, permission: 'inventory:read' },
    { href: e.giftCards ?? '/gift-cards', external: !!e.giftCards, label: 'Gift card site', hint: 'Gift card site', icon: Gift, permission: 'gift_cards:read' },
    { href: e.furniture ?? '/furniture', external: !!e.furniture, label: 'Furniture app', hint: 'Furniture collection app', icon: Sofa, permission: 'furniture:read' },
  ]
}

const tile =
  'flex min-h-16 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-card transition-[transform,background-color] duration-150 hover:-translate-y-px hover:bg-sunken active:scale-[0.98]'

/** "What do you want to do?": one button per job this person may do, then the other apps. */
export function QuickLinks({ allowed }: { allowed: (p: Permission) => boolean }) {
  const e = env()
  const tasks = START_TASKS.filter((t) => !t.permission || allowed(t.permission))
  const apps = quickLinks({ giftCards: e.giftCards.url, furniture: e.furniture.appUrl }).filter((l) => allowed(l.permission))
  return (
    <section aria-labelledby="start-a-task" className="mb-6">
      <h2 id="start-a-task" className="sr-only">Tasks</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tasks.map((t) => {
          const Icon = NAV_ICONS[t.icon]
          return (
            <li key={t.href} className="min-w-0">
              <Link href={t.href} className={tile}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage-soft text-forest">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{t.label}</span>
                  <span className="block text-xs text-muted">{t.hint}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      {apps.length ? (
        <nav aria-label="Other apps" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-muted">Open an app:</span>
          {apps.map(({ href, external, label, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="inline-flex min-h-11 items-center gap-1.5 text-ink underline-offset-[3px] hover:underline"
            >
              <Icon className="size-4 text-muted" strokeWidth={1.75} aria-hidden />
              {label}
              {external ? <ExternalLink className="size-3.5 text-muted" aria-label="opens in a new tab" /> : null}
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
  )
}
