import 'server-only'
import { ConflictError, getOpsStore } from '@/lib/ops'
import type { Item } from '@/lib/ops/types'
import { touchContact } from '@/lib/crm/service'
import { markDelivered, shiftWebsiteStock, undoWebsiteShift, type Actor } from '@/lib/inventory/service'
import { formatAgorot } from '@/lib/money'
import { getSalesStore, type SaleDetail } from './store'
import { basketProblem, keptQty, unitsValue, type Fulfilment, type PaymentMethod, type Sale, type SaleInput, type SaleLine } from './model'

/**
 * Shop sales across systems. The order of steps follows the inventory rule
 * (lib/inventory/service.ts): take listed units off the WEBSITE first
 * (compare-and-set), then write the sale here in one transaction, and if that
 * is refused put the website stock back. So a basket either sells completely
 * in exactly one place, or not at all.
 */
export type SaleResult = { ok: true; sale: Sale; message: string; warning?: string } | { ok: false; message: string }
export type LineResult = { ok: boolean; message: string; warning?: string }

const why = (e: unknown) => (e instanceof ConflictError ? `${e.message}.` : e instanceof Error ? e.message : String(e))

export async function createShopSale(input: SaleInput, requestId: string, actor: Actor): Promise<SaleResult> {
  const problem = basketProblem(input)
  if (problem) return { ok: false, message: problem }
  const sales = getSalesStore()
  const ops = getOpsStore()
  const items = await ops.listItems({ ids: input.lines.map((l) => l.itemId), limit: input.lines.length })
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const l of input.lines) if (!byId.has(l.itemId)) return { ok: false, message: 'An item in the basket no longer exists. Reload.' }

  // 1. Website first: a listed item (or units of a listed lot) leaves the website's stock.
  const shifted: { productId: number; had: number; now: number }[] = []
  const undo = async () => (await Promise.all(shifted.map((s) => undoWebsiteShift(s.productId, s)))).filter(Boolean).join(' ')
  for (const l of input.lines) {
    const it = byId.get(l.itemId)!
    if (it.status !== 'listed' || it.websiteProductId == null) continue
    const whole = it.kind === 'unique' || l.quantity >= it.quantity
    const r = await shiftWebsiteStock(it.websiteProductId, 0)
    if (!r.ok) {
      const w = await undo()
      return { ok: false, message: `Not sold: ${it.sku}: ${r.message}.${w ? ` ${w}` : ''}` }
    }
    const delta = whole ? -r.had : -Math.min(l.quantity, r.had)
    const s = await shiftWebsiteStock(it.websiteProductId, delta)
    if (!s.ok) {
      const w = await undo()
      return { ok: false, message: `Not sold: ${it.sku}: ${s.message}.${w ? ` ${w}` : ''}` }
    }
    shifted.push({ productId: it.websiteProductId, had: s.had, now: s.now })
  }

  // 2. The sale, every line or none.
  let res: { sale: Sale; replay: boolean }
  try {
    res = await sales.createSale(input, requestId, actor.email)
  } catch (e) {
    const w = await undo()
    return { ok: false, message: `Not sold: ${why(e)}${w ? ` ${w}` : ''}` }
  }
  if (res.replay) return { ok: true, sale: res.sale, message: `Already recorded as ${res.sale.number}.` }

  // 3. The customer's timeline. A failure here is reported, the sale stands.
  let warning: string | undefined
  if (input.contactId) {
    try {
      const what = input.lines.map((l) => `${byId.get(l.itemId)!.sku}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`).join(', ')
      await touchContact(input.contactId, { channel: 'in_person', direction: 'none', summary: `Bought ${what} in the shop (${res.sale.number}, ${formatAgorot(res.sale.totalMinor)})`, refKind: 'sale', refId: res.sale.id }, actor.email, 'customer')
    } catch (e) {
      warning = `Sold, but the customer's timeline was not updated (${why(e)})`
    }
  }
  const deliveries = input.lines.filter((l) => l.fulfilment === 'delivery').length
  return { ok: true, sale: res.sale, message: `Sold: ${res.sale.number}, ${formatAgorot(res.sale.totalMinor)}${res.sale.discountMinor ? ` after a ${formatAgorot(res.sale.discountMinor)} discount` : ''}.${deliveries ? ` ${deliveries} ${deliveries === 1 ? 'delivery' : 'deliveries'} planned.` : ''}`, warning }
}

/**
 * A line was handed over (collected, or delivered). The line closes
 * conditionally; the item becomes `delivered` once it is sold out and no other
 * line still owes it to a customer.
 */
export async function handOverLine(lineId: string, actor: Actor, ref?: { kind: string; id: string }): Promise<LineResult> {
  const sales = getSalesStore()
  const line = await sales.closeLine(lineId)
  if (!line) {
    const cur = await sales.getLine(lineId)
    return { ok: false, message: !cur ? 'Sale line not found.' : `This line is already ${cur.status === 'done' ? 'handed over' : cur.status}.` }
  }
  const warning = await settleItem(line.itemId, actor, ref ?? { kind: 'sale_line', id: line.id })
  return { ok: true, message: line.fulfilment === 'pickup' ? 'Marked as collected.' : 'Marked as delivered.', warning }
}

async function settleItem(itemId: string, actor: Actor, ref: { kind: string; id: string }): Promise<string | undefined> {
  const item = await getOpsStore().getItem(itemId)
  if (!item || item.status !== 'sold') return undefined
  const open = (await getSalesStore().linesForItems([itemId])).filter((l) => l.status === 'open')
  if (open.length) return undefined
  const r = await markDelivered(itemId, null, actor, ref)
  return r.ok ? undefined : `The item was not marked delivered: ${r.message}`
}

