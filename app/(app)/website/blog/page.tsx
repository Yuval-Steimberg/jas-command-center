import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsitePosts } from '@/lib/integrations/website/manage'

export const dynamic = 'force-dynamic'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem' }) : '—')

export default async function WebsiteBlogPage({ searchParams }: { searchParams?: { deleted?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const r = await listWebsitePosts()
  return (
    <>
      <PageHeader title="Website blog" description="Posts stored in the website's database (the manager's בלוג tab). Guides that ship with the website's code are not listed here; a post with the same address replaces one." />
      <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {write ? <Link href="/website/blog/new" className="ms-auto inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream">New post</Link> : null}
      </p>
      {searchParams?.deleted ? <p role="status" className="mb-3 text-sm text-ok">Post deleted.</p> : null}
      <Card>
        <CardHeader title="Posts" meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          {r.state !== 'ok' ? (
            <SourceProblem result={r} what="Website blog" />
          ) : !r.data.length ? (
            <p className="text-sm text-muted">No posts in the database yet.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {r.data.map((p) => (
                <li key={p.id}>
                  <Link href={`/website/blog/${p.id}`} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm hover:bg-sunken">
                    <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{p.title_he}</span>
                    <span className={p.published ? 'rounded-full border border-line px-2 py-0.5 text-xs' : 'rounded-full border border-line px-2 py-0.5 text-xs text-muted'}>{p.published ? 'published' : 'draft'}</span>
                    {p.featured ? <span className="rounded-full border border-line px-2 py-0.5 text-xs">featured</span> : null}
                    <span className="text-xs text-muted">{day(p.published_at ?? p.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  )
}
