import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsiteCampaigns, listWebsiteDiscounts, listWebsiteSubscribers, type WebsiteDiscount } from '@/lib/integrations/website/manage'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { CampaignForm, DeleteDiscount, DeleteSubscriber, DiscountForm } from '../marketing-forms'

export const dynamic = 'force-dynamic'
/** Sending a campaign waits for the website to finish emailing. */
export const maxDuration = 60

const ils = (v: number) => formatAgorot(shekelsToAgorot(v))
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', year: 'numeric' })

/** Why checkout would refuse the code today, mirroring the website's couponError. */
function blocked(d: WebsiteDiscount, now: Date) {
  if (!d.active) return 'inactive'
  if (d.expiresAt && new Date(d.expiresAt).getTime() < now.getTime()) return 'expired'
  if (d.usageLimit != null && (d.usedCount ?? 0) >= d.usageLimit) return 'used up'
  return null
}

export default async function WebsiteMarketingPage({ searchParams }: { searchParams?: { q?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'website:write', s.overrides)
  const pii = can(s.user.role, 'website:read_pii', s.overrides)
  const q = (typeof searchParams?.q === 'string' ? searchParams.q : '').trim().slice(0, 100)
  const [codes, subs, campaigns] = await Promise.all([listWebsiteDiscounts(), pii ? listWebsiteSubscribers(q) : null, listWebsiteCampaigns()])
  const now = new Date()
  return (
    <>
      <PageHeader title="Website marketing" description="Discount codes used at checkout, newsletter subscribers and the history of sent campaigns, from the website manager's marketing tab." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Discount codes" meta={codes.state === 'ok' ? <Freshness checkedAt={codes.checkedAt} source={codes.source} latencyMs={codes.latencyMs} /> : undefined} />
          <CardBody>
            {codes.state !== 'ok' ? (
              <SourceProblem result={codes} what="Discount codes" />
            ) : (
              <div className="flex flex-col gap-4">
                {!codes.data.length ? <p className="text-sm text-muted">No discount codes yet.</p> : (
                  <ul className="divide-y divide-line/70">
                    {codes.data.map((d) => {
                      const why = blocked(d, now)
                      return (
                        <li key={d.code} className="py-2">
                          <details>
                            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                              <span dir="ltr" className="font-mono font-medium">{d.code}</span>
                              <span className="num">{d.type === 'percent' ? `${d.value}% off` : `${ils(d.value)} off`}</span>
                              {d.minOrder ? <span className="text-xs text-muted">min {ils(d.minOrder)}</span> : null}
                              <span className="num text-xs text-muted">used {d.usedCount ?? 0}{d.usageLimit ? ` / ${d.usageLimit}` : ''}</span>
                              {d.expiresAt ? <span className="text-xs text-muted">until {day(d.expiresAt)}</span> : null}
                              <span className={why ? 'rounded-full border border-line px-2 py-0.5 text-xs text-bad' : 'rounded-full border border-line px-2 py-0.5 text-xs text-ok'}>{why ?? 'works at checkout'}</span>
                            </summary>
                            <div className="mt-3 flex flex-col gap-4 pb-2">
                              {d.notes ? <p dir="auto" className="text-xs text-muted">{d.notes}</p> : null}
                              {write ? (
                                <>
                                  <DiscountForm d={d} />
                                  <DeleteDiscount d={d} />
                                </>
                              ) : <p className="text-xs text-muted">Your role can view codes but not change them.</p>}
                            </div>
                          </details>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {write ? (
                  <details className="rounded-md border border-line p-3">
                    <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">New discount code</summary>
                    <div className="mt-3"><DiscountForm /></div>
                  </details>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Newsletter subscribers" meta={subs?.state === 'ok' ? <Freshness checkedAt={subs.checkedAt} source={subs.source} latencyMs={subs.latencyMs} /> : undefined} />
          <CardBody>
            {!subs ? (
              <p className="text-sm text-muted">Subscriber emails are customer details; your role cannot see them.</p>
            ) : subs.state !== 'ok' ? (
              <SourceProblem result={subs} what="Newsletter subscribers" />
            ) : (
              <>
                <form action="/website/marketing" className="mb-3 flex flex-col gap-2 sm:flex-row">
                  <label className="min-w-0 flex-1"><span className="sr-only">Search subscribers</span><input name="q" defaultValue={q} dir="ltr" maxLength={100} placeholder="Email contains…" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm" /></label>
                  <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Search</button>
                </form>
                <p className="mb-2 text-sm"><span className="num font-medium">{subs.data.total}</span> {q ? 'matching' : 'subscribed'}{subs.data.subscribers.length < subs.data.total ? ` · showing the newest ${subs.data.subscribers.length}` : ''}</p>
                {subs.data.subscribers.length ? (
                  <ul className="divide-y divide-line/70">
                    {subs.data.subscribers.map((x) => (
                      <li key={x.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span dir="ltr" className="min-w-0 break-all">{x.email}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-xs text-muted">{day(x.created_at)}</span>
                          {write ? <DeleteSubscriber id={x.id} email={x.email} /> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">No subscribers{q ? ' match' : ''}.</p>}
              </>
            )}
          </CardBody>
        </Card>

        {write ? (
          <Card>
            <CardHeader title="Send a campaign" />
            <CardBody><CampaignForm subscribers={subs?.state === 'ok' && !q ? subs.data.total : null} me={s.user.email} /></CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Sent campaigns" meta={campaigns.state === 'ok' ? <Freshness checkedAt={campaigns.checkedAt} source={campaigns.source} latencyMs={campaigns.latencyMs} /> : undefined} />
          <CardBody>
            {campaigns.state !== 'ok' ? (
              <SourceProblem result={campaigns} what="Campaign history" />
            ) : campaigns.data.length ? (
              <ul className="divide-y divide-line/70">
                {campaigns.data.map((c) => (
                  <li key={c.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span dir="auto" className="min-w-0 flex-1 truncate">{c.subject}</span>
                    <span className="num text-xs text-muted">{c.status === 'sending' ? 'sending or interrupted' : `${c.recipients} recipients`}{typeof c.failed === 'number' && c.failed ? ` · ${c.failed} failed` : ''} · {day(c.sentAt)}{typeof c.sentBy === 'string' ? ` · ${c.sentBy}` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No campaigns sent yet.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
