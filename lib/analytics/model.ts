/**
 * The analytics workspace's one data model. Pure: page, CSV export and tests all
 * read the same `AnalyticsReport`, so an exported number is the number on screen.
 *
 * Rules carried here, not in the page:
 * - Every value comes from a source read; a source that did not answer gives
 *   `null` with quality `unavailable`, never 0.
 * - Sections never combine: website ₪ revenue and gift-card face value are
 *   different things sold to different people, and are never added.
 * - `basis` says what a number is about: the selected period (compared with the
 *   one before), the state right now, or a source's own fixed window.
 */
import type { SourceResult } from '@/lib/integrations/types'
import type { MetricsSnapshot, KpiValue, DailyPoint, WEBSITE_KPIS } from '@/lib/integrations/website/contract'
import type { GiftCardSales, GiftCardSummary } from '@/lib/integrations/gift-cards/contract'
import type { DesignAgentActivity, DesignAgentHealthz } from '@/lib/integrations/design-agent/adapter'
import type { FurnitureProject } from '@/lib/integrations/furniture/adapter'
import type { Product } from '@/lib/auth/rbac'
import { shekelsToAgorot } from '@/lib/money'
import { israelDate, type DateRange } from '@/lib/time'

export type Unit = 'agorot' | 'count' | 'ratio'
export type Basis = 'period' | 'now'
export type Quality = 'ok' | 'partial' | 'unavailable'

export interface Metric {
  id: string
  label: string
  unit: Unit
  basis: Basis
  value: number | null
  /** Same metric in the previous period. Always null for basis `now`. */
  previous: number | null
  quality: Quality
  /** Key into the section's `sources`. */
  source: string
  lowerIsBetter?: boolean
  note?: string
}

export interface SeriesPoint {
  date: string
  value: number | null
  previousDate: string | null
  previous: number | null
}
export interface Series {
  id: string
  label: string
  unit: Unit
  points: SeriesPoint[]
}

export interface SourceInfo {
  key: string
  label: string
  state: 'ok' | 'not_configured' | 'error'
  detail: string | null
  checkedAt: string | null
  latencyMs: number | null
}

export type Cell = string | number | null
export interface Table {
  id: string
  title: string
  columns: { key: string; label: string; unit?: Unit }[]
  rows: Record<string, Cell>[]
}

export interface Section {
  product: Product
  title: string
  sources: SourceInfo[]
  metrics: Metric[]
  series: Series[]
  tables: Table[]
  notes: string[]
}

export interface AnalyticsReport {
  range: DateRange
  previous: DateRange
  generatedAt: string
  sections: Section[]
}

/** Change from previous to value. Ratios compare in percentage points, everything else relative. */
export function change(m: Pick<Metric, 'value' | 'previous' | 'unit'>): { delta: number; relative: number | null } | null {
  if (m.value == null || m.previous == null) return null
  const delta = m.value - m.previous
  return { delta, relative: m.unit === 'ratio' || m.previous === 0 ? null : delta / Math.abs(m.previous) }
}

