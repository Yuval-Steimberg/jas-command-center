import Link from 'next/link'
import { ChevronRight, Gift, ShoppingBag, Sofa, type LucideIcon } from 'lucide-react'
import type { Permission } from '@/lib/auth/rbac'

type QuickLink = { href: string; label: string; hint: string; icon: LucideIcon; permission: Permission }

/** Same paths and permissions as the sidebar entries in `components/shell/nav.ts`. */
export const QUICK_LINKS: QuickLink[] = [
  { href: '/shop', label: 'Shop mode', hint: 'Sell, add, scan', icon: ShoppingBag, permission: 'inventory:read' },
  { href: '/gift-cards', label: 'Gift cards', hint: 'Cards and balances', icon: Gift, permission: 'gift_cards:read' },
  { href: '/furniture', label: 'Furniture', hint: 'Collection projects', icon: Sofa, permission: 'furniture:read' },
]

/** Big tappable shortcuts at the top of the dashboard. Only links the user may open are passed in. */
export function QuickLinks({ allowed }: { allowed: (p: Permission) => boolean }) {
  const links = QUICK_LINKS.filter((l) => allowed(l.permission))
  if (links.length === 0) return null
  return (
    <nav aria-label="Quick links" className="mb-5 grid gap-3 sm:grid-cols-3">
      {links.map(({ href, label, hint, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-16 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-card transition hover:-translate-y-px hover:bg-sunken active:scale-[0.98]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken text-ink">
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">{label}</span>
            <span className="block text-meta text-muted">{hint}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
        </Link>
      ))}
    </nav>
  )
}
