import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requirePageAccess } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { ChangeChat } from '@/components/portal/change-chat'

export const dynamic = 'force-dynamic'
// One Claude turn can take up to ~55 s with screenshots.
export const maxDuration = 60

/**
 * "שינוי בפורטל בשיחה": say what to change in words, by voice or with a
 * screenshot. Buttons and categories change after the owner approves each
 * card; anything that needs code goes to development as a written request.
 */
export default async function ChangePage() {
  await requirePageAccess('portal:manage')
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/portal" className="-ms-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted hover:bg-sunken hover:text-ink">
        <ArrowRight aria-hidden className="size-4" />
        חזרה לפורטל
      </Link>
      <h1 className="text-2xl font-extrabold text-ink">שינוי בפורטל בשיחה</h1>
      <p className="mt-1 mb-5 text-base text-muted">
        אומרים מה לשנות, Claude מציע, ושום דבר לא משתנה בלי אישור שלכם. כפתורים וקטגוריות מתעדכנים מיד אחרי האישור; עיצוב ופיצ׳רים חדשים נשלחים לפיתוח ועולים אחרי בדיקה.
      </p>
      <ChangeChat configured={!!env().assistant.apiKey} />
      <p className="mt-6 text-sm text-muted">
        כל שינוי נשמר ב
        <Link href="/portal/manage#history" className="underline underline-offset-4">
          יומן השינויים
        </Link>
        .
      </p>
    </div>
  )
}
