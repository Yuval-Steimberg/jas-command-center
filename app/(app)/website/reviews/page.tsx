import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsiteReviews, type ReviewFilter } from '@/lib/integrations/website/manage'
import { BulkModerate, ReviewActions, ReviewReplyForm } from '../review-forms'

export const dynamic = 'force-dynamic'

const FILTERS: [ReviewFilter, string][] = [
  ['pending', 'Waiting for approval'],
  ['approved', 'On the site'],
  ['', 'All'],
]

export default async function WebsiteReviewsPage({ searchParams }: { searchParams?: { status?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const pii = can(s.user.role, 'website:read_pii', s.overrides)
  const status: ReviewFilter = searchParams?.status === 'approved' ? 'approved' : searchParams?.status === 'all' ? '' : 'pending'
  const r = await listWebsiteReviews(status)
  return (
    <>
      <PageHeader title="Website reviews" description="Customer reviews submitted on the website. Approving shows a review on the site; hiding takes it off again; deleting removes it for good." />
      <p className="mb-4 text-sm">
        <Link href="/website" className="underline-offset-2 hover:underline">← Website & shop</Link> · <Link href="/website/products" className="underline-offset-2 hover:underline">Products</Link> · <Link href="/website/content" className="underline-offset-2 hover:underline">Content</Link>
      </p>
      <nav aria-label="Review filter" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([v, label]) => (
          <Link
            key={label}
            href={`/website/reviews?status=${v || 'all'}`}
            aria-current={v === status ? 'page' : undefined}
            className={v === status ? 'rounded-full bg-forest px-3 py-2 text-sm font-medium text-cream' : 'rounded-full border border-line px-3 py-2 text-sm hover:bg-sunken'}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader title="Reviews" meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          {r.state !== 'ok' ? (
            <SourceProblem result={r} what="Website reviews" />
          ) : !r.data.length ? (
            <p className="text-sm text-muted">{status === 'pending' ? 'No reviews are waiting for approval.' : 'No reviews.'}</p>
          ) : (
            <>
              {write ? <div className="mb-3"><BulkModerate /></div> : <p className="mb-3 text-sm text-muted">Your role can view reviews but not moderate them.</p>}
              <ul className="divide-y divide-line/70">
                {r.data.map((v) => (
                  <li key={v.id} className="flex gap-3 py-3">
                    {write ? (
                      <label className="flex min-h-11 min-w-11 items-start justify-center pt-1">
                        <span className="sr-only">Select review by {v.customer_name}</span>
                        <input type="checkbox" name="id" value={v.id} form="reviews-bulk" className="h-4 w-4" />
                      </label>
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span aria-label={`${v.rating} out of 5`} className="num font-semibold">{v.rating}/5</span>
                        <span dir="auto" className="font-medium">{v.customer_name}</span>
                        {pii && v.customer_email ? <span dir="ltr" className="text-xs text-muted">{v.customer_email}</span> : null}
                        <span className={v.approved ? 'rounded-full border border-line px-2 py-0.5 text-xs' : 'rounded-full border border-line px-2 py-0.5 text-xs text-bad'}>{v.approved ? 'on the site' : 'waiting'}</span>
                        <span className="text-xs text-muted">{new Date(v.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem' })}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted" dir="auto">{v.product?.name_he ?? 'General review'}</p>
                      {v.title ? <p dir="auto" className="mt-2 font-medium">{v.title}</p> : null}
                      {v.content ? <p dir="auto" className="mt-1 whitespace-pre-wrap break-words">{v.content}</p> : null}
                      {write ? (
                        <div className="mt-3 flex flex-col gap-3">
                          <ReviewActions id={v.id} approved={v.approved} />
                          <ReviewReplyForm id={v.id} reply={v.reply} />
                        </div>
                      ) : v.reply ? (
                        <p dir="auto" className="mt-2 border-s-2 border-line ps-3 text-muted">{v.reply}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {r.data.length === 300 ? <p className="mt-2 text-meta text-muted">Showing the 300 newest.</p> : null}
            </>
          )}
        </CardBody>
      </Card>
    </>
  )
}
