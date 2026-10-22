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

/** GET /api/integration/v1/cards — the gift card system's own search. Codes arrive masked. */
export const giftCardRow = z.object({
  id: z.string(),
  maskedCode: z.string(),
  status: z.string(),
  initialAmountMinor: minor,
  balanceMinor: minor,
  templateId: z.string(),
  buyerName: z.string().nullable(),
  buyerEmail: z.string(),
  recipientName: z.string(),
  recipientEmail: z.string(),
  scheduledDeliveryAt: z.string().nullable(),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
})
export type GiftCardRow = z.infer<typeof giftCardRow>
export const giftCardSearch = z.object({ total: z.number().int(), items: z.array(giftCardRow) })
export type GiftCardSearch = z.infer<typeof giftCardSearch>

/** GET /api/integration/v1/cards/:id */
export const giftCardDetail = z.object({
  card: giftCardRow.extend({ buyerPhone: z.string().nullable(), recipientPhone: z.string().nullable(), greeting: z.string(), supersededByCardId: z.string().nullable() }),
  payment: z.object({ provider: z.string(), status: z.string(), amountMinor: minor, createdAt: z.string() }).nullable(),
  delivery: z.array(z.object({ id: z.string(), channel: z.string(), status: z.string(), attempts: z.number().int(), lastError: z.string().nullable(), scheduledFor: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() })),
  ledger: z.array(z.object({ id: z.string(), type: z.string(), amountMinor: minor, balanceAfterMinor: minor, reason: z.string().nullable(), createdAt: z.string() })),
  redemptions: z.array(z.object({ id: z.string(), amountMinor: minor, balanceAfterMinor: minor, reversed: z.boolean(), createdAt: z.string().nullable() })),
  audit: z.array(z.object({ action: z.string(), actorRole: z.string().nullable(), reason: z.string().nullable(), createdAt: z.string() })),
})
export type GiftCardDetail = z.infer<typeof giftCardDetail>

export const writeResult = z.object({ ok: z.boolean(), message: z.string().nullable().optional(), resent: z.boolean().optional() })
export const resendAllResult = z.object({
  queued: z.number().int(),
  delivered: z.number().int(),
  rejected: z.array(z.object({ id: z.string(), maskedCode: z.string(), recipientEmail: z.string() })),
})
export type ResendAllResult = z.infer<typeof resendAllResult>
