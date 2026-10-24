import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LayoutDashboard, LogOut } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { signOut } from '@/app/login/actions'
import { ShopBack, ShopTabBar, type ShopTabKey } from '@/components/shop/shop-nav'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'JAS חנות',
  manifest: '/shop-manifest.webmanifest',
  appleWebApp: { capable: true, title: 'JAS חנות', statusBarStyle: 'default' },
  icons: { apple: '/shop-icon?size=180' },
}

/**
 * Shop mode: the same command center, laid out for a phone or tablet at the
 * counter or in the storage. Hebrew, big targets, only what a seller does:
 * sell, add an item, scan, hand over. Every page and action checks the
 * permission on the server, exactly as the console does.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession()
  if (!s) redirect('/login')
  if (!can(s.user.role, 'inventory:read', s.overrides)) redirect('/forbidden')
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const tabs: ShopTabKey[] = ['home', 'items', ...(may('inventory:financial') ? ['sales' as const] : []), 'deliveries']
  return (
    <div dir="rtl" lang="he" data-shop className="flex min-h-dvh flex-col bg-ground">
      {/* One job per header slot: back, where you are, the way out. Who is signed in is said on the home screen. */}
      <header className="sticky top-0 z-10 border-b print:hidden border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-2 sm:px-4">
          <ShopBack />
          <Link href="/shop" className="inline-flex h-11 items-center rounded-full px-2 text-base font-bold text-ink">JAS חנות</Link>
          <span className="flex-1" />
          {s.user.role !== 'seller' ? (
            <Link href="/" className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-sunken hover:text-ink">
              <LayoutDashboard aria-hidden className="h-4 w-4" />מערכת מלאה
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" aria-label="יציאה" title="יציאה" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"><LogOut aria-hidden className="h-5 w-5" /></button>
          </form>
        </div>
      </header>
      {/* Bottom padding clears the tab bar (h-16) and the home indicator. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-5 print:p-0">{children}</main>
      <ShopTabBar tabs={tabs} />
    </div>
  )
}
