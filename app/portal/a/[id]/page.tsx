import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { mayUse, resolveDestination, APP_LABEL } from '@/lib/portal/model'
import { appUrls, loadPortal } from '@/lib/portal/service'

export const dynamic = 'force-dynamic'

/**
 * A shared action link (/portal/a/<id>). Whoever opens it signs in if needed,
 * is checked against the action's permission HERE, on the server, and only
 * then is forwarded straight to the destination, which checks again. The link
 * names the action, not the address, so it keeps working when the address
 * behind it changes in link management.
 */
export default async function ActionLink({ params }: { params: { id: string } }) {
  const s = await getSession()
  if (!s) redirect(`/login?next=${encodeURIComponent(`/portal/a/${params.id}`)}`)
  const { data } = await loadPortal()
  const a = data.actions.find((x) => x.id === params.id)
  const category = a ? data.categories.find((c) => c.id === a.categoryId) : null

  if (!a || !a.active || !category?.active)
    return <Note title="הקישור הזה כבר לא פעיל" text="ייתכן שהפעולה הוסרה או כובתה. אפשר למצוא את מה שצריך בדף הראשי של הפורטל." />
  if (!mayUse({ role: s.user.role, overrides: s.overrides }, a))
    return <Note title="אין לך הרשאה לפעולה הזו" text={`"${a.title}" פתוח רק לחלק מהצוות. אם צריך את זה בעבודה, אפשר לבקש ממנהלת הפורטל להוסיף הרשאה.`} />
  const r = resolveDestination(a.destination, appUrls())
  if (!r.ok)
    return <Note title="הפעולה עוד לא מחוברת" text={r.app ? `הכתובת של ${APP_LABEL[r.app]} עוד לא הוגדרה במערכת.` : 'לפעולה הזו עוד אין כתובת. מנהלת הפורטל יכולה להשלים אותה.'} />
  redirect(r.href)
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto mt-6 max-w-lg rounded-lg border border-line bg-surface p-6 shadow-card">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-base text-muted">{text}</p>
      <Link href="/portal" className="mt-5 inline-flex h-12 items-center rounded-full bg-forest px-5 text-base font-bold text-cream hover:bg-forest/90">
        לדף הראשי של הפורטל
      </Link>
    </div>
  )
}
