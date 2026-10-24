'use server'

import { z } from 'zod'
import { userCan, type CurrentUser } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { runAct, formStr as str, formDate, type ActionState } from '@/lib/ops/act'
import { DELIVERY_STATUSES, type DeliveryStatus } from '@/lib/ops/types'
import { moveDelivery } from '@/lib/deliveries/service'
import { listWebsiteOrders } from '@/lib/integrations/website/manage'

const uuid = z.string().uuid()
const actorOf = (u: CurrentUser) => ({ email: u.email, name: u.name })

/** Plan a delivery or pickup for a sold item and/or a website order. */
export async function createDeliveryAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const item = uuid.safeParse(f.get('itemId'))
  const orderNumber = str(f, 'orderNumber', 40)
  if (!item.success && !orderNumber) return { ok: false, message: 'Pick a sold item or type a website order number.' }
  const when = formDate(f, 'date')
  if (when === 'invalid') return { ok: false, message: 'Pick a valid date.' }
  const contact = uuid.safeParse(f.get('contactId'))
  return runAct('inventory', ['inventory:operate'], 'delivery.create', item.success ? `item:${item.data}` : `website_order:${orderNumber}`, { orderNumber, date: when }, async (u) => {
    const store = getOpsStore()
    let websiteOrderId: number | null = null
    if (orderNumber) {
      const r = await listWebsiteOrders(orderNumber)
      if (r.state !== 'ok') return { ok: false, message: `The website order could not be checked: ${r.state === 'error' ? r.error : 'website not connected'}.` }
      const o = r.data.find((x) => x.order_number.toLowerCase() === orderNumber.toLowerCase())
      if (!o) return { ok: false, message: `No website order ${orderNumber}.` }
      websiteOrderId = o.id
    }
    let contactId = contact.success ? contact.data : null
    if (item.success) {
      const it = await store.getItem(item.data)
      if (!it) return { ok: false, message: 'That item no longer exists.' }
      contactId ??= it.buyerContactId
      websiteOrderId ??= it.websiteOrderId
    }
    const existing = item.success ? await store.listDeliveries({ itemId: item.data, statuses: ['planned', 'out'] }) : websiteOrderId ? await store.listDeliveries({ websiteOrderId, statuses: ['planned', 'out'] }) : []
    if (existing.length) return { ok: false, message: 'A delivery for this is already planned. Change that one.' }
    await store.createDelivery({
      itemId: item.success ? item.data : null, websiteOrderId, websiteOrderNumber: orderNumber, contactId, address: str(f, 'address', 300), scheduledFor: when,
      timeWindow: str(f, 'window', 60), note: str(f, 'note', 500), status: 'planned', assigneeProfileId: f.get('mine') === 'on' ? u.id : null, createdBy: u.email,
    })
    return { ok: true, message: 'Delivery planned.' }
  }, ['/deliveries', '/sales', ...(item.success ? [`/inventory/${item.data}`] : [])])
}

export async function moveDeliveryAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const to = String(f.get('to') ?? '') as DeliveryStatus
  if (!id.success || !DELIVERY_STATUSES.includes(to)) return { ok: false, message: 'Invalid request.' }
  return runAct('inventory', ['inventory:operate'], `delivery.${to}`, `delivery:${id.data}`, {}, async (u) => {
    const d = await getOpsStore().getDelivery(id.data)
    if (!d) return { ok: false, message: 'That delivery no longer exists.' }
    return moveDelivery(d, to, str(f, 'note', 500), actorOf(u), await userCan('website:operate'))
  }, ['/deliveries', '/sales', '/inventory', '/shop'])
}
