import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import type { KpiValue } from '@/lib/integrations/website/contract'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { formatChange, formatCount, formatPct } from '@/lib/format'
import type { DateRange } from '@/lib/time'

/** Shows a website KPI with the website's own availability label; never zero-fills. */
export function kpiText(k: KpiValue, f: (n: number) => string): string {
  if (k.status === 'unavailable' || k.value == null) return 'n/a'
  return f(k.value)
}
export const kpiSub = (k: KpiValue) => (k.status === 'partial' ? 'partial data' : k.status === 'unavailable' ? 'not tracked' : undefined)
// Percent change only when the website says both periods are fully tracked.
export const kpiChange = (k: KpiValue) => (k.status === 'ok' && k.previousStatus === 'ok' ? formatChange(k.change) : null)

export async function WebsiteSummary({ range, label }: { range: DateRange; label: string }) {
  const r = await getWebsiteSnapshot(range)
  return (
    <Card>
      <CardHeader
        title={<Link href="/website" className="hover:underline">Website & shop</Link>}
        meta={r.state === 'ok' ? <><span>{label}</span> · <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /></> : label}
      />
      <CardBody>
        {r.state !== 'ok' ? (
          <SourceProblem result={r} what="Website analytics" />
        ) : (
          (() => {
            const k = r.data.kpis
            const s = r.data.sales
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Kpi label="Revenue (paid orders)" value={kpiText(k.revenue, (v) => formatAgorot(shekelsToAgorot(v), { whole: true }))} change={kpiChange(k.revenue)} sub={s.unverifiedRevenue > 0 ? `${formatAgorot(shekelsToAgorot(s.unverifiedRevenue), { whole: true })} unverified` : kpiSub(k.revenue)} hint="Orders in paid/processing/shipped/delivered, bucketed by paid_at. Unverified = marked paid without a verified Grow webhook." />
                <Kpi label="Paid orders" value={kpiText(k.orders, formatCount)} change={kpiChange(k.orders)} sub={kpiSub(k.orders)} />
                <Kpi label="Sessions" value={kpiText(k.sessions, formatCount)} change={kpiChange(k.sessions)} sub={kpiSub(k.sessions)} />
                <Kpi label="Conversion" value={kpiText(k.conversionRate, (v) => formatPct(v))} change={kpiChange(k.conversionRate)} sub={kpiSub(k.conversionRate)} />
                <Kpi label="Checkouts started" value={kpiText(k.checkouts, formatCount)} change={kpiChange(k.checkouts)} sub={kpiSub(k.checkouts)} />
                <Kpi label="Payment failures" value={kpiText(k.paymentFailures, formatCount)} lowerIsBetter change={kpiChange(k.paymentFailures)} tone={(k.paymentFailures.value ?? 0) > 0 ? 'warn' : undefined} />
              </div>
            )
          })()
        )}
      </CardBody>
    </Card>
  )
}
