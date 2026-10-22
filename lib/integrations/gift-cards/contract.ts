import { z } from 'zod'

/**
 * GET /api/integration/v1/summary on gift_card_system (added by the companion
 * PR in that repo). Every figure is computed by the gift card system's own
 * getAdminStats()/getDeliveryHealth(), so "a sale" keeps exactly one definition.
 * Money is integer agorot. Counts only: no codes, names or email addresses.
 */
const minor = z.number().int()

export const giftCardSummary = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  stats: z.object({
    soldTotal: z.number().int(),
    /** Rolling windows (last 24 h / 7 d / 30 d by issue time), not calendar periods. */
    soldToday: z.number().int(),
    soldWeek: z.number().int(),
    soldMonth: z.number().int(),
    totalSalesMinor: minor,
    outstandingMinor: minor,
    redeemedMinor: minor,
    partiallyRedeemed: z.number().int(),
    fullyRedeemed: z.number().int(),
    active: z.number().int(),
    suspended: z.number().int(),
    refunded: z.number().int(),
    expiringSoon: z.number().int(),
    failedDeliveries: z.number().int(),
  }),
  deliveryHealth: z.object({
    windowDays: z.number().int(),
    unmatchedPayments: z.number().int(),
    unmatchedPaymentsMinor: minor,
    paidNotActivated: z.number().int(),
    undelivered: z.number().int(),
    undeliveredByStatus: z.record(z.string(), z.number().int()),
  }),
})
export type GiftCardSummary = z.infer<typeof giftCardSummary>

/** GET /api/health (public). Only the fields we rely on. */
export const giftCardHealth = z.object({
  ok: z.boolean(),
  build: z.string().optional(),
  store: z.string().optional(),
  migrationsRan: z.boolean().optional(),
  seedRan: z.boolean().optional(),
  env: z.record(z.string(), z.unknown()).optional(),
  checks: z.record(z.string(), z.string()).optional(),
}).passthrough()
export type GiftCardHealth = z.infer<typeof giftCardHealth>
