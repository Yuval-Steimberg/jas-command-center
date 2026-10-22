import { describe, expect, it } from 'vitest'
import { deriveAlerts } from '@/lib/alerts'
import type { ProductHealth } from '@/lib/integrations/types'
import type { GiftCardSummary } from '@/lib/integrations/gift-cards/contract'

const okHealth: ProductHealth[] = [{ product: 'website', status: 'operational', checks: [] }]
const at = '2026-10-22T10:00:00Z'

function gift(over: Partial<GiftCardSummary['deliveryHealth']> = {}, stats: Partial<GiftCardSummary['stats']> = {}): GiftCardSummary {
  return {
    version: 1,
    generatedAt: at,
    stats: { soldTotal: 0, soldToday: 0, soldWeek: 0, soldMonth: 0, totalSalesMinor: 0, outstandingMinor: 0, redeemedMinor: 0, partiallyRedeemed: 0, fullyRedeemed: 0, active: 0, suspended: 0, refunded: 0, expiringSoon: 0, failedDeliveries: 0, ...stats },
    deliveryHealth: { windowDays: 14, unmatchedPayments: 0, unmatchedPaymentsMinor: 0, paidNotActivated: 0, undelivered: 0, undeliveredByStatus: {}, ...over },
  }
}

describe('deriveAlerts', () => {
  it('is quiet when nothing is wrong', () => {
    expect(deriveAlerts({ health: okHealth, giftSummary: { state: 'ok', data: gift(), checkedAt: at, latencyMs: 1, source: 's' } })).toEqual([])
  })

  it('money already taken is always critical', () => {
    const a = deriveAlerts({ health: okHealth, giftSummary: { state: 'ok', data: gift({ paidNotActivated: 1, undelivered: 2, unmatchedPayments: 1 }), checkedAt: at, latencyMs: 1, source: 's' } })
    expect(a.map((x) => x.severity)).toEqual(['critical', 'critical', 'critical'])
  })

  it('a down service is critical and sorts first; info sorts last', () => {
    const a = deriveAlerts({
      health: [{ product: 'map', status: 'down', checks: [{ name: 'Public site', status: 'down', detail: 'HTTP 502', checkedAt: at, latencyMs: 3 }] }],
      giftSummary: { state: 'ok', data: gift({}, { expiringSoon: 3 }), checkedAt: at, latencyMs: 1, source: 's' },
    })
    expect(a[0]).toMatchObject({ severity: 'critical', product: 'map' })
    expect(a.at(-1)).toMatchObject({ severity: 'info', id: 'gift:expiring' })
  })

  it('an unconfigured or failing source raises nothing by itself (it is shown as not connected, not as a business problem)', () => {
    expect(deriveAlerts({ health: okHealth, giftSummary: { state: 'not_configured', missing: ['X'] }, agentStatus: { state: 'error', error: 'boom', checkedAt: at, latencyMs: null } })).toEqual([])
  })

  it('degraded is not down', () => {
    expect(deriveAlerts({ health: [{ product: 'website', status: 'degraded', checks: [] }] })).toEqual([])
  })
})
