import 'server-only'
import { randomUUID } from 'node:crypto'
import { getOpsStore } from '@/lib/ops'
import { contactLabel, locationLabels } from '@/lib/ops/views'
import type { CheckoutItem } from '@/components/sales/checkout'
import { getSalesStore, type SaleDetail } from './store'
import type { Item } from '@/lib/ops/types'

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
