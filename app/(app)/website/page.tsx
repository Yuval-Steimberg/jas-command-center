import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { CapabilityList } from '@/components/capabilities'
import { kpiChange, kpiSub, kpiText } from '@/components/summaries/website'
import { getWebsiteSnapshot, websiteAdapter } from '@/lib/integrations/website/adapter'
import { requirePageAccess } from '@/lib/auth/session'
import { presetFrom, resolveRange } from '@/lib/range'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { formatCount, formatPct } from '@/lib/format'

export const dynamic = 'force-dynamic'

const ils = (v: number) => formatAgorot(shekelsToAgorot(v), { whole: true })
const FUNNEL: Record<string, string> = { sessions: 'Sessions', shop: 'Reached shop', product_view: 'Viewed a product', add_to_cart: 'Added to cart', begin_checkout: 'Started checkout', purchase: 'Paid order' }

export default async function WebsitePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePageAccess('website:read')
  const range = resolveRange(presetFrom(searchParams))
  const r = await getWebsiteSnapshot(range)
  return (
    <>
      <PageHeader
        title="Website & shop"
        description="Read from the website's own analytics engine. Revenue comes only from orders in a paid status; checkout and cart events are never counted as sales."
      />
      <p className="mb-4 text-sm"><Link href="/website/orders" className="underline-offset-2 hover:underline">Orders</Link> · <Link href="/website/products" className="underline-offset-2 hover:underline">Products</Link> · <Link href="/website/content" className="underline-offset-2 hover:underline">Content &amp; shop hours</Link> · <Link href="/website/reviews" className="underline-offset-2 hover:underline">Reviews</Link> · <Link href="/website/blog" className="underline-offset-2 hover:underline">Blog</Link></p>
      {r.state !== 'ok' ? (
        <SourceProblem result={r} what="Website analytics" />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            {r.data.range.from} – {r.data.range.to} vs {r.data.compare.from} – {r.data.compare.to} · <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />
            {r.data.coverage.current !== 'ok' ? ` · tracking coverage: ${r.data.coverage.current}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {(
              [
                ['Revenue', 'revenue', ils],
                ['Paid orders', 'orders', formatCount],
                ['Average order', 'aov', ils],
                ['Conversion', 'conversionRate', (v: number) => formatPct(v)],
                ['Visitors', 'visitors', formatCount],
                ['Sessions', 'sessions', formatCount],
                ['Product views', 'productViews', formatCount],
                ['Add to cart', 'addToCarts', formatCount],
                ['Checkouts started', 'checkouts', formatCount],
                ['Checkout completion', 'checkoutCompletionRate', (v: number) => formatPct(v)],
                ['Abandoned carts', 'abandonedCarts', formatCount],
                ['Payment failures', 'paymentFailures', formatCount],
              ] as const
            ).map(([label, key, f]) => {
              const k = r.data.kpis[key]
              return <Kpi key={key} label={label} value={kpiText(k, f)} change={kpiChange(k)} sub={kpiSub(k)} lowerIsBetter={key === 'paymentFailures' || key === 'abandonedCarts'} />
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Sales" meta="Verified = confirmed by a signed Grow webhook" />
              <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Kpi label="Verified revenue" value={ils(r.data.sales.verifiedRevenue)} />
                <Kpi label="Unverified revenue" value={ils(r.data.sales.unverifiedRevenue)} tone={r.data.sales.unverifiedRevenue > 0 ? 'warn' : undefined} />
                <Kpi label="Discounts" value={ils(r.data.sales.grossSales - r.data.sales.netSales)} />
                <Kpi label="Stuck in pending" value={formatCount(r.data.sales.pendingStale)} tone={r.data.sales.pendingStale ? 'warn' : undefined} />
                <Kpi label="Cancelled" value={formatCount(r.data.sales.cancelled)} />
                <Kpi label="Refunds / fees" value="not tracked" hint="The website does not store refunds, tax or processing fees." />
              </CardBody>
              <CardBody className="border-t border-line/70">
                <table className="w-full text-sm">
                  <thead className="text-start text-xs text-muted">
                    <tr><th className="py-1 text-start font-medium">Order status</th><th className="text-end font-medium">Orders</th><th className="text-end font-medium">Amount</th></tr>
                  </thead>
                  <tbody className="num">
                    {r.data.sales.statusBreakdown.map((s) => (
                      <tr key={s.status} className="border-t border-line/50"><td className="py-1.5">{s.status}</td><td className="text-end">{formatCount(s.orders)}</td><td className="text-end">{ils(s.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Purchase funnel" meta="Sessions reaching each step" />
              <CardBody>
                <ol className="flex flex-col gap-2">
                  {r.data.funnel.map((f) => {
                    const top = r.data.funnel[0]?.sessions || 1
                    return (
                      <li key={f.key}>
                        <div className="flex justify-between text-sm"><span>{FUNNEL[f.key] ?? f.key}</span><span className="num">{formatCount(f.sessions)} <span className="text-xs text-muted">{f.rateFromPrevious != null ? `· ${formatPct(f.rateFromPrevious)} of previous` : ''}</span></span></div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full bg-sage-deep" style={{ width: `${Math.max(1, (f.sessions / top) * 100)}%` }} /></div>
                      </li>
                    )
                  })}
                </ol>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Acquisition channels" />
              <CardBody>
                <Segments rows={r.data.channels} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Devices" />
              <CardBody>
                <Segments rows={r.data.devices} />
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Website errors" meta="From the site's own error tracking in this period" />
              <CardBody className="grid gap-4 md:grid-cols-3">
                <ErrorList title="JavaScript" rows={r.data.technical.jsErrors.map((e) => [e.message, e.count])} />
                <ErrorList title="API" rows={r.data.technical.apiErrors.map((e) => [`${e.endpoint} → ${e.status}`, e.count])} />
                <ErrorList title="Checkout" rows={r.data.technical.checkoutErrors.map((e) => [e.reason, e.count])} />
              </CardBody>
            </Card>
          </div>
          {r.data.coverage.notes.length ? (
            <ul className="list-disc ps-5 text-xs text-muted">{r.data.coverage.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          ) : null}
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="What this integration can do" />
        <CardBody>
          <CapabilityList items={websiteAdapter.capabilities()} />
        </CardBody>
      </Card>
    </>
  )
}

function Segments({ rows }: { rows: { key: string; sessions: number; orders: number; revenue: number; conversionRate: number | null }[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No sessions in this period.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-sm">
        <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Segment</th><th className="text-end font-medium">Sessions</th><th className="text-end font-medium">Orders</th><th className="text-end font-medium">Conv.</th><th className="text-end font-medium">Revenue</th></tr></thead>
        <tbody className="num">
          {rows.map((s) => (
            <tr key={s.key} className="border-t border-line/50"><td className="py-1.5">{s.key}</td><td className="text-end">{formatCount(s.sessions)}</td><td className="text-end">{formatCount(s.orders)}</td><td className="text-end">{formatPct(s.conversionRate)}</td><td className="text-end">{ils(s.revenue)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ErrorList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      {rows.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.slice(0, 6).map(([m, c]) => (
            <li key={m} className="flex justify-between gap-2"><span className="truncate" title={m}>{m}</span><span className="num shrink-0 text-muted">{c}</span></li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">None recorded.</p>
      )}
    </div>
  )
}
