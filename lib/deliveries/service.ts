import 'server-only'
import { getOpsStore } from '@/lib/ops'
import type { Delivery, DeliveryStatus } from '@/lib/ops/types'
import { FULFILMENT, listWebsiteOrders, setWebsiteOrderStatus } from '@/lib/integrations/website/manage'
import { markDelivered, type Actor } from '@/lib/inventory/service'

/** Where a delivery may go next. Done and cancelled are final; a failed run is planned again. */
export const DELIVERY_NEXT: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  planned: ['out', 'done', 'cancelled'],
  out: ['done', 'failed'],
  failed: ['planned', 'cancelled'],
  done: [],
  cancelled: [],
}

export type DeliveryResult = { ok: boolean; message: string; warning?: string }

/**
 * Move a delivery on. The delivery row is changed conditionally first (two
 * people cannot both close it); "done" then closes the records it serves in
 * their own systems: the item here (sold → delivered) and the website order
 * (fulfilment → delivered, through the website's own conditional write). A
 * failure there does not undo the delivery: it happened. It is reported as a
 * warning naming what to fix by hand.
 */
export async function moveDelivery(d: Delivery, to: DeliveryStatus, note: string | null, actor: Actor, canWebsite: boolean): Promise<DeliveryResult> {
  if (!DELIVERY_NEXT[d.status].includes(to)) return { ok: false, message: `A ${d.status} delivery cannot become ${to}.` }
  const store = getOpsStore()
  const updated = await store.updateDelivery(d.id, d.status, { status: to, ...(note ? { note } : {}) })
  if (!updated) return { ok: false, message: 'Someone changed this delivery meanwhile. Reload.' }
  if (to !== 'done') return { ok: true, message: `Delivery is now ${to}.` }

  const warnings: string[] = []
  if (d.itemId) {
    const item = await store.getItem(d.itemId)
    if (item && item.status === 'sold') {
      const r = await markDelivered(d.itemId, note, actor, { kind: 'delivery', id: d.id })
      if (!r.ok) warnings.push(`The item was not marked delivered: ${r.message}`)
    }
  }
  if (d.websiteOrderId && d.websiteOrderNumber) {
    if (!canWebsite) warnings.push(`Your role cannot change website orders: mark ${d.websiteOrderNumber} delivered on the website.`)
    else {
      const found = await listWebsiteOrders(d.websiteOrderNumber)
      const o = found.state === 'ok' ? found.data.find((x) => x.id === d.websiteOrderId) : undefined
      if (!o) warnings.push(`Could not read website order ${d.websiteOrderNumber}${found.state === 'error' ? ` (${found.error})` : ''}: mark it delivered there.`)
      else if (o.status !== 'delivered') {
        if (!(FULFILMENT as readonly string[]).includes(o.status)) warnings.push(`Website order ${d.websiteOrderNumber} is "${o.status}", not a paid order: left as it is.`)
        else {
          const w = await setWebsiteOrderStatus(o.id, o.status, 'delivered').catch((e: unknown) => ({ ok: false as const, conflict: false, message: e instanceof Error ? e.message : String(e) }))
          if (!w.ok) warnings.push(`Website order ${d.websiteOrderNumber} was not marked delivered: ${w.message}`)
        }
      }
    }
  }
  return { ok: true, message: 'Delivered.', warning: warnings.join(' ') || undefined }
}
