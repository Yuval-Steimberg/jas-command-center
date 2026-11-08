import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HelpCircle, LayoutDashboard, LogOut } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'JAS · פורטל הצוות',
  manifest: '/portal-manifest.webmanifest',
  appleWebApp: { capable: true, title: 'JAS צוות', statusBarStyle: 'default' },
  icons: { apple: '/shop-icon?size=180' },
}

/**
 * The team portal: one entry point to the day's work for people who should
 * never need to know which system does what. Hebrew, RTL, big targets, the
 * same sign-in and roles as the rest of the command center. Every page and
 * every destination checks the permission on the server; this layout only
 * frames them.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession()
  if (!s) redirect('/login')
  const console = s.user.role !== 'seller' && s.user.role !== 'scheduler'
  return (
    <div dir="rtl" lang="he" data-shop className="flex min-h-dvh flex-col bg-ground">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:px-5">
          <Link href="/portal" className="inline-flex h-11 items-center gap-2.5 rounded-full pe-2">
            <span aria-hidden className="inline-flex h-8 items-center rounded-full bg-forest px-3 text-sm font-black tracking-wide text-cream">JAS</span>
            <span className="text-sm font-bold tracking-wide text-ink" dir="ltr">JUST A SECOND</span>
          </Link>
          <span className="flex-1" />
          <Link href="/portal/guide" aria-label="מדריך לפורטל" title="מדריך לפורטל" className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-sunken hover:text-ink">
            <HelpCircle aria-hidden className="h-5 w-5" />
            <span className="hidden sm:inline">מדריך</span>
          </Link>
          {console ? (
            <Link href="/console" className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-sunken hover:text-ink">
              <LayoutDashboard aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">מערכת מלאה</span>
              <span className="sr-only sm:hidden">מערכת הניהול המלאה</span>
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" aria-label="יציאה" title="יציאה" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink">
              <LogOut aria-hidden className="h-5 w-5" />
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 sm:pt-8">{children}</main>
    </div>
  )
}
