import 'server-only'
import { randomUUID } from 'node:crypto'
import { getOpsStore } from '@/lib/ops'
import { contactLabel, locationLabels } from '@/lib/ops/views'
import type { CheckoutItem } from '@/components/sales/checkout'
import { getSalesStore, type SaleDetail } from './store'
import type { Item } from '@/lib/ops/types'
import { buildHandovers, type Handover } from './handovers'
import { saleMoney, type Sale, type SaleMoney } from './model'
import { israelDate } from '@/lib/time'

/** What the checkout screen needs: every sellable item, the customer list and a fresh request id. */
export async function checkoutData(opts: { crm: boolean; pii: boolean }) {
  const store = getOpsStore()
  const [items, locations, contacts] = await Promise.all([
    store.listItems({ statuses: ['in_storage', 'listed', 'reserved'], limit: 2000 }),
    store.listLocations(),
    opts.crm ? store.listContacts({ limit: 1000 }) : Promise.resolve([]),
  ])
  const labels = locationLabels(locations)
  const sellable: CheckoutItem[] = items
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      id: i.id, sku: i.sku, title: i.title, category: i.category, colors: i.colors ?? null, material: i.material, photoUrl: i.photoUrl, priceMinor: i.priceMinor,
      quantity: i.quantity, kind: i.kind, status: i.status as CheckoutItem['status'], version: i.version, location: i.locationId ? labels.get(i.locationId) ?? null : null,
    }))
  return { items: sellable, contacts: contacts.map((c) => ({ id: c.id, label: contactLabel(c, opts.pii) })), requestId: randomUUID() }
}

export interface SaleView extends SaleDetail {
  items: Map<string, Item>
  contactName: string | null
  /** Open/planned deliveries by line id. */
  deliveries: Map<string, { id: string; status: string; scheduledFor: string | null }>
}

export async function saleView(id: string, opts: { crm: boolean; pii: boolean }): Promise<SaleView | null> {
  const detail = await getSalesStore().getSale(id)
  if (!detail) return null
  const ops = getOpsStore()
  const [items, contact, deliveries] = await Promise.all([
    Promise.all([...new Set(detail.lines.map((l) => l.itemId))].map((i) => ops.getItem(i))),
    detail.sale.contactId && opts.crm ? ops.getContact(detail.sale.contactId) : Promise.resolve(null),
    detail.lines.length ? ops.listDeliveries({ saleLineIds: detail.lines.map((l) => l.id) }) : Promise.resolve([]),
  ])
  return {
    ...detail,
    items: new Map(items.filter((i): i is Item => !!i).map((i) => [i.id, i])),
    contactName: contact ? contactLabel(contact, opts.pii) : null,
    deliveries: new Map(deliveries.filter((d) => d.saleLineId && d.status !== 'cancelled').map((d) => [d.saleLineId!, { id: d.id, status: d.status, scheduledFor: d.scheduledFor }])),
  }
}

export interface HandoverQueue {
  list: Handover[]
  /** Name and phone by contact id: names only with `pii`, nothing without `crm`. */
  contacts: Map<string, { name: string; phone: string | null }>
}

/** Everything sold and not yet handed over (see handovers.ts), with who is waiting for it. */
export async function handoverQueue(opts: { crm: boolean; pii: boolean }, today = israelDate()): Promise<HandoverQueue> {
  const st = getSalesStore()
  const ops = getOpsStore()
  const [lines, deliveries] = await Promise.all([st.openLines(300), ops.listDeliveries({ statuses: ['planned', 'out', 'failed'], limit: 300 })])
  const itemIds = [...new Set([...lines.map((l) => l.itemId), ...deliveries.map((d) => d.itemId).filter((x): x is string => !!x)])]
  const [sales, items] = await Promise.all([
    lines.length ? st.listSales({ ids: [...new Set(lines.map((l) => l.saleId))] }) : Promise.resolve([]),
    itemIds.length ? ops.listItems({ ids: itemIds, limit: itemIds.length }) : Promise.resolve([]),
  ])
  const list = buildHandovers({ lines, deliveries, sales, items }, today)
  const contactIds = [...new Set(list.map((h) => h.contactId).filter((x): x is string => !!x))]
  const rows = opts.crm && contactIds.length ? await ops.listContacts({ ids: contactIds, limit: contactIds.length }) : []
  return { list, contacts: new Map(rows.map((c) => [c.id, { name: opts.pii ? c.fullName : contactLabel(c, false), phone: opts.pii ? c.phone : null }])) }
}

export interface SaleRow {
  sale: Sale
  money: SaleMoney
  units: number
  openLines: number
  /** The customer's name with `pii`, a placeholder without; null for a walk-in. */
  customer: string | null
}

/** The newest shop sales with their money and handover state: the ONE read behind the console's and the shop's sales lists. */
export async function recentSales(opts: { crm: boolean; pii: boolean; limit?: number }, customerWord = 'Customer'): Promise<SaleRow[]> {
  const st = getSalesStore()
  const sales = await st.listSales({ limit: opts.limit ?? 50 })
  const ids = sales.map((x) => x.id)
  const contactIds = [...new Set(sales.map((x) => x.contactId).filter((x): x is string => !!x))]
  const [lines, payments, contacts] = await Promise.all([
    ids.length ? st.linesOf(ids) : Promise.resolve([]),
    ids.length ? st.paymentsOf(ids) : Promise.resolve([]),
    opts.crm && contactIds.length ? getOpsStore().listContacts({ ids: contactIds, limit: contactIds.length }) : Promise.resolve([]),
  ])
  const names = new Map(contacts.map((c) => [c.id, opts.pii ? c.fullName : customerWord]))
  return sales.map((sale) => {
    const ls = lines.filter((l) => l.saleId === sale.id)
    return {
      sale,
      money: saleMoney(sale, ls, payments.filter((p) => p.saleId === sale.id)),
      units: ls.reduce((a, l) => a + l.quantity, 0),
      openLines: ls.filter((l) => l.status === 'open').length,
      customer: sale.contactId ? names.get(sale.contactId) ?? customerWord : null,
    }
  })
}
