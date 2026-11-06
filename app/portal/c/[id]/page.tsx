import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { portalView, toView } from '@/lib/portal/views'
import { CategoryIcon } from '@/components/portal/bits'
import { ActionRow } from '@/components/portal/action-row'

export const dynamic = 'force-dynamic'

/**
 * One category (spec page 2, second phone): the category grid steps aside
 * and its actions are listed as big rows, each saying in one line what
 * happens, with Open, Copy link and Share. Its address is shareable too.
 */
export default async function CategoryPage({ params }: { params: { id: string } }) {
  const s = await getSession()
  if (!s) redirect(`/login?next=${encodeURIComponent(`/portal/c/${params.id}`)}`)
  const { categories } = await portalView(s.user.role, s.overrides)
  const c = categories.find((x) => x.id === params.id)
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/portal" className="-ms-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted hover:bg-sunken hover:text-ink">
        <ArrowRight aria-hidden className="size-4" />
        כל הקטגוריות
      </Link>
      {c ? (
        <>
          <div className="mb-5 flex items-center gap-3">
            <CategoryIcon icon={c.icon} size="lg" />
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold text-ink">{c.title}</h1>
              <p className="text-sm text-muted">{c.subtitle}</p>
            </div>
          </div>
          <ul className="flex flex-col gap-3">
            {c.actions.map((a) => (
              <ActionRow key={a.id} a={toView(a)} />
            ))}
          </ul>
          <p className="mt-5 text-sm text-muted">
            &quot;העתקה&quot; ו&quot;שיתוף&quot; שולחים קישור ישיר לפעולה. מי שמקבל אותו נכנס עם החשבון שלו, ורואה רק מה שמותר לו.
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-line bg-surface p-5">
          <h1 className="text-lg font-bold text-ink">הקטגוריה הזו לא זמינה</h1>
          <p className="mt-1 text-sm text-muted">ייתכן שהיא כבויה, או שאין לך פעולות בה. אפשר לחזור לדף הראשי ולבחור קטגוריה אחרת.</p>
        </div>
      )}
    </div>
  )
}
