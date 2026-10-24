import { describe, expect, it } from 'vitest'
import { buildHandovers, handoverCounts } from '@/lib/sales/handovers'
import type { Sale, SaleLine } from '@/lib/sales/model'
import type { Delivery } from '@/lib/ops/types'

const sale = (id: string, contactId: string | null = null): Sale => ({ id, number: `S-${id}`, contactId, totalMinor: 0, note: null, requestId: id, createdBy: 'x', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' })
const line = (id: string, saleId: string, p: Partial<SaleLine> = {}): SaleLine => ({ id, saleId, itemId: `i-${id}`, position: 1, quantity: 1, unitPriceMinor: 100, fulfilment: 'pickup', address: null, scheduledFor: null, timeWindow: null, status: 'open', doneAt: null, returnedQty: 0, updatedAt: '', ...p })
const delivery = (id: string, p: Partial<Delivery> = {}): Delivery => ({ id, itemId: null, websiteOrderId: null, websiteOrderNumber: null, contactId: null, address: null, scheduledFor: null, timeWindow: null, assigneeProfileId: null, status: 'planned', note: null, saleLineId: null, createdBy: 'x', createdAt: '', updatedAt: '', ...p })

describe('handover list (home counts, shop deliveries tab)', () => {
  const today = '2026-10-24'

  it('lists a shop delivery once, with its delivery record, and a website delivery on its own', () => {
    const h = buildHandovers({
      lines: [line('a', 's1', { fulfilment: 'delivery', address: 'x', scheduledFor: '2026-10-25' }), line('b', 's1')],
      deliveries: [delivery('d1', { saleLineId: 'a', scheduledFor: '2026-10-25' }), delivery('d2', { websiteOrderNumber: 'W-7', scheduledFor: '2026-10-26', contactId: 'c9' })],
      sales: [sale('s1', 'c1')],
      items: [],
    }, today)
    expect(h.map((x) => x.key)).toEqual(['line:a', 'delivery:d2', 'line:b'])
    expect(h[0]!.delivery?.id).toBe('d1')
    expect(h[0]!.contactId).toBe('c1')
    expect(h[1]).toMatchObject({ kind: 'delivery', ref: 'W-7', contactId: 'c9', line: null })
  })

  it('puts overdue deliveries first; a pickup is never overdue; closed deliveries are left out', () => {
    const h = buildHandovers({
      lines: [line('p', 's1', { scheduledFor: '2026-10-01' }), line('late', 's1', { fulfilment: 'delivery', address: 'x', scheduledFor: '2026-10-20' })],
      deliveries: [delivery('done', { status: 'done', scheduledFor: '2026-10-01' }), delivery('cx', { status: 'cancelled' })],
      sales: [sale('s1')],
      items: [],
    }, today)
    expect(h.map((x) => x.key)).toEqual(['line:late', 'line:p'])
    expect(handoverCounts(h)).toEqual({ pickup: 1, delivery: 1, overdue: 1 })
  })
})
