import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LayoutDashboard, LogOut } from 'lucide-react'
import { currentScheduler } from '@/lib/schedule/store'
import { signOut } from '@/app/login/actions'
import { ScheduleBack, ScheduleTabBar } from '@/components/schedule/nav'
import { ViewOnly } from '@/components/schedule/bits'
import { PlaceSwitcher } from '@/components/schedule/places'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'JAS שיבוץ',
  manifest: '/schedule-manifest.webmanifest',
  appleWebApp: { capable: true, title: 'JAS שיבוץ', statusBarStyle: 'default' },
  icons: { apple: '/shop-icon?size=180' },
}

/**
 * Schedule mode: the weekly volunteer schedule of one location at a time (a row of
 * place chips when the person has several), laid out for a
 * phone like shop mode. Hebrew, big targets, three tabs. Who may see and change
 * it is decided by the database (migration 0011), not by this layout: the
 * layout only says so when the signed-in person schedules nothing.
 */
export default async function ScheduleLayout({ children }: { children: React.ReactNode }) {
  const s = await currentScheduler()
  if ('error' in s && s.error === 'signed_out') redirect('/login')
  const console = !('error' in s) && s.user.role !== 'scheduler'
  return (
    <div dir="rtl" lang="he" data-shop className="flex min-h-dvh flex-col bg-ground">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-2 sm:px-4">
          <ScheduleBack />
          <Link href="/schedule" className="inline-flex h-11 min-w-0 items-center truncate rounded-full px-2 text-base font-bold text-ink">
            {'error' in s ? 'JAS שיבוץ' : s.location.name}
          </Link>
          <span className="flex-1" />
          {console ? (
            <Link href="/portal" className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-sunken hover:text-ink">
              <LayoutDashboard aria-hidden className="h-4 w-4" />פורטל הצוות
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" aria-label="יציאה" title="יציאה" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"><LogOut aria-hidden className="h-5 w-5" /></button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-5">
        {'error' in s ? <NoAccess setup={s.error === 'setup' ? s.message ?? '' : null} /> : (
          <>
            <PlaceSwitcher locations={s.locations} current={s.location.id} />
            {s.canEdit ? null : <div className="mb-4"><ViewOnly /></div>}
            {children}
          </>
        )}
      </main>
      {'error' in s ? null : <ScheduleTabBar canEdit={s.canEdit} />}
    </div>
  )
}

function NoAccess({ setup }: { setup: string | null }) {
  return (
    <div className="mt-6 rounded-lg border border-line bg-surface p-5">
      <h1 className="text-lg font-bold text-ink">{setup ? 'השיבוץ עוד לא מוכן' : 'אין לך הרשאת שיבוץ'}</h1>
      <p className="mt-1 text-sm text-muted" dir="auto">
        {setup
          ? /0011/.test(setup) ? 'טבלאות השיבוץ עוד לא הותקנו: יש להריץ את supabase/migrations/0011_volunteer_schedule.sql במסד הנתונים של מערכת הניהול.' : `לא ניתן היה לטעון את הלוח: ${setup}`
          : 'רק מי שהוגדר/ה לאחד המקומות (אחראי/ת שיבוץ, או מנהל/ת המקום לצפייה) רואה את הלוח שלו. הבעלים מגדירים את זה בהגדרות → צוות.'}
      </p>
    </div>
  )
}
