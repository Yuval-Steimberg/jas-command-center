/**
 * Response bodies shaped exactly like the source systems' contracts
 * (just-a-second-website MetricsSnapshot v1; gift_card_system integration
 * summary v1). Used only by tests against local fake servers — never rendered.
 */
const kpi = (value: number | null, status: 'ok' | 'partial' | 'unavailable' = 'ok') => ({ value, previous: value, change: 0, delta: 0, status, previousStatus: status })

export const websiteSnapshotFixture = {
  version: 1,
  generatedAt: '2026-10-22T10:00:00Z',
  range: { from: '2026-10-16', to: '2026-10-22', start: '2026-10-15T21:00:00Z', end: '2026-10-22T21:00:00Z', days: 7 },
  compare: { from: '2026-10-09', to: '2026-10-15', start: '2026-10-08T21:00:00Z', end: '2026-10-15T21:00:00Z', days: 7 },
  filters: {},
  coverage: { firstEventAt: '2026-10-08T00:00:00Z', current: 'ok', previous: 'partial', legacyPageviewDays: 0, unlinkedOrders: 0, notes: [] },
  kpis: {
    visitors: kpi(120), sessions: kpi(150), pageviews: kpi(600), productViews: kpi(80), addToCarts: kpi(9), checkouts: kpi(4), orders: kpi(2), revenue: kpi(499.8),
    conversionRate: kpi(0.0133), aov: kpi(249.9), abandonedCarts: kpi(5), cartAbandonmentRate: kpi(0.5), checkoutCompletionRate: kpi(0.5), paymentFailures: kpi(0),
  },
  daily: [],
  dailyPrevious: [],
  funnel: [{ key: 'sessions', sessions: 150, rateFromPrevious: null, rateFromStart: 1, dropOff: null }, { key: 'purchase', sessions: 2, rateFromPrevious: 0.5, rateFromStart: 0.013, dropOff: 2 }],
  funnelPrevious: [],
  channels: [{ key: 'direct', sessions: 100, visitors: 90, share: 0.66, engagementRate: 0.5, productViews: 50, addToCarts: 5, orders: 2, revenue: 499.8, conversionRate: 0.02 }],
  devices: [{ key: 'mobile', sessions: 110, visitors: 95, share: 0.73, engagementRate: 0.4, productViews: 60, addToCarts: 6, orders: 1, revenue: 249.9, conversionRate: 0.009 }],
  sales: { grossSales: 499.8, discounts: 0, netSales: 499.8, shipping: 0, tax: null, refunds: null, profit: null, paidOrders: 2, verifiedRevenue: 249.9, unverifiedRevenue: 249.9, statusBreakdown: [{ status: 'paid', orders: 2, amount: 499.8 }], paymentSuccessRate: 1, pendingStale: 0, cancelled: 0 },
  technical: { webVitals: [], jsErrors: [], jsErrorSessionShare: null, apiErrors: [], checkoutErrors: [] },
}

export const giftSummaryFixture = {
  version: 1,
  generatedAt: '2026-10-22T10:00:00Z',
  stats: { soldTotal: 3, soldToday: 0, soldWeek: 1, soldMonth: 3, totalSalesMinor: 75000, outstandingMinor: 45000, redeemedMinor: 30000, partiallyRedeemed: 1, fullyRedeemed: 0, active: 2, suspended: 0, refunded: 0, expiringSoon: 0, failedDeliveries: 0 },
  deliveryHealth: { windowDays: 14, unmatchedPayments: 0, unmatchedPaymentsMinor: 0, paidNotActivated: 0, undelivered: 0, undeliveredByStatus: {} },
}

const salesDay = (date: string, cardsSold: number, salesMinor: number, redemptions = 0, redeemedMinor = 0) => ({ date, cardsSold, salesMinor, redemptions, redeemedMinor })
/** gift_card_system GET /api/integration/v1/sales, two-day range. */
export const giftSalesFixture = {
  version: 1,
  generatedAt: '2026-10-22T10:00:00Z',
  timezone: 'Asia/Jerusalem',
  current: {
    from: '2026-10-21',
    to: '2026-10-22',
    totals: { cardsSold: 3, salesMinor: 75000, redemptions: 1, redeemedMinor: 8000, reversedRedemptions: 1, reversedMinor: 2000, averageCardMinor: 25000 },
    daily: [salesDay('2026-10-21', 1, 20000), salesDay('2026-10-22', 2, 55000, 1, 8000)],
    byTemplate: [{ templateId: 'tpl-a', name: 'חגיגה', cardsSold: 3, salesMinor: 75000 }],
  },
  previous: {
    from: '2026-10-19',
    to: '2026-10-20',
    totals: { cardsSold: 0, salesMinor: 0, redemptions: 0, redeemedMinor: 0, reversedRedemptions: 0, reversedMinor: 0, averageCardMinor: null },
    daily: [salesDay('2026-10-19', 0, 0), salesDay('2026-10-20', 0, 0)],
    byTemplate: [],
  },
}

const agentDay = (date: string, n: number) => ({ date, ownerMessages: n, jobs: n, jobsDone: n, jobsDead: 0, projects: 0, versions: n, versionsApproved: 0, messagesSent: n, messagesFailed: 0 })
/** whatssup-bot GET /admin/activity. */
export const agentActivityFixture = (from: string, to: string, n: number) => ({
  version: 1 as const,
  timezone: 'Asia/Jerusalem',
  from,
  to,
  totals: { ownerMessages: 2 * n, jobs: 2 * n, jobsDone: 2 * n, jobsDead: 0, projects: 0, versions: 2 * n, versionsApproved: 0, messagesSent: 2 * n, messagesFailed: 0 },
  daily: [agentDay(from, n), agentDay(to, n)],
  jobsByType: [{ type: 'render', jobs: 2 * n, done: 2 * n, dead: 0 }],
})
