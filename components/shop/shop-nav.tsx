'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowRight, Home, PackagePlus, ScanLine, Search, ShoppingBag } from 'lucide-react'

export type ShopTabKey = 'home' | 'sell' | 'new' | 'scan' | 'items'

const TABS: Record<ShopTabKey, { href: string; label: string; icon: typeof Home }> = {
  home: { href: '/shop', label: 'בית', icon: Home },
  sell: { href: '/shop/sell', label: 'מכירה', icon: ShoppingBag },
  new: { href: '/shop/new', label: 'הוספה', icon: PackagePlus },
  scan: { href: '/shop/scan', label: 'סריקה', icon: ScanLine },
  items: { href: '/shop/items', label: 'פריטים', icon: Search },
}

/** Which tab a path belongs to: an item page is under פריטים, a sale under מכירה. */
export function tabOf(path: string): ShopTabKey {
  if (path === '/shop') return 'home'
  if (path.startsWith('/shop/sell') || path.startsWith('/shop/sales')) return 'sell'
  if (path.startsWith('/shop/new')) return 'new'
  if (path.startsWith('/shop/scan')) return 'scan'
  return 'items'
}

/**
 * The tab marks itself the moment it is pressed, before the server answers:
 * the pathname only changes once the next page has arrived, and a tap with no
 * visible reaction gets tapped again.
 */
function usePending() {
  const path = usePathname()
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => setPending(null), [path])
  return { path, pending, setPending }
}

/** Shop mode's bottom bar: every seller task one thumb tap away, on every page. */
export function ShopTabBar({ tabs }: { tabs: ShopTabKey[] }) {
  const { path, pending, setPending } = usePending()
  const active = tabOf(pending ?? path)
  return (
    <nav aria-label="ניווט חנות" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-5xl">
        {tabs.map((k) => {
          const t = TABS[k]
          const on = active === k
          return (
            <li key={k} className="flex-1">
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                onClick={() => { if (path !== t.href) setPending(t.href) }}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${on ? 'font-semibold text-ink' : 'font-medium text-muted hover:text-ink'}`}
              >
                {/* Selection is sage, not orange: orange is the one primary action on the screen above. */}
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

/** Back, on every page below the home screen: to where the seller came from, or up one level when opened directly. */
export function ShopBack() {
  const path = usePathname()
  const router = useRouter()
  if (path === '/shop') return null
  const up = path.startsWith('/shop/items/') ? '/shop/items' : '/shop'
  return (
    <button
      type="button"
      aria-label="חזרה"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(up))}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-sunken"
    >
      <ArrowRight aria-hidden className="h-5 w-5" />
    </button>
  )
}
