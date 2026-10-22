import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { StatusBadge } from '@/components/ui/status'
import { CapabilityList } from '@/components/capabilities'
import { giftCardsAdapter, getGiftCardHealth, getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import Link from 'next/link'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { formatDateTime } from '@/lib/format'
import { ResendAllForm } from './forms'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'

export const dynamic = 'force-dynamic'

const STATUS_FILTERS = ['active', 'partially_redeemed', 'fully_redeemed', 'awaiting_payment', 'suspended', 'refunded', 'expired', 'cancelled'] as const

async function CardSearch({ q, status, pii }: { q: string; status: string | undefined; pii: boolean }) {
  const r = await searchGiftCards(q, status)
  if (r.state !== 'ok') return <SourceProblem result={r} what="Card search" />
  if (!r.data.items.length) return <p className="text-sm text-muted">No cards match.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-start text-xs text-muted">
          <tr>
            <th className="py-2 pe-3 text-start font-medium">Code</th>
            <th className="py-2 pe-3 text-start font-medium">Status</th>
            <th className="py-2 pe-3 text-end font-medium">Balance / value</th>
            <th className="py-2 pe-3 text-start font-medium">Recipient</th>
            <th className="py-2 text-start font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {r.data.items.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap py-2 pe-3 font-mono text-xs"><Link href={`/gift-cards/${c.id}`} className="underline-offset-2 hover:underline">{c.maskedCode}</Link></td>
              <td className="whitespace-nowrap py-2 pe-3">{c.status.replace(/_/g, ' ')}</td>
              <td className="num whitespace-nowrap py-2 pe-3 text-end">{formatAgorot(c.balanceMinor)} / {formatAgorot(c.initialAmountMinor)}</td>
              <td className="py-2 pe-3" dir="auto">{pii ? c.recipientName : <span className="text-muted">hidden for your role</span>}</td>
              <td className="whitespace-nowrap py-2 text-xs text-muted">{formatDateTime(c.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-meta text-muted">{r.data.total > r.data.items.length ? `Showing ${r.data.items.length} of ${r.data.total}. Narrow the search to see the rest.` : `${r.data.total} card(s).`}</p>
    </div>
  )
}

export default async function GiftCardsPage({ searchParams }: { searchParams?: { q?: string; status?: string } }) {
  await requirePageAccess('gift_cards:read')
  const s = (await getSession())!
  const pii = can(s.user.role, 'gift_cards:read_pii', s.overrides)
  const operate = can(s.user.role, 'gift_cards:operate', s.overrides)
  const q = (typeof searchParams?.q === 'string' ? searchParams.q : '').trim().slice(0, 100)
  const status = STATUS_FILTERS.find((x) => x === searchParams?.status)
  const searching = q.length > 0 || Boolean(status)
  const [summary, health] = await Promise.all([getGiftCardSummary(), getGiftCardHealth()])
  return (
    <>
      <PageHeader
        title="Gift cards"
        description="Figures come from the Gift Card System's own admin statistics, so a sale has one definition. Face value sold, outstanding liability and redeemed value are separate numbers and are never added together."
      />
      <Card className="mb-4">
        <CardHeader title="Find a card" meta={pii ? 'Code, name, email or phone' : 'Code (your role cannot search by customer details)'} />
        <CardBody>
          <form action="/gift-cards" className="mb-3 flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1"><span className="sr-only">Search</span><input name="q" defaultValue={q} dir="auto" maxLength={100} placeholder="Last digits of the code, recipient, buyer email…" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm" /></label>
            <label><span className="sr-only">Status</span>
              <select name="status" defaultValue={status ?? ''} className="h-10 w-full rounded-md border border-line bg-surface px-2 text-sm sm:w-auto">
                <option value="">Any status</option>
                {STATUS_FILTERS.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Search</button>
          </form>
          {searching ? <CardSearch q={pii ? q : q.replace(/[^A-Za-z0-9-]/g, '')} status={status} pii={pii} /> : <p className="text-sm text-muted">Search to list cards. Codes are shown masked; open a card for its delivery history and actions.</p>}
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {summary.state !== 'ok' ? (
            <SourceProblem result={summary} what="Gift card figures" />
          ) : (
            <>
              <Card>
                <CardHeader title="Sales and liability" meta={<Freshness checkedAt={summary.checkedAt} source={summary.source} latencyMs={summary.latencyMs} />} />
                <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Kpi label="Face value sold (all time)" value={formatAgorot(summary.data.stats.totalSalesMinor)} sub={`${formatCount(summary.data.stats.soldTotal)} paid cards`} />
                  <Kpi label="Outstanding liability" value={formatAgorot(summary.data.stats.outstandingMinor)} hint="Balance still owed to customers." />
                  <Kpi label="Redeemed value" value={formatAgorot(summary.data.stats.redeemedMinor)} hint="Value used in store. A redemption is not a new sale." />
                  <Kpi label="Sold last 24 h" value={formatCount(summary.data.stats.soldToday)} />
                  <Kpi label="Sold last 7 days" value={formatCount(summary.data.stats.soldWeek)} />
                  <Kpi label="Sold last 30 days" value={formatCount(summary.data.stats.soldMonth)} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Card status" />
                <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Kpi label="Active" value={formatCount(summary.data.stats.active)} />
                  <Kpi label="Partially redeemed" value={formatCount(summary.data.stats.partiallyRedeemed)} />
                  <Kpi label="Fully redeemed" value={formatCount(summary.data.stats.fullyRedeemed)} />
                  <Kpi label="Suspended" value={formatCount(summary.data.stats.suspended)} />
                  <Kpi label="Refunded" value={formatCount(summary.data.stats.refunded)} />
                  <Kpi label="Expiring within 30 days" value={formatCount(summary.data.stats.expiringSoon)} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Paid but not delivered" meta={`Last ${summary.data.deliveryHealth.windowDays} days — money already taken`} />
                <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Kpi label="Payments matching no card" value={formatCount(summary.data.deliveryHealth.unmatchedPayments)} sub={summary.data.deliveryHealth.unmatchedPayments ? formatAgorot(summary.data.deliveryHealth.unmatchedPaymentsMinor) : undefined} tone={summary.data.deliveryHealth.unmatchedPayments ? 'bad' : undefined} />
                  <Kpi label="Paid, not activated" value={formatCount(summary.data.deliveryHealth.paidNotActivated)} tone={summary.data.deliveryHealth.paidNotActivated ? 'bad' : undefined} />
                  <Kpi label="Active, not delivered" value={formatCount(summary.data.deliveryHealth.undelivered)} tone={summary.data.deliveryHealth.undelivered ? 'bad' : undefined} />
                  <Kpi label="Failed deliveries (all)" value={formatCount(summary.data.stats.failedDeliveries)} />
                </CardBody>
                <CardBody className="flex flex-col gap-2 border-t border-line/70">
                  {operate ? <ResendAllForm count={summary.data.deliveryHealth.undelivered} /> : null}
                  <p className="text-xs text-muted">
                    Resend runs the gift card system&apos;s own resend. Cards whose address bounced need a new recipient: open the card. Marking a card paid stays in the gift card admin.
                  </p>
                </CardBody>
              </Card>
            </>
          )}
          <p className="text-xs text-muted">
            The website checkout also sells gift cards as cart items. Those are website orders, are not in the figures above, and are not issued through the Gift Card System.
          </p>
        </div>
        <Card>
          <CardHeader title="Deployment" />
          <CardBody>
            {health.state !== 'ok' ? (
              <SourceProblem result={health} what="Health endpoint" />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted">Status</dt>
                <dd><StatusBadge status={health.data.ok ? 'operational' : 'degraded'} /></dd>
                <dt className="text-muted">Store</dt>
                <dd>{health.data.store ?? '—'}</dd>
                <dt className="text-muted">Build marker</dt>
                <dd className="font-mono text-xs">{health.data.build ?? '—'}</dd>
                <dt className="text-muted">Migrations</dt>
                <dd>{health.data.migrationsRan == null ? '—' : health.data.migrationsRan ? 'ran' : 'MISSING'}</dd>
                {Object.entries(health.data.checks ?? {}).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words text-xs">{v}</dd></div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="What this integration can do" />
        <CardBody>
          <CapabilityList items={giftCardsAdapter.capabilities()} />
        </CardBody>
      </Card>
    </>
  )
}
