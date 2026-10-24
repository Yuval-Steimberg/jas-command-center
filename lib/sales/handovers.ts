import type { Delivery, Item } from '@/lib/ops/types'
import type { Sale, SaleLine } from './model'

/**
 * One thing still to hand over, whichever way it was sold: a shop sale line
 * (pickup or delivery), or a delivery planned on Deliveries for a website
 * order or a sold item. The ONE list behind the shop's home counts, its
 * deliveries tab and the console's open deliveries, so they always agree.
 */
export interface Handover {
  key: string
  /** The shop sale line, when it was sold at the counter. Handing it over goes through the line. */
  line: SaleLine | null
  /** The delivery record: the line's own (once one is planned), or a standalone one. */
  delivery: Delivery | null
  sale: Sale | null
  item: Item | null
  kind: 'pickup' | 'delivery'
  scheduledFor: string | null
  timeWindow: string | null
  address: string | null
  /** The sale number or the website order number. */
  ref: string | null
  contactId: string | null
  /** A delivery whose date has passed and that is still open. */
  overdue: boolean
}

const OPEN_DELIVERY = new Set(['planned', 'out', 'failed'])

/** Pure: joins open lines and open deliveries into one list, overdue first, then by date (undated last). */
export function buildHandovers(i: { lines: SaleLine[]; deliveries: Delivery[]; sales: Sale[]; items: Item[] }, today: string): Handover[] {
  const sales = new Map(i.sales.map((s) => [s.id, s]))
  const items = new Map(i.items.map((x) => [x.id, x]))
  const open = i.deliveries.filter((d) => OPEN_DELIVERY.has(d.status))
  const byLine = new Map(open.filter((d) => d.saleLineId).map((d) => [d.saleLineId!, d]))
  const overdue = (kind: Handover['kind'], date: string | null) => kind === 'delivery' && !!date && date < today

  const fromLines: Handover[] = i.lines.map((line) => {
    const sale = sales.get(line.saleId) ?? null
    const d = byLine.get(line.id) ?? null
    const kind = line.fulfilment === 'delivery' ? 'delivery' : 'pickup'
    const scheduledFor = line.scheduledFor ?? d?.scheduledFor ?? null
    return {
      key: `line:${line.id}`, line, delivery: d, sale, item: items.get(line.itemId) ?? null, kind, scheduledFor,
      timeWindow: line.timeWindow ?? d?.timeWindow ?? null, address: line.address ?? d?.address ?? null,
      ref: sale?.number ?? null, contactId: sale?.contactId ?? null, overdue: overdue(kind, scheduledFor),
    }
  })
  // A sale line's delivery belongs to its line: listed with it while open, and closed with it.
  const standalone: Handover[] = open
    .filter((d) => !d.saleLineId)
    .map((d) => ({
      key: `delivery:${d.id}`, line: null, delivery: d, sale: null, item: d.itemId ? items.get(d.itemId) ?? null : null, kind: 'delivery' as const,
      scheduledFor: d.scheduledFor, timeWindow: d.timeWindow, address: d.address, ref: d.websiteOrderNumber, contactId: d.contactId,
      overdue: overdue('delivery', d.scheduledFor),
    }))
  return [...fromLines, ...standalone].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.scheduledFor ?? '9999').localeCompare(b.scheduledFor ?? '9999'))
}

export function handoverCounts(h: Handover[]) {
  return {
    pickup: h.filter((x) => x.kind === 'pickup').length,
    delivery: h.filter((x) => x.kind === 'delivery').length,
    overdue: h.filter((x) => x.overdue).length,
  }
}
