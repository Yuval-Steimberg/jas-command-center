import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { StatusBadge } from '@/components/ui/status'
import { CapabilityList } from '@/components/capabilities'
import { giftCardsAdapter, getGiftCardHealth, getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { requirePageAccess } from '@/lib/auth/session'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function GiftCardsPage() {
  await requirePageAccess('gift_cards:read')
  const [summary, health] = await Promise.all([getGiftCardSummary(), getGiftCardHealth()])
  return (
    <>
      <PageHeader
        title="Gift cards"
        description="Figures come from the Gift Card System's own admin statistics, so a sale has one definition. Face value sold, outstanding liability and redeemed value are separate numbers and are never added together."
      />
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
                <CardBody className="border-t border-line/70 text-xs text-muted">
                  Fix individual cards in the Gift Card System admin (resend, edit recipient, mark paid). Doing it from here is planned and will call those same actions.
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
