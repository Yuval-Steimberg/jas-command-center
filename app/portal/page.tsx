import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ChevronLeft, Eye } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can, ROLES, type Role } from '@/lib/auth/rbac'
import { portalView } from '@/lib/portal/views'
import { CategoryIcon, firstName, greeting } from '@/components/portal/bits'
import { PortalSearch } from '@/components/portal/search'
import { SharePortalButton } from '@/components/portal/share'
import { Attention, AttentionSkeleton } from '@/components/portal/attention'
import { roleHe } from '@/lib/portal/who'

export const dynamic = 'force-dynamic'

/**
 * Spec page 1 (computer) and page 2 (phone): a greeting, one search, the
 * category cards, one primary action. On a computer each card also lists its
 * actions, so a common job is one tap; on a phone a card is one big button
 * that opens its category, so the screen is never a wall of links.
 */
export default async function PortalHome({ searchParams }: { searchParams?: { as?: string } }) {
  const s = await getSession()
  if (!s) redirect('/login')
  // Preview as another role (link management). Presentation only: every destination still checks the real person.
  const asRole = searchParams?.as && (ROLES as readonly string[]).includes(searchParams.as) && can(s.user.role, 'portal:manage', s.overrides) ? (searchParams.as as Role) : null
  const role = asRole ?? s.user.role
  const { categories, search, problem } = await portalView(role, asRole ? undefined : s.overrides)
  const manager = !asRole && can(s.user.role, 'integrations:read', s.overrides)
  const name = firstName(s.user.name)

  return (
    <>
      {asRole ? (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-forest/30 bg-sage-soft px-4 py-3 text-sm text-forest">
          <Eye aria-hidden className="size-5 shrink-0" />
          <span className="flex-1">תצוגה מקדימה: כך רואה את הפורטל {roleHe(asRole)}.</span>
          <Link href="/portal/manage" className="inline-flex h-11 items-center rounded-full bg-surface px-4 font-medium text-ink hover:bg-sunken">חזרה לניהול הקישורים</Link>
        </div>
      ) : null}
      {problem?.kind === 'error' ? (
        <p role="alert" className="mb-5 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          רשימת הקישורים המעודכנת לא נטענה כרגע, ולכן מוצגת רשימת ברירת המחדל.
        </p>
      ) : null}

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">
            {greeting()}, {name ?? 'צוות JAS'}
          </h1>
          <p className="mt-1 text-base text-muted">מה עושים היום?</p>
        </div>
        {/* Computer: top corner. Phone: under the cards (spec page 2), so the categories are the first thing seen. */}
        <div className="hidden sm:block">
          <SharePortalButton />
        </div>
      </div>

      <PortalSearch items={search}>
        {manager ? (
          <div className="mt-5">
            <Suspense fallback={<AttentionSkeleton />}>
              <Attention inventory={can(s.user.role, 'inventory:read', s.overrides)} />
            </Suspense>
          </div>
        ) : null}
        {categories.length ? (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {categories.map((c) => (
              <li key={c.id} className="flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-card">
                <Link href={`/portal/c/${c.id}`} className="group flex min-h-28 flex-col gap-3 rounded-lg p-4 hover:bg-sunken sm:min-h-0 sm:flex-row sm:items-center">
                  <CategoryIcon icon={c.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold leading-tight text-ink">{c.title}</span>
                    <span className="mt-1 block text-xs text-muted sm:text-sm">
                      <span className="sm:hidden">{c.actions.length === 1 ? 'פעולה אחת' : `${c.actions.length} פעולות`}</span>
                      <span className="hidden sm:inline">{c.subtitle}</span>
                    </span>
                  </span>
                  <ChevronLeft aria-hidden className="hidden size-5 shrink-0 text-muted sm:block" />
                </Link>
                {/* Computer only: the category's actions right on the card, one tap each. */}
                <ul className="hidden flex-wrap gap-2 border-t border-line/70 px-4 pb-4 pt-3 sm:flex">
                  {c.actions.slice(0, 4).map((a) => (
                    <li key={a.id}>
                      {a.external ? (
                        <a href={a.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center rounded-full bg-sage-soft/70 px-3.5 text-sm font-medium text-forest hover:bg-sage-soft">
                          {a.title}
                        </a>
                      ) : (
                        <Link href={a.href} className="inline-flex h-11 items-center rounded-full bg-sage-soft/70 px-3.5 text-sm font-medium text-forest hover:bg-sage-soft">
                          {a.title}
                        </Link>
                      )}
                    </li>
                  ))}
                  {c.actions.length > 4 ? (
                    <li>
                      <Link href={`/portal/c/${c.id}`} className="inline-flex h-11 items-center rounded-full px-3 text-sm text-muted underline-offset-4 hover:underline">
                        עוד {c.actions.length - 4}
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-lg border border-line bg-surface p-5 text-base text-muted">עוד לא הוגדרו לך פעולות בפורטל. כדאי לפנות למנהלת הפורטל.</p>
        )}
        <div className="mt-6 sm:hidden">
          <SharePortalButton />
        </div>
      </PortalSearch>
    </>
  )
}
