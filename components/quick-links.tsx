import Link from 'next/link'
import { ChevronRight, ExternalLink, Gift, ShoppingBag, Sofa, type LucideIcon } from 'lucide-react'
import type { Permission } from '@/lib/auth/rbac'
import { env } from '@/lib/env'

type QuickLink = { href: string; external: boolean; label: string; hint: string; icon: LucideIcon; permission: Permission }

/**
 * Shop mode is this app's own /shop. Gift cards and furniture open the apps themselves
 * (GIFT_CARDS_URL, FURNITURE_APP_URL) in a new tab; with the URL unset they fall back to
 * the console section. Permissions are the sidebar's (`components/shell/nav.ts`).
 */
export function quickLinks(e: { giftCards?: string; furniture?: string }): QuickLink[] {
  return [
    { href: '/shop', external: false, label: 'Shop mode', hint: 'Sell, add, scan', icon: ShoppingBag, permission: 'inventory:read' },
    { href: e.giftCards ?? '/gift-cards', external: !!e.giftCards, label: 'Gift cards', hint: 'Gift card site', icon: Gift, permission: 'gift_cards:read' },
    { href: e.furniture ?? '/furniture', external: !!e.furniture, label: 'Furniture', hint: 'Furniture collection app', icon: Sofa, permission: 'furniture:read' },
  ]
}

/** Big tappable shortcuts at the top of the dashboard. Only links the user may open are shown. */
export function QuickLinks({ allowed }: { allowed: (p: Permission) => boolean }) {
  const e = env()
  const links = quickLinks({ giftCards: e.giftCards.url, furniture: e.furniture.appUrl }).filter((l) => allowed(l.permission))
  if (links.length === 0) return null
  return (
    <nav aria-label="Quick links" className="mb-5 grid gap-3 sm:grid-cols-3">
      {links.map(({ href, external, label, hint, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="flex min-h-16 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-card transition hover:-translate-y-px hover:bg-sunken active:scale-[0.98]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken text-ink">
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">{label}</span>
            <span className="block text-meta text-muted">{hint}</span>
          </span>
          {external ? <ExternalLink className="size-5 shrink-0 text-muted" aria-label="Opens in a new tab" /> : <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />}
        </Link>
      ))}
    </nav>
  )
}
