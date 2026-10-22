import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'

export async function GiftCardsSummary() {
  const r = await getGiftCardSummary()
  return (
    <Card>
      <CardHeader
        title={<Link href="/gift-cards" className="hover:underline">Gift cards</Link>}
        meta={r.state === 'ok' ? <><span>All time · rolling windows</span> · <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /></> : 'Gift Card System'}
      />
      <CardBody>
        {r.state !== 'ok' ? (
          <SourceProblem result={r} what="Gift card figures" />
        ) : (
          (() => {
            const s = r.data.stats
            const d = r.data.deliveryHealth
            const stuck = d.paidNotActivated + d.undelivered + d.unmatchedPayments
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Kpi label="Sold, last 30 days" value={formatCount(s.soldMonth)} sub={`${formatCount(s.soldWeek)} in 7 days`} />
                <Kpi label="Face value sold (all time)" value={formatAgorot(s.totalSalesMinor, { whole: true })} sub={`${formatCount(s.soldTotal)} cards`} hint="Initial value of every paid card; refunds and reissue replacements excluded (gift card system's salesCards())." />
                <Kpi label="Outstanding liability" value={formatAgorot(s.outstandingMinor, { whole: true })} hint="Unredeemed balance on active, partially redeemed and suspended cards." />
                <Kpi label="Redeemed value" value={formatAgorot(s.redeemedMinor, { whole: true })} sub={`${formatCount(s.fullyRedeemed)} fully · ${formatCount(s.partiallyRedeemed)} partly`} />
                <Kpi label="Active cards" value={formatCount(s.active)} sub={s.expiringSoon ? `${s.expiringSoon} expire ≤30 days` : undefined} />
                <Kpi label="Paid, not delivered" value={formatCount(stuck)} tone={stuck ? 'bad' : undefined} sub={`last ${d.windowDays} days`} />
              </div>
            )
          })()
        )}
      </CardBody>
    </Card>
  )
}
