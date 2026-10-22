import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { getSession, requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { searchEverything } from '@/lib/search/search'
import { MAX_QUERY, MIN_QUERY } from '@/lib/search/match'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: { searchParams?: { q?: string | string[] } }) {
  await requireUser()
  const session = (await getSession())!
  const raw = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q
  const q = (raw ?? '').trim().slice(0, MAX_QUERY)
  const groups = q.length >= MIN_QUERY ? await searchEverything(q, (p) => can(session.user.role, p, session.overrides)) : null
  const total = groups?.reduce((n, g) => n + g.results.length, 0) ?? 0

  return (
    <>
      <PageHeader title="Search" description="Searches every connected system you can read. A system that could not be searched says so; it is never shown as an empty result." />
      <form action="/search" className="mb-4 flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search</span>
          <input name="q" defaultValue={q} dir="auto" autoFocus maxLength={MAX_QUERY} placeholder="Project, place, design, page…" className="h-11 w-full rounded-md border border-line bg-surface px-3" />
        </label>
        <button className="h-11 shrink-0 rounded-full bg-brand px-5 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream">Search</button>
      </form>
      {!groups ? (
        <p className="text-sm text-muted">Type at least {MIN_QUERY} characters.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {total} result{total === 1 ? '' : 's'} for <span dir="auto" className="font-medium text-ink">“{q}”</span>
          </p>
          {groups.map((g) => (
            <Card key={g.key}>
              <CardHeader title={g.label} meta={g.state === 'ok' ? `${g.results.length}` : g.state === 'unsupported' ? 'Not searchable yet' : g.state === 'not_configured' ? 'Not connected' : 'Could not search'} />
              <CardBody>
                {g.state !== 'ok' ? (
                  <p className={g.state === 'error' ? 'text-sm text-bad' : 'text-sm text-muted'}>{g.note}</p>
                ) : g.results.length ? (
                  <ul className="divide-y divide-line/70">
                    {g.results.map((r, i) => (
                      <li key={`${r.href}-${i}`} className="py-2">
                        <Link href={r.href} className="block rounded underline-offset-2 hover:underline">
                          <span dir="auto" className="text-sm text-ink">{r.title}</span>
                          {r.subtitle ? <span dir="auto" className="block text-meta text-muted">{r.subtitle}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No matches.</p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
