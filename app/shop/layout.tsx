import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Home, LogOut } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can, ROLE_LABELS } from '@/lib/auth/rbac'
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
  const tabs: ShopTabKey[] = ['home', ...(may('inventory:financial') ? ['sell' as const] : []), ...(may('inventory:write') ? ['new' as const] : []), 'scan', 'items']
  return (
    <div dir="rtl" lang="he" className="flex min-h-dvh flex-col bg-ground">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-line bg-surface/95 px-2 backdrop-blur">
        <ShopBack />
        <Link href="/shop" className="inline-flex h-11 items-center gap-2 rounded-full px-3 font-semibold text-ink hover:bg-sunken"><Home aria-hidden className="h-5 w-5" />JAS חנות</Link>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{s.user.name} · {ROLE_LABELS[s.user.role]}</span>
        {s.user.role !== 'seller' ? <Link href="/" className="inline-flex h-11 items-center rounded-full px-3 text-sm text-muted hover:bg-sunken">למערכת המלאה</Link> : null}
        <form action={signOut}><button type="submit" aria-label="יציאה" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken"><LogOut aria-hidden className="h-5 w-5" /></button></form>
      </header>
      {/* Bottom padding clears the tab bar (h-16) and the home indicator. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-5">{children}</main>
      <ShopTabBar tabs={tabs} />
    </div>
  )
}