export function sourceInfo<T>(key: string, label: string, r: SourceResult<T>): SourceInfo {
  if (r.state === 'ok') return { key, label, state: 'ok', detail: r.source, checkedAt: r.checkedAt, latencyMs: r.latencyMs }
  if (r.state === 'not_configured') return { key, label, state: 'not_configured', detail: `needs ${r.missing.join(', ')}`, checkedAt: null, latencyMs: null }
  return { key, label, state: 'error', detail: r.error, checkedAt: r.checkedAt, latencyMs: r.latencyMs }
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

// ---------------------------------------------------------------- website

const WEB_KPIS: { key: (typeof WEBSITE_KPIS)[number]; id: string; label: string; unit: Unit; ils?: true; lowerIsBetter?: true }[] = [
  { key: 'revenue', id: 'web.revenue', label: 'Revenue', unit: 'agorot', ils: true },
  { key: 'orders', id: 'web.orders', label: 'Paid orders', unit: 'count' },
  { key: 'aov', id: 'web.aov', label: 'Average order', unit: 'agorot', ils: true },
  { key: 'conversionRate', id: 'web.conversion', label: 'Conversion', unit: 'ratio' },
  { key: 'visitors', id: 'web.visitors', label: 'Visitors', unit: 'count' },
  { key: 'sessions', id: 'web.sessions', label: 'Sessions', unit: 'count' },
  { key: 'pageviews', id: 'web.pageviews', label: 'Page views', unit: 'count' },
  { key: 'productViews', id: 'web.productViews', label: 'Product views', unit: 'count' },
  { key: 'addToCarts', id: 'web.addToCarts', label: 'Add to cart', unit: 'count' },
  { key: 'checkouts', id: 'web.checkouts', label: 'Checkouts started', unit: 'count' },
  { key: 'checkoutCompletionRate', id: 'web.checkoutCompletion', label: 'Checkout completion', unit: 'ratio' },
  { key: 'cartAbandonmentRate', id: 'web.cartAbandonment', label: 'Cart abandonment', unit: 'ratio', lowerIsBetter: true },
  { key: 'paymentFailures', id: 'web.paymentFailures', label: 'Payment failures', unit: 'count', lowerIsBetter: true },
]

const FUNNEL_LABELS: Record<string, string> = { sessions: 'Sessions', shop: 'Reached shop', product_view: 'Viewed a product', add_to_cart: 'Added to cart', begin_checkout: 'Started checkout', purchase: 'Paid order' }

function webValue(k: KpiValue, which: 'value' | 'previous', ils?: boolean): number | null {
  const v = k[which]
  const status = which === 'value' ? k.status : k.previousStatus
  if (v == null || status === 'unavailable') return null
  return ils ? shekelsToAgorot(v) : v
}

function alignDaily(cur: DailyPoint[], prev: DailyPoint[], pick: (d: DailyPoint) => number | null): SeriesPoint[] {
  return cur.map((d, i) => {
    const p = prev[i]
    return { date: d.date, value: pick(d), previousDate: p?.date ?? null, previous: p ? pick(p) : null }
  })
}

export function websiteSection(r: SourceResult<MetricsSnapshot>): Section {
  const src = sourceInfo('website', 'Website analytics', r)
  const base: Section = { product: 'website', title: 'Website & shop', sources: [src], metrics: [], series: [], tables: [], notes: [] }
  if (r.state !== 'ok') {
    base.metrics = WEB_KPIS.map((k) => ({ id: k.id, label: k.label, unit: k.unit, basis: 'period', value: null, previous: null, quality: 'unavailable', source: 'website', lowerIsBetter: k.lowerIsBetter }))
    return base
  }
  const s = r.data
  base.metrics = WEB_KPIS.map((k) => {
    const kv: KpiValue = s.kpis[k.key]
    const quality: Quality = kv.status === 'ok' ? (kv.previousStatus === 'ok' ? 'ok' : 'partial') : kv.status
    return {
      id: k.id,
      label: k.label,
      unit: k.unit,
      basis: 'period',
      value: webValue(kv, 'value', k.ils),
      previous: webValue(kv, 'previous', k.ils),
      quality,
      source: 'website',
      lowerIsBetter: k.lowerIsBetter,
      note: kv.note ?? (kv.status === 'ok' && kv.previousStatus !== 'ok' ? `previous period tracking: ${kv.previousStatus}` : undefined),
    }
  })
  base.metrics.push(
    { id: 'web.verifiedRevenue', label: 'Verified revenue', unit: 'agorot', basis: 'period', value: shekelsToAgorot(s.sales.verifiedRevenue), previous: null, quality: 'ok', source: 'website', note: 'confirmed by a signed Grow webhook' },
    { id: 'web.unverifiedRevenue', label: 'Unverified revenue', unit: 'agorot', basis: 'period', value: shekelsToAgorot(s.sales.unverifiedRevenue), previous: null, quality: 'ok', source: 'website', lowerIsBetter: true },
    { id: 'web.pendingStale', label: 'Stuck in pending', unit: 'count', basis: 'period', value: s.sales.pendingStale, previous: null, quality: 'ok', source: 'website', lowerIsBetter: true },
  )
  const daily = s.daily ?? []
  const dailyPrev = s.dailyPrevious ?? []
  if (daily.length) {
    base.series = [
      { id: 'web.revenue', label: 'Revenue', unit: 'agorot', points: alignDaily(daily, dailyPrev, (d) => shekelsToAgorot(d.revenue)) },
      { id: 'web.orders', label: 'Paid orders', unit: 'count', points: alignDaily(daily, dailyPrev, (d) => d.orders) },
      { id: 'web.sessions', label: 'Sessions', unit: 'count', points: alignDaily(daily, dailyPrev, (d) => d.sessions) },
      { id: 'web.visitors', label: 'Visitors', unit: 'count', points: alignDaily(daily, dailyPrev, (d) => d.visitors) },
    ]
  } else base.notes.push('The website deployment does not return a daily breakdown yet, so there is no trend chart.')

  const prevFunnel = new Map((s.funnelPrevious ?? []).map((f) => [f.key, f]))
  base.tables.push({
    id: 'web.funnel',
    title: 'Purchase funnel',
    columns: [
      { key: 'step', label: 'Step' },
      { key: 'sessions', label: 'Sessions', unit: 'count' },
      { key: 'previous', label: 'Previous', unit: 'count' },
      { key: 'rate', label: 'Of previous step', unit: 'ratio' },
      { key: 'previousRate', label: 'Previous period', unit: 'ratio' },
      { key: 'fromStart', label: 'Of all sessions', unit: 'ratio' },
    ],
    rows: s.funnel.map((f) => {
      const p = prevFunnel.get(f.key)
      return { step: FUNNEL_LABELS[f.key] ?? f.key, sessions: f.sessions, previous: p?.sessions ?? null, rate: f.rateFromPrevious, previousRate: p?.rateFromPrevious ?? null, fromStart: f.rateFromStart }
    }),
  })
  const segCols: Table['columns'] = [
    { key: 'segment', label: 'Segment' },
    { key: 'sessions', label: 'Sessions', unit: 'count' },
    { key: 'share', label: 'Share', unit: 'ratio' },
    { key: 'orders', label: 'Orders', unit: 'count' },
    { key: 'conversion', label: 'Conversion', unit: 'ratio' },
    { key: 'revenue', label: 'Revenue', unit: 'agorot' },
  ]
  const segRows = (rows: MetricsSnapshot['channels']) =>
    rows.map((x) => ({ segment: x.key, sessions: x.sessions, share: x.share, orders: x.orders, conversion: x.conversionRate, revenue: shekelsToAgorot(x.revenue) }))
  base.tables.push({ id: 'web.channels', title: 'Acquisition channels', columns: segCols, rows: segRows(s.channels) })
  base.tables.push({ id: 'web.devices', title: 'Devices', columns: segCols, rows: segRows(s.devices) })

  if (s.coverage.current !== 'ok') base.notes.push(`Tracking coverage for this period is ${s.coverage.current}: event-based numbers (sessions, visitors, funnel) are a lower bound.`)
  if (s.coverage.previous !== 'ok') base.notes.push(`Tracking coverage for the previous period is ${s.coverage.previous}: changes in event-based numbers are overstated.`)
  if (s.coverage.unlinkedOrders) base.notes.push(`${s.coverage.unlinkedOrders} paid order(s) could not be linked to a session, so channel/device revenue is less than total revenue.`)
  base.notes.push('Website revenue is order totals in a paid status. It includes gift cards sold in the website cart, which are separate from the gift card system below.')
  return base
}

// ---------------------------------------------------------------- gift cards

export function giftCardsSection(sales: SourceResult<GiftCardSales>, summary: SourceResult<GiftCardSummary>): Section {
  const sec: Section = {
    product: 'gift_cards',
    title: 'Gift cards',
    sources: [sourceInfo('gift.sales', 'Gift card daily sales', sales), sourceInfo('gift.summary', 'Gift card summary', summary)],
    metrics: [],
    series: [],
    tables: [],
    notes: [],
  }
  const c = sales.state === 'ok' ? sales.data.current.totals : null
  const p = sales.state === 'ok' ? sales.data.previous.totals : null
  const q: Quality = sales.state === 'ok' ? 'ok' : 'unavailable'
  const period = (id: string, label: string, unit: Unit, pick: (t: GiftCardSales['current']['totals']) => number | null, extra: Partial<Metric> = {}): Metric => ({
    id, label, unit, basis: 'period', value: c ? pick(c) : null, previous: p ? pick(p) : null, quality: q, source: 'gift.sales', ...extra,
  })
  sec.metrics.push(
    period('gift.sold', 'Cards sold', 'count', (t) => t.cardsSold),
    period('gift.faceValue', 'Face value sold', 'agorot', (t) => t.salesMinor),
    period('gift.averageCard', 'Average card', 'agorot', (t) => t.averageCardMinor),
    period('gift.redemptions', 'Redemptions', 'count', (t) => t.redemptions),
    period('gift.redeemedPeriod', 'Value redeemed', 'agorot', (t) => t.redeemedMinor),
    period('gift.reversed', 'Reversed redemptions', 'agorot', (t) => t.reversedMinor, { lowerIsBetter: true }),
  )
  const s = summary.state === 'ok' ? summary.data : null
  const now = (id: string, label: string, unit: Unit, pick: (x: GiftCardSummary) => number | null, extra: Partial<Metric> = {}): Metric => ({
    id, label, unit, basis: 'now', value: s ? pick(s) : null, previous: null, quality: s ? 'ok' : 'unavailable', source: 'gift.summary', ...extra,
  })
  sec.metrics.push(
    now('gift.liability', 'Outstanding liability', 'agorot', (x) => x.stats.outstandingMinor),
    now('gift.active', 'Cards with balance', 'count', (x) => x.stats.active + x.stats.partiallyRedeemed),
    now('gift.redemptionRate', 'Redeemed share of value sold (all time)', 'ratio', (x) => ratio(x.stats.redeemedMinor, x.stats.totalSalesMinor)),
    now('gift.expiringSoon', 'Expiring within 30 days', 'count', (x) => x.stats.expiringSoon),
    now('gift.failedDeliveries', 'Failed deliveries', 'count', (x) => x.stats.failedDeliveries, { lowerIsBetter: true }),
    now('gift.stuck', 'Paid, not delivered (14 days)', 'count', (x) => x.deliveryHealth.unmatchedPayments + x.deliveryHealth.paidNotActivated + x.deliveryHealth.undelivered, { lowerIsBetter: true }),
  )
  if (sales.state === 'ok') {
    const cur = sales.data.current.daily
    const prev = sales.data.previous.daily
    const align = (pick: (d: (typeof cur)[number]) => number) => cur.map((d, i) => ({ date: d.date, value: pick(d), previousDate: prev[i]?.date ?? null, previous: prev[i] ? pick(prev[i]!) : null }))
    sec.series = [
      { id: 'gift.faceValue', label: 'Face value sold', unit: 'agorot', points: align((d) => d.salesMinor) },
      { id: 'gift.sold', label: 'Cards sold', unit: 'count', points: align((d) => d.cardsSold) },
      { id: 'gift.redeemedPeriod', label: 'Value redeemed', unit: 'agorot', points: align((d) => d.redeemedMinor) },
    ]
    const prevBy = new Map(sales.data.previous.byTemplate.map((t) => [t.templateId, t]))
    const ids = [...new Set([...sales.data.current.byTemplate.map((t) => t.templateId), ...prevBy.keys()])]
    const curBy = new Map(sales.data.current.byTemplate.map((t) => [t.templateId, t]))
    sec.tables.push({
      id: 'gift.byDesign',
      title: 'Sales by card design',
      columns: [
        { key: 'design', label: 'Design' },
        { key: 'cards', label: 'Cards', unit: 'count' },
        { key: 'value', label: 'Face value', unit: 'agorot' },
        { key: 'previousCards', label: 'Previous cards', unit: 'count' },
        { key: 'previousValue', label: 'Previous value', unit: 'agorot' },
      ],
      rows: ids.map((id) => {
        const a = curBy.get(id)
        const b = prevBy.get(id)
        return { design: a?.name ?? b?.name ?? id, cards: a?.cardsSold ?? 0, value: a?.salesMinor ?? 0, previousCards: b?.cardsSold ?? 0, previousValue: b?.salesMinor ?? 0 }
      }),
    })
  }
  sec.notes.push(
    'Face value sold is what customers paid for cards; it becomes revenue as it is redeemed and is a liability until then. It is never added to website revenue.',
    'A card refunded later is not a sale (the gift card system’s own rule), so a past period can go down after a refund.',
  )
  return sec
}

// ---------------------------------------------------------------- furniture

export function furnitureSection(r: SourceResult<FurnitureProject[]>, range: DateRange, previous: DateRange): Section {
  const sec: Section = { product: 'furniture', title: 'Furniture collection', sources: [sourceInfo('furniture', 'Furniture-Collect projects', r)], metrics: [], series: [], tables: [], notes: [] }
  const all = r.state === 'ok' ? r.data : null
  const active = all?.filter((x) => !x.archived) ?? null
  const sum = (k: 'apartments' | 'apartmentsCompleted' | 'items' | 'itemsToCollect' | 'itemsCollected') => (active ? active.reduce((s, x) => s + x[k], 0) : null)
  const inRange = (d: DateRange) => (all ? all.filter((x) => { const day = israelDate(new Date(x.created_at)); return day >= d.from && day <= d.to }).length : null)
  const q: Quality = all ? 'ok' : 'unavailable'
  const m = (id: string, label: string, unit: Unit, basis: Basis, value: number | null, prev: number | null = null): Metric => ({ id, label, unit, basis, value, previous: prev, quality: q, source: 'furniture' })
  const apts = sum('apartments')
  const done = sum('apartmentsCompleted')
  const toCollect = sum('itemsToCollect')
  const collected = sum('itemsCollected')
  sec.metrics.push(
    m('furn.newProjects', 'Projects started', 'count', 'period', inRange(range), inRange(previous)),
    m('furn.activeProjects', 'Active projects', 'count', 'now', active?.length ?? null),
    m('furn.apartments', 'Apartments completed', 'count', 'now', done),
    m('furn.apartmentRate', 'Apartments completed (share)', 'ratio', 'now', apts != null && done != null ? ratio(done, apts) : null),
    m('furn.items', 'Items recorded', 'count', 'now', sum('items')),
    m('furn.collected', 'Items collected', 'count', 'now', collected),
    m('furn.collectionRate', 'Collection progress', 'ratio', 'now', toCollect != null && collected != null ? ratio(collected, toCollect) : null),
  )
  if (active) {
    sec.tables.push({
      id: 'furn.projects',
      title: 'Active projects',
      columns: [
        { key: 'project', label: 'Project' },
        { key: 'city', label: 'City' },
        { key: 'apartments', label: 'Apartments', unit: 'count' },
        { key: 'completed', label: 'Completed', unit: 'count' },
        { key: 'items', label: 'Items', unit: 'count' },
        { key: 'toCollect', label: 'To collect', unit: 'count' },
        { key: 'collected', label: 'Collected', unit: 'count' },
        { key: 'progress', label: 'Collection', unit: 'ratio' },
      ],
      rows: active.map((x) => ({ project: x.name, city: x.city, apartments: x.apartments, completed: x.apartmentsCompleted, items: x.items, toCollect: x.itemsToCollect, collected: x.itemsCollected, progress: ratio(x.itemsCollected, x.itemsToCollect) })),
    })
  }
  sec.notes.push(
    'Progress is the state now: the field app does not expose when an item was collected, so there is no per-day trend or period comparison for it.',
    'Weight, diversion and CO₂ are computed only by the field app’s own reports and are not shown here.',
  )
  return sec
}

// ---------------------------------------------------------------- design agent

const AGENT: { key: keyof DesignAgentActivity['totals']; id: string; label: string; lowerIsBetter?: true }[] = [
  { key: 'ownerMessages', id: 'agent.ownerMessages', label: 'Messages from the owner' },
  { key: 'projects', id: 'agent.projects', label: 'Design projects started' },
  { key: 'versions', id: 'agent.versions', label: 'Design versions produced' },
  { key: 'versionsApproved', id: 'agent.versionsApproved', label: 'Versions approved' },
  { key: 'jobs', id: 'agent.jobs', label: 'Jobs run' },
  { key: 'jobsDead', id: 'agent.jobsDead', label: 'Jobs that died', lowerIsBetter: true },
  { key: 'messagesSent', id: 'agent.messagesSent', label: 'Messages sent' },
  { key: 'messagesFailed', id: 'agent.messagesFailed', label: 'Sends failed', lowerIsBetter: true },
]

export function designAgentSection(cur: SourceResult<DesignAgentActivity>, prev: SourceResult<DesignAgentActivity>, healthz: SourceResult<DesignAgentHealthz>): Section {
  const sec: Section = {
    product: 'design_agent',
    title: 'Design agent',
    sources: [sourceInfo('agent.activity', 'Design agent activity', cur), sourceInfo('agent.healthz', 'Design agent queue', healthz)],
    metrics: [],
    series: [],
    tables: [],
    notes: [],
  }
  const c = cur.state === 'ok' ? cur.data : null
  const p = prev.state === 'ok' ? prev.data : null
  sec.metrics = AGENT.map((a) => ({
    id: a.id,
    label: a.label,
    unit: 'count',
    basis: 'period',
    value: c ? c.totals[a.key] : null,
    previous: p ? p.totals[a.key] : null,
    quality: c ? (p ? 'ok' : 'partial') : 'unavailable',
    source: 'agent.activity',
    lowerIsBetter: a.lowerIsBetter,
    note: c && !p ? 'previous period could not be read' : undefined,
  }))
  const h = healthz.state === 'ok' ? healthz.data : null
  sec.metrics.push(
    { id: 'agent.queued', label: 'Jobs queued now', unit: 'count', basis: 'now', value: h ? (h.jobs.queued ?? 0) : null, previous: null, quality: h ? 'ok' : 'unavailable', source: 'agent.healthz' },
    { id: 'agent.stuck', label: 'Stuck (>10 min)', unit: 'count', basis: 'now', value: h ? h.stuck : null, previous: null, quality: h ? 'ok' : 'unavailable', source: 'agent.healthz', lowerIsBetter: true },
  )
  if (c) {
    const align = (k: keyof DesignAgentActivity['totals']) => c.daily.map((d, i) => ({ date: d.date, value: d[k], previousDate: p?.daily[i]?.date ?? null, previous: p?.daily[i]?.[k] ?? null }))
    sec.series = [
      { id: 'agent.versions', label: 'Design versions produced', unit: 'count', points: align('versions') },
      { id: 'agent.ownerMessages', label: 'Messages from the owner', unit: 'count', points: align('ownerMessages') },
      { id: 'agent.jobs', label: 'Jobs run', unit: 'count', points: align('jobs') },
    ]
    const prevBy = new Map((p?.jobsByType ?? []).map((t) => [t.type, t]))
    sec.tables.push({
      id: 'agent.jobsByType',
      title: 'Jobs by type',
      columns: [
        { key: 'type', label: 'Type' },
        { key: 'jobs', label: 'Jobs', unit: 'count' },
        { key: 'done', label: 'Done', unit: 'count' },
        { key: 'dead', label: 'Dead', unit: 'count' },
        { key: 'previous', label: 'Previous jobs', unit: 'count' },
      ],
      rows: c.jobsByType.map((t) => ({ type: t.type, jobs: t.jobs, done: t.done, dead: t.dead, previous: p ? (prevBy.get(t.type)?.jobs ?? 0) : null })),
    })
  }
  sec.notes.push('The design agent answers only the owner’s allowlisted numbers: these are the owner’s own design requests, not customers.')
  return sec
}

/** Every metric across sections, flattened (CSV, catalog freshness). */
export const allMetrics = (r: AnalyticsReport) => r.sections.flatMap((s) => s.metrics.map((m) => ({ section: s, metric: m })))
