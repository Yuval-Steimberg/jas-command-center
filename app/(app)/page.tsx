import Link from 'next/link'
import { Suspense } from 'react'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status'
import { CardSkeleton } from '@/components/skeleton'
import { AlertsList } from '@/components/alerts-list'
import { WebsiteSummary } from '@/components/summaries/website'
import { GiftCardsSummary } from '@/components/summaries/gift-cards'
import { FurnitureSummary } from '@/components/summaries/furniture'
import { DesignAgentSummary } from '@/components/summaries/design-agent'
import { MapSummary } from '@/components/summaries/map'
import { visibleAlerts, liveHealth } from '@/lib/live'
import { ADAPTERS } from '@/lib/integrations/registry'
import { presetFrom, resolveRange } from '@/lib/range'
import { getSession, requireUser } from '@/lib/auth/session'
import { can, type Product } from '@/lib/auth/rbac'
import { timeAgo } from '@/lib/format'
import { activityFeed } from '@/lib/activity/feed'
import { ActivityList } from '@/components/activity-feed'

export const dynamic = 'force-dynamic'

async function Attention() {
  const alerts = await visibleAlerts()
  return (
    <Card>
      <CardHeader title="Needs attention" meta={`${alerts.length} item${alerts.length === 1 ? '' : 's'}`} />
      <CardBody>
        <AlertsList alerts={alerts} limit={6} />
      </CardBody>
    </Card>
  )
}

async function Activity() {
  const s = (await getSession())!
  const feed = await activityFeed((p) => can(s.user.role, p, s.overrides), 15)
  return (
    <Card>
      <CardHeader title="Activity feed" meta="Alerts, actions taken here, and timestamped source records" />
      <CardBody>
        <ActivityList feed={feed} />
      </CardBody>
    </Card>
  )
}

async function Health() {
  const health = await liveHealth()
  return (
    <Card>
      <CardHeader title="System health" meta="Live probes of each running service" action={<Link href="/integrations" className="text-xs text-muted underline-offset-2 hover:underline">Details</Link>} />
      <CardBody>
        <ul className="divide-y divide-line/70">
          {health.map((h) => {
            const a = ADAPTERS.find((x) => x.product === h.product)!
            const last = h.checks.map((c) => c.checkedAt).filter(Boolean).sort().at(-1) ?? null
            return (
              <li key={h.product} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{a.name}</div>
                  <div className="text-meta text-muted">{last ? `checked ${timeAgo(last)}` : 'not checked — not configured'}</div>
                </div>
                <StatusBadge status={h.status} />
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

export default async function OverviewPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const user = await requireUser()
  const overrides = (await getSession())?.overrides
  const sees = (p: Product) => can(user.role, `${p}:read`, overrides)
  const range = resolveRange(presetFrom(searchParams))
  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${user.name.split(' ')[0]}`}
        description="Live state of every connected Just A Second system. Each card reads its own source; a source that is not connected says so instead of showing zero."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<CardSkeleton rows={2} />}>
            <Attention />
          </Suspense>
        </div>
        <Suspense fallback={<CardSkeleton rows={2} />}>
          <Health />
        </Suspense>
      </div>

      {sees('website') || sees('gift_cards') ? (<>
      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Revenue sources</h2>
      <p className="mb-3 max-w-3xl text-xs text-muted">
        Website and gift-card figures are shown side by side and never summed: they are separate systems with different periods, and the website checkout also sells its own gift
        cards, which would be counted twice.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {sees('website') ? (
          <Suspense fallback={<CardSkeleton />}>
            <WebsiteSummary range={range} label={range.label} />
          </Suspense>
        ) : null}
        {sees('gift_cards') ? (
          <Suspense fallback={<CardSkeleton />}>
            <GiftCardsSummary />
          </Suspense>
        ) : null}
      </div>
      </>) : null}

      <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Operations</h2>
      <div className="grid gap-4 xl:grid-cols-3">
        {sees('furniture') ? (
          <Suspense fallback={<CardSkeleton rows={2} />}>
            <FurnitureSummary />
          </Suspense>
        ) : null}
        {sees('design_agent') ? (
          <Suspense fallback={<CardSkeleton rows={2} />}>
            <DesignAgentSummary />
          </Suspense>
        ) : null}
        {sees('map') ? (
          <Suspense fallback={<CardSkeleton rows={1} />}>
            <MapSummary />
          </Suspense>
        ) : null}
      </div>

      <div className="mt-6">
        <Suspense fallback={<CardSkeleton rows={4} />}>
          <Activity />
        </Suspense>
      </div>
    </>
  )
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).format(new Date()))
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
}