/**
 * Change how a line is handed over: pickup ↔ delivery, or a delivery's
 * address / day. A planned delivery is moved or cancelled with it; one already
 * out on the road is not.
 */
export async function setLineFulfilment(lineId: string, to: Fulfilment, where: { address: string | null; scheduledFor: string | null; timeWindow: string | null }, actor: Actor): Promise<LineResult> {
  const sales = getSalesStore()
  const ops = getOpsStore()
  const line = await sales.getLine(lineId)
  if (!line) return { ok: false, message: 'Sale line not found.' }
  if (line.status !== 'open') return { ok: false, message: 'This line was already handed over or returned.' }
  if (to === 'delivery' && !where.address?.trim()) return { ok: false, message: 'A delivery needs an address.' }
  const deliveries = (await ops.listDeliveries({ saleLineIds: [lineId] })).filter((d) => d.status === 'planned' || d.status === 'out' || d.status === 'failed')
  if (deliveries.some((d) => d.status === 'out')) return { ok: false, message: 'The delivery is already out. Close it on Deliveries first.' }
  const detail = await sales.getSale(line.saleId)
  const patch = to === 'pickup' ? { fulfilment: to, address: null, scheduledFor: null, timeWindow: null } : { fulfilment: to, address: where.address!.trim(), scheduledFor: where.scheduledFor, timeWindow: where.timeWindow }
  const updated = await sales.updateLine(lineId, patch)
  if (!updated) return { ok: false, message: 'Someone changed this line meanwhile. Reload.' }
  if (to === 'pickup') {
    for (const d of deliveries) await ops.updateDelivery(d.id, d.status, { status: 'cancelled', note: `${d.note ? `${d.note} · ` : ''}switched to pickup` })
    return { ok: true, message: 'Switched to pickup.' }
  }
  const current = deliveries.find((d) => d.status === 'planned' || d.status === 'failed')
  if (current) {
    const moved = await ops.updateDelivery(current.id, current.status, { status: 'planned', address: patch.address, scheduledFor: patch.scheduledFor, timeWindow: patch.timeWindow })
    if (!moved) return { ok: true, message: 'Saved on the sale.', warning: 'The delivery changed meanwhile; check it on Deliveries.' }
    return { ok: true, message: line.fulfilment === 'delivery' ? 'Delivery rescheduled.' : 'Switched to delivery.' }
  }
  await ops.createDelivery({ itemId: line.itemId, contactId: detail?.sale.contactId ?? null, address: patch.address, scheduledFor: patch.scheduledFor, timeWindow: patch.timeWindow, note: detail?.sale.number ?? null, createdBy: actor.email, saleLineId: line.id })
  return { ok: true, message: 'Delivery planned.' }
}

/**
 * Some or all units of a line come back. The line and the item change in one
 * transaction; a listed lot that kept units on sale gets them back on the
 * website too. Money goes back through the till or Grow and is recorded as a
 * negative payment, never here.
 */
export async function returnSaleUnits(lineId: string, units: number, expectReturned: number | null, locationId: string | null, reason: string, actor: Actor): Promise<LineResult> {
  const sales = getSalesStore()
  const line = await sales.getLine(lineId)
  if (!line) return { ok: false, message: 'Sale line not found.' }
  if (units > keptQty(line)) return { ok: false, message: `Only ${keptQty(line)} still with the customer.` }
  let updated: SaleLine
  try {
    updated = await sales.returnUnits(lineId, units, expectReturned, locationId, reason, actor.email)
  } catch (e) {
    return { ok: false, message: `Not returned: ${why(e)}` }
  }
  const item = await getOpsStore().getItem(line.itemId)
  let warning: string | undefined
  if (item?.status === 'listed' && item.websiteProductId != null) {
    const s = await shiftWebsiteStock(item.websiteProductId, units)
    if (!s.ok) warning = `Back in stock here, but the website stock was not raised by ${units} (${s.message}). Set it on the website product page.`
  }
  const refund = unitsValue(line, line.returnedQty + units) - unitsValue(line, line.returnedQty)
  return { ok: true, message: `${units} back in stock. If the customer paid, refund ${formatAgorot(refund)} and record it as a refund on this sale.${updated.status === 'returned' ? '' : ` ${keptQty(updated)} still with the customer.`}`, warning }
}

export async function recordPayment(saleId: string, p: { amountMinor: number; method: PaymentMethod; note: string | null }, requestId: string, actor: Actor): Promise<LineResult> {
  try {
    const r = await getSalesStore().addPayment(saleId, p, requestId, actor.email)
    if (r.replay) return { ok: true, message: 'Already recorded.' }
    return { ok: true, message: p.amountMinor < 0 ? `Refund of ${formatAgorot(-p.amountMinor)} recorded.` : `Payment of ${formatAgorot(p.amountMinor)} recorded.` }
  } catch (e) {
    return { ok: false, message: `Not recorded: ${why(e)}` }
  }
}

/** The sale lines that still tie an item to a customer (for the item page). */
export async function openSaleOf(item: Pick<Item, 'id'>): Promise<{ line: SaleLine; detail: SaleDetail } | null> {
  const lines = (await getSalesStore().linesForItems([item.id])).filter((l) => keptQty(l) > 0)
  const line = lines.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!line) return null
  const detail = await getSalesStore().getSale(line.saleId)
  return detail ? { line, detail } : null
}
