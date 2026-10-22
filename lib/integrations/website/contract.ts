import { z } from 'zod'

/**
 * The subset of the website's MetricsSnapshot v1 (just-a-second-website
 * src/lib/analytics/metrics.ts) that the command center reads. Validated on
 * arrival: if the website changes shape, this integration reports an error
 * instead of rendering wrong numbers. Money is ₪ with agorot decimals.
 */
export const availability = z.enum(['ok', 'partial', 'unavailable'])

export const kpiValue = z.object({
  value: z.number().nullable(),
  previous: z.number().nullable(),
  change: z.number().nullable(),
  delta: z.number().nullable(),
  status: availability,
  previousStatus: availability,
  note: z.string().optional(),
})

export const WEBSITE_KPIS = [
  'visitors', 'sessions', 'pageviews', 'productViews', 'addToCarts', 'checkouts', 'orders', 'revenue',
  'conversionRate', 'aov', 'abandonedCarts', 'cartAbandonmentRate', 'checkoutCompletionRate', 'paymentFailures',
] as const

const segment = z.object({ key: z.string(), sessions: z.number(), orders: z.number(), revenue: z.number(), share: z.number().nullable(), conversionRate: z.number().nullable() }).passthrough()

export const metricsSnapshot = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  range: z.object({ from: z.string(), to: z.string(), days: z.number() }).passthrough(),
  compare: z.object({ from: z.string(), to: z.string() }).passthrough(),
  coverage: z.object({
    firstEventAt: z.string().nullable(),
    current: availability,
    previous: availability,
    unlinkedOrders: z.number(),
    notes: z.array(z.string()),
  }).passthrough(),
  kpis: z.object(Object.fromEntries(WEBSITE_KPIS.map((k) => [k, kpiValue])) as Record<(typeof WEBSITE_KPIS)[number], typeof kpiValue>).passthrough(),
  funnel: z.array(z.object({ key: z.string(), sessions: z.number(), rateFromPrevious: z.number().nullable(), rateFromStart: z.number().nullable() }).passthrough()),
  channels: z.array(segment),
  devices: z.array(segment),
  sales: z.object({
    grossSales: z.number(),
    netSales: z.number(),
    paidOrders: z.number(),
    verifiedRevenue: z.number(),
    unverifiedRevenue: z.number(),
    statusBreakdown: z.array(z.object({ status: z.string(), orders: z.number(), amount: z.number() })),
    paymentSuccessRate: z.number().nullable(),
    pendingStale: z.number(),
    cancelled: z.number(),
    refunds: z.null(),
    tax: z.null(),
  }).passthrough(),
  technical: z.object({
    jsErrors: z.array(z.object({ message: z.string(), count: z.number(), sessions: z.number() })),
    apiErrors: z.array(z.object({ endpoint: z.string(), status: z.string(), count: z.number() })),
    checkoutErrors: z.array(z.object({ reason: z.string(), count: z.number() })),
  }).passthrough(),
}).passthrough()

export type MetricsSnapshot = z.infer<typeof metricsSnapshot>
export type KpiValue = z.infer<typeof kpiValue>
