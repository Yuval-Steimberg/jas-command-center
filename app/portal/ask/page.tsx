import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requirePageAccess, getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { AskChat } from '@/components/portal/ask-chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** "לשאול": ask the live systems in Hebrew, by voice or text. Questions only. */
export default async function AskPage() {
  await requirePageAccess('assistant:use')
  const s = await getSession()
  const c = (p: Parameters<typeof can>[1]) => !!s && can(s.user.role, p, s.overrides)
  // Examples only for what this person's tools can answer.
  const examples = [
    c('inventory:read') ? 'יש לנו במלאי כיסא עץ?' : null,
    c('inventory:read') ? 'אילו משלוחים יוצאים היום?' : null,
    c('inventory:read') ? 'אילו משימות פתוחות יש בחנות?' : null,
    c('inventory:reports') ? 'כמה מכרנו בחנות השבוע לעומת השבוע שעבר?' : null,
    c('gift_cards:read') ? 'יש שוברי מתנה ששולמו ולא נשלחו?' : null,
  ].filter((x): x is string => !!x).slice(0, 4)
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/portal" className="-ms-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted hover:bg-sunken hover:text-ink">
        <ArrowRight aria-hidden className="size-4" />
        חזרה לפורטל
      </Link>
      <h1 className="text-2xl font-extrabold text-ink">לשאול</h1>
      <p className="mb-5 mt-1 text-base text-muted">שואלים במילים או בקול, והתשובה מגיעה מהמערכות עצמן. כאן רק שואלים: שינויים עושים במסכים עצמם.</p>
      {env().assistant.apiKey ? (
        <AskChat examples={examples} />
      ) : (
        <p className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">החיבור ל-Claude עוד לא הוגדר במערכת.</p>
      )}
    </div>
  )
}
