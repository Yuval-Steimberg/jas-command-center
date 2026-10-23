import type { Item } from '@/lib/ops/types'
import type { WebsiteOrder } from '@/lib/integrations/website/manage'

/**
 * What one batch of website orders means for inventory and the CRM. Pure, so
 * every rule is tested; lib/sync/run.ts applies the plan idempotently (each
 * step carries the order id as its ref, so seeing an order twice is harmless).
 *
 * The website is the authority for the order and its payment; this only
 * reflects it onto the items that came from inventory, and flags anything
 * that does not add up instead of guessing.
 */
export const PAID = ['paid', 'processing', 'shipped', 'delivered'] as const
const isPaid = (s: string) => (PAID as readonly string[]).includes(s)

export type SyncStep =
  | { kind: 'sell'; itemId: string; orderId: number; orderNumber: string; units: number; lineTotalMinor: number; remaining: number; wasReservedFor: string | null; at: string }
  | { kind: 'deliver'; itemId: string; orderId: number; orderNumber: string }
  | { kind: 'conflict'; itemId: string; orderId: number; orderNumber: string; reason: string }
  | { kind: 'customer'; orderId: number; orderNumber: string; name: string | null; email: string | null; phone: string | null; totalMinor: number; at: string; status: string }

export function planOrderSync(orders: readonly WebsiteOrder[], linked: ReadonlyMap<number, Item>): { steps: SyncStep[]; cursor: string | null } {
  const steps: SyncStep[] = []
  let cursor: string | null = null
  // A batch item sold across several orders in this run: track what is left.
  const left = new Map<string, number>()
  const sorted = [...orders].sort((a, b) => (a.paid_at ?? a.created_at).localeCompare(b.paid_at ?? b.created_at))
  for (const o of sorted) {
    const changed = o.updated_at ?? o.created_at
    if (!cursor || changed > cursor) cursor = changed
    const paid = isPaid(o.status)
    if (paid) {
      steps.push({ kind: 'customer', orderId: o.id, orderNumber: o.order_number, name: o.customer_name, email: o.customer_email, phone: o.customer_phone, totalMinor: Math.round(o.total * 100), at: o.paid_at ?? o.created_at, status: o.status })
    }
    for (const line of o.items ?? []) {
      const pid = line.product_id
      if (pid == null || pid <= 0) continue
      const item = linked.get(pid)
      if (!item) continue
      const ref = { itemId: item.id, orderId: o.id, orderNumber: o.order_number }
      const units = Math.max(1, line.quantity)

      if (!paid) {
        if (o.status === 'cancelled' && item.websiteOrderId === o.id && (item.status === 'sold' || item.status === 'delivered'))
          steps.push({ kind: 'conflict', ...ref, reason: `Order ${o.order_number} was cancelled after ${item.sku} was sold through it. Return the item to stock if it is back, and refund in Grow.` })
        continue
      }
      if (item.websiteOrderId === o.id) {
        if (o.status === 'delivered' && item.status === 'sold') steps.push({ kind: 'deliver', ...ref })
        continue
      }
      if (item.status === 'listed' || item.status === 'reserved') {
        const have = left.get(item.id) ?? item.quantity
        const remaining = Math.max(0, have - units)
        left.set(item.id, remaining)
        if (item.status === 'reserved')
          steps.push({ kind: 'conflict', ...ref, reason: `${item.sku} was reserved for a customer here and was also paid for on the website (order ${o.order_number}). Contact one of the two.` })
        steps.push({ kind: 'sell', ...ref, units, lineTotalMinor: Math.round(line.price * units * 100), remaining, wasReservedFor: item.reservedFor, at: o.paid_at ?? o.created_at })
        if (o.status === 'delivered' && remaining === 0) steps.push({ kind: 'deliver', ...ref })
        continue
      }
      steps.push({ kind: 'conflict', ...ref, reason: `${item.sku} is ${item.status.replace('_', ' ')} here, but website order ${o.order_number} paid for it. Possible double sale: check before shipping.` })
    }
  }
  return { steps, cursor }
}
