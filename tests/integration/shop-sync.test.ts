import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getOpsStore } from '@/lib/ops'
import { emptyData } from '@/lib/ops/memory'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { getSalesStore } from '@/lib/sales/store'
import { createShopSale } from '@/lib/sales/service'
import { runOpsSync } from '@/lib/sync/run'
import { inventorySection } from '@/lib/analytics/ops'
import { israelDate } from '@/lib/time'

/**
 * One shop sale, followed through every section that shows it: the sale
 * itself (/sales, /shop), the items (inventory, sold-not-delivered), the
 * website's stock, the customer's timeline (CRM), the planned delivery, the
 * inventory snapshot behind the overview, the analytics section, and the
 * hourly sync, which must NOT then report the website stock it lowered as a
 * change nobody explained.
 */
const actor = { email: 'seller@jas.test', name: 'Seller' }
const g = globalThis as unknown as { __ccOpsData?: ReturnType<typeof emptyData> }
type Product = { id: number; quantity: number; in_stock: boolean; updated_at: string }

let closers: (() => Promise<void>)[] = []
beforeEach(() => {
  resetSourceCache()
  g.__ccOpsData = emptyData()
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'WEBSITE_URL', 'WEBSITE_COMMAND_CENTER_KEY']) delete process.env[k]
})
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})

async function website(products: Product[]) {
  const map = new Map(products.map((p) => [p.id, p]))
  const full = (p: Product) => ({ ...p, slug: `p-${p.id}`, name_he: 'x', price: 500, published: true, name_en: null, original_price: null, featured: false, image_url: null, categories: null })
  const s = await fakeServer((r: { body: string }) => {
    const b = JSON.parse(r.body) as Record<string, unknown>
    if (b.action === 'products-list') return { status: 200, body: { products: [...map.values()].filter((p) => !b.ids || (b.ids as number[]).includes(p.id)).map(full) } }
    if (b.action === 'orders-list') return { status: 200, body: { orders: [] } }
    if (b.action === 'stock-set') {
      const p = map.get(b.id as number)!
      if (p.quantity !== b.expectQuantity) return { status: 409, body: { error: 'Stock changed since it was read' } }
      p.quantity = b.quantity as number
      p.in_stock = p.quantity > 0
      return { status: 200, body: { product: { id: p.id, quantity: p.quantity, in_stock: p.in_stock, updated_at: new Date().toISOString() } } }
    }
    return { status: 400, body: { error: `unexpected ${String(b.action)}` } }
  })
  closers.push(s.close)
  process.env.WEBSITE_URL = s.url
  process.env.WEBSITE_COMMAND_CENTER_KEY = 'k'.repeat(40)
  return map
}

describe('a shop sale reaches every section', () => {
  it('sale, items, website stock, customer, delivery, snapshot, analytics, and a quiet sync', async () => {
    const products = await website([
      { id: 80, quantity: 3, in_stock: true, updated_at: '2026-10-01T00:00:00Z' },
      { id: 81, quantity: 1, in_stock: true, updated_at: '2026-10-01T00:00:00Z' },
    ])
    const ops = getOpsStore()
    const lot = await ops.createItem({ title: 'כיסאות', kind: 'batch', quantity: 3, status: 'listed', websiteProductId: 80, priceMinor: 9000, createdBy: actor.email }, { actorEmail: actor.email })
    const chair = await ops.createItem({ title: 'כורסה', status: 'listed', websiteProductId: 81, priceMinor: 50000, createdBy: actor.email }, { actorEmail: actor.email })
    const buyer = await ops.createContact({ fullName: 'Noa Cohen', phone: '0501234567', email: null, roles: ['customer'], source: 'in_store' })

    // The snapshot is read (and cached) before the sale: the sale must replace it, not wait out the cache.
    const before = await getOpsSnapshot()
    expect(before.state === 'ok' && before.data.items.awaitingDelivery).toBe(0)

    const sold = await createShopSale(
      { contactId: buyer.id, note: null, lines: [
        { itemId: lot.id, quantity: 2, unitPriceMinor: 9000, fulfilment: 'pickup' },
        { itemId: chair.id, quantity: 1, unitPriceMinor: 50000, fulfilment: 'delivery', address: 'Menachem Begin 34' },
      ] },
      'req-sync-1',
      actor,
    )
    expect(sold, sold.ok ? '' : sold.message).toMatchObject({ ok: true })
    expect(sold.ok && sold.warning).toBeFalsy()
    const sale = sold.ok ? sold.sale : null

    // /sales and /shop: the sale, for this customer, at its total.
    const listed = await getSalesStore().listSales({ contactId: buyer.id })
    expect(listed.map((x) => x.id)).toEqual([sale!.id])
    expect(listed[0]!.totalMinor).toBe(2 * 9000 + 50000)

    // Inventory: the lot keeps one unit on sale, the armchair is sold to the buyer.
    expect(await ops.getItem(lot.id)).toMatchObject({ status: 'listed', quantity: 1 })
    expect(await ops.getItem(chair.id)).toMatchObject({ status: 'sold', soldChannel: 'in_store', buyerContactId: buyer.id, soldPriceMinor: 50000 })

    // Website: exactly what is left here is what is on sale there.
    expect(products.get(80)!.quantity).toBe(1)
    expect(products.get(81)).toMatchObject({ quantity: 0, in_stock: false })

    // CRM: the purchase is on the customer's timeline, linked to the sale.
    const timeline = await ops.listInteractions({ contactId: buyer.id })
    expect(timeline.some((x) => x.refKind === 'sale' && x.refId === sale!.id)).toBe(true)

    // Deliveries: the delivery line is planned, for this customer.
    const deliveries = await ops.listDeliveries({ itemId: chair.id })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({ status: 'planned', contactId: buyer.id, address: 'Menachem Begin 34' })

    // Overview / top bar: the snapshot follows the sale at once.
    const after = await getOpsSnapshot()
    expect(after.state === 'ok' && after.data.items.awaitingDelivery).toBe(1)

    // Analytics: both lines count as in-store sales at their value.
    const today = israelDate()
    const movements = await ops.recentMovements(1000)
    const sec = inventorySection({ state: 'ok', data: { items: await ops.listItems({ limit: 5000 }), movements, deals: [], contacts: [], truncated: false }, checkedAt: new Date().toISOString() }, { from: today, to: today, label: 'today' } as never, { from: '2000-01-01', to: '2000-01-01', label: 'x' } as never)
    expect(sec.metrics.find((m) => m.id === 'inv.inStoreSales')?.value).toBe(2)
    expect(sec.metrics.find((m) => m.id === 'inv.inStoreValue')?.value).toBe(2 * 9000 + 50000)

    // The hourly sync sees the lowered website stock and agrees with it: no "changed on the website" task.
    resetSourceCache()
    const run = await runOpsSync()
    const products_ = run.steps.find((x) => x.step === 'website_products')
    expect(products_?.state, products_?.message).toBe('ok')
    const tasks = await ops.listTasks({ status: 'open' })
    expect(tasks.filter((t) => t.source === 'automation:website_stock')).toEqual([])
  })
})
