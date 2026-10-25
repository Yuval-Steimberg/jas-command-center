import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getOpsStore } from '@/lib/ops'
import { emptyData } from '@/lib/ops/memory'
import { getSalesStore } from '@/lib/sales/store'
import { saleMoney, spreadDiscount, discountFromInput } from '@/lib/sales/model'
import { createShopSale, handOverLine, recordPayment, returnSaleUnits, setLineFulfilment } from '@/lib/sales/service'
import { moveDelivery } from '@/lib/deliveries/service'
import { editItem } from '@/lib/inventory/service'

/**
 * Shop sales (migration 0006) against the in-memory store, which mirrors
 * cc_sale_create / cc_sale_return: a basket sells whole or not at all, a
 * request id replays, returns put units back, and the website loses a listed
 * item before the shop sells it.
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

async function website(products: Product[], opts: { failStockSet?: boolean } = {}) {
  const map = new Map(products.map((p) => [p.id, p]))
  const s = await fakeServer((r: { body: string }) => {
    const b = JSON.parse(r.body) as Record<string, unknown>
    const full = (p: Product) => ({ ...p, slug: `p-${p.id}`, name_he: 'x', price: 500, published: true, name_en: null, description_he: null, description_en: null, story_he: null, story_en: null, original_price: null, category_id: null, condition: null, style: null, dimensions: null, material: null, origin: null, image_url: null, images: [], featured: false, tags: [], created_at: p.updated_at, categories: null })
    if (b.action === 'products-list') return { status: 200, body: { products: [...map.values()].filter((p) => !b.ids || (b.ids as number[]).includes(p.id)).map(full) } }
    if (b.action === 'stock-set') {
      if (opts.failStockSet) return { status: 500, body: { error: 'down' } }
      const p = map.get(b.id as number)
      if (!p) return { status: 404, body: { error: 'no product' } }
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

const item = (over: Record<string, unknown> = {}) => getOpsStore().createItem({ title: 'כורסה', priceMinor: 50000, createdBy: actor.email, ...over }, { actorEmail: actor.email })
const customer = () => getOpsStore().createContact({ fullName: 'Noa Cohen', phone: '0501234567', email: null, roles: ['customer'], source: 'in_store' })
const line = (itemId: string, over: Record<string, unknown> = {}) => ({ itemId, quantity: 1, unitPriceMinor: 50000, fulfilment: 'pickup' as const, ...over })

describe('checkout: the whole basket or none of it', () => {
  it('sells several items with a deposit, plans the delivery line, and replays by request id', async () => {
    const a = await item()
    const b = await item({ title: 'שולחן', priceMinor: 120000 })
    const c = await customer()
    const input = { contactId: c.id, note: null, lines: [line(a.id), line(b.id, { unitPriceMinor: 110000, fulfilment: 'delivery', address: 'Begin 34, Tel Aviv', scheduledFor: '2026-11-02' })], payment: { amountMinor: 50000, method: 'cash' as const } }
    const r = await createShopSale(input, 'req-sale-1', actor)
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.sale.totalMinor).toBe(160000)
    const detail = (await getSalesStore().getSale(r.sale.id))!
    expect(saleMoney(detail.sale, detail.lines, detail.payments)).toMatchObject({ dueMinor: 160000, paidMinor: 50000, balanceMinor: 110000, state: 'deposit' })
    expect((await getOpsStore().getItem(a.id))).toMatchObject({ status: 'sold', soldChannel: 'in_store', soldPriceMinor: 50000, buyerContactId: c.id })
    const deliveries = await getOpsStore().listDeliveries({ saleLineIds: detail.lines.map((l) => l.id) })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({ itemId: b.id, address: 'Begin 34, Tel Aviv', scheduledFor: '2026-11-02', status: 'planned' })

    const again = await createShopSale(input, 'req-sale-1', actor)
    expect(again).toMatchObject({ ok: true, message: expect.stringContaining('Already recorded') })
    expect(await getSalesStore().listSales()).toHaveLength(1)
    expect((await getSalesStore().getSale(r.sale.id))!.payments).toHaveLength(1)
  })

  it('refuses the whole basket when one item is already sold', async () => {
    const a = await item()
    const b = await item({ title: 'מנורה' })
    expect(await createShopSale({ contactId: null, note: null, lines: [line(b.id)] }, 'req-first', actor)).toMatchObject({ ok: true })
    const r = await createShopSale({ contactId: null, note: null, lines: [line(a.id), line(b.id)] }, 'req-second', actor)
    expect(r.ok).toBe(false)
    expect((await getOpsStore().getItem(a.id))!.status).toBe('in_storage')
    expect(await getSalesStore().listSales()).toHaveLength(1)
  })

  it('sells units of a lot; selling the last units marks it sold', async () => {
    const lot = await item({ title: 'כיסאות', quantity: 4, kind: 'batch', priceMinor: 9000 })
    await createShopSale({ contactId: null, note: null, lines: [line(lot.id, { quantity: 3, unitPriceMinor: 9000 })] }, 'req-lot-1', actor)
    expect(await getOpsStore().getItem(lot.id)).toMatchObject({ quantity: 1, status: 'in_storage' })
    expect((await createShopSale({ contactId: null, note: null, lines: [line(lot.id, { quantity: 2, unitPriceMinor: 9000 })] }, 'req-lot-2', actor)).ok).toBe(false)
    await createShopSale({ contactId: null, note: null, lines: [line(lot.id, { quantity: 1, unitPriceMinor: 9000 })] }, 'req-lot-3', actor)
    expect(await getOpsStore().getItem(lot.id)).toMatchObject({ quantity: 0, status: 'sold' })
  })

  it('takes a listed item off the website first; a website failure sells nothing', async () => {
    const products = await website([{ id: 70, quantity: 1, in_stock: true, updated_at: '2026-10-01T00:00:00Z' }])
    const listed = await item({ status: 'listed', websiteProductId: 70 })
    const sold = await createShopSale({ contactId: null, note: null, lines: [line(listed.id)] }, 'req-web-1', actor)
    expect(sold, sold.message).toMatchObject({ ok: true })
    expect(products.get(70)!.quantity).toBe(0)

    await Promise.all(closers.map((c) => c()))
    closers = []
    resetSourceCache()
    await website([{ id: 71, quantity: 1, in_stock: true, updated_at: '2026-10-01T00:00:00Z' }], { failStockSet: true })
    const other = await item({ status: 'listed', websiteProductId: 71 })
    const r = await createShopSale({ contactId: null, note: null, lines: [line(other.id)] }, 'req-web-2', actor)
    expect(r.ok).toBe(false)
    expect((await getOpsStore().getItem(other.id))!.status).toBe('listed')
  })
})

describe('after the sale', () => {
  it('a pickup handed over marks the item delivered; a delivery line closes with its delivery', async () => {
    const a = await item()
    const b = await item({ title: 'ספה' })
    const c = await customer()
    const r = await createShopSale({ contactId: c.id, note: null, lines: [line(a.id), line(b.id, { fulfilment: 'delivery', address: 'Herzl 1' })] }, 'req-ho', actor)
    if (!r.ok) throw new Error(r.message)
    const [la, lb] = (await getSalesStore().getSale(r.sale.id))!.lines
    expect(await handOverLine(la!.id, actor)).toMatchObject({ ok: true })
    expect((await getOpsStore().getItem(a.id))!.status).toBe('delivered')
    expect(await handOverLine(la!.id, actor)).toMatchObject({ ok: false })

    const d = (await getOpsStore().listDeliveries({ saleLineIds: [lb!.id] }))[0]!
    expect(await moveDelivery(d, 'done', null, actor, false)).toMatchObject({ ok: true })
    expect((await getSalesStore().getLine(lb!.id))!.status).toBe('done')
    expect((await getOpsStore().getItem(b.id))!.status).toBe('delivered')
  })

  it('switching a delivery to pickup cancels the planned delivery', async () => {
    const a = await item()
    const c = await customer()
    const r = await createShopSale({ contactId: c.id, note: null, lines: [line(a.id, { fulfilment: 'delivery', address: 'Herzl 1' })] }, 'req-sw', actor)
    if (!r.ok) throw new Error(r.message)
    const l = (await getSalesStore().getSale(r.sale.id))!.lines[0]!
    expect(await setLineFulfilment(l.id, 'pickup', { address: null, scheduledFor: null, timeWindow: null }, actor)).toMatchObject({ ok: true })
    expect((await getOpsStore().listDeliveries({ saleLineIds: [l.id] }))[0]!.status).toBe('cancelled')
    expect(await setLineFulfilment(l.id, 'delivery', { address: 'Dizengoff 5', scheduledFor: '2026-11-03', timeWindow: null }, actor)).toMatchObject({ ok: true, message: 'Delivery planned.' })
  })

  it('returns units of a lot, refuses more than the customer has, and a refund settles the money', async () => {
    const lot = await item({ title: 'כוסות', quantity: 5, kind: 'batch', priceMinor: 2000 })
    const r = await createShopSale({ contactId: null, note: null, lines: [line(lot.id, { quantity: 3, unitPriceMinor: 2000 })], payment: { amountMinor: 6000, method: 'card' } }, 'req-ret', actor)
    if (!r.ok) throw new Error(r.message)
    const l = (await getSalesStore().getSale(r.sale.id))!.lines[0]!
    expect(await returnSaleUnits(l.id, 4, 0, null, 'too many', actor)).toMatchObject({ ok: false })
    expect(await returnSaleUnits(l.id, 2, 0, null, 'chipped', actor)).toMatchObject({ ok: true })
    expect(await returnSaleUnits(l.id, 1, 0, null, 'stale form', actor)).toMatchObject({ ok: false })
    expect((await getOpsStore().getItem(lot.id))!.quantity).toBe(4)
    let detail = (await getSalesStore().getSale(r.sale.id))!
    expect(saleMoney(detail.sale, detail.lines, detail.payments)).toMatchObject({ dueMinor: 2000, balanceMinor: -4000, state: 'overpaid' })
    expect(await recordPayment(r.sale.id, { amountMinor: -4000, method: 'card', note: null }, 'refund-1', actor)).toMatchObject({ ok: true })
    expect(await recordPayment(r.sale.id, { amountMinor: -4000, method: 'card', note: null }, 'refund-1', actor)).toMatchObject({ ok: true, message: 'Already recorded.' })
    detail = (await getSalesStore().getSale(r.sale.id))!
    expect(saleMoney(detail.sale, detail.lines, detail.payments)).toMatchObject({ balanceMinor: 0, state: 'paid' })
  })

  it('a whole unique item returned goes back to storage and its line is marked returned', async () => {
    const a = await item()
    const r = await createShopSale({ contactId: null, note: null, lines: [line(a.id)] }, 'req-ret-1', actor)
    if (!r.ok) throw new Error(r.message)
    const l = (await getSalesStore().getSale(r.sale.id))!.lines[0]!
    expect(await returnSaleUnits(l.id, 1, 0, null, 'wrong size', actor)).toMatchObject({ ok: true })
    expect(await getOpsStore().getItem(a.id)).toMatchObject({ status: 'in_storage', soldAt: null, soldPriceMinor: null })
    expect((await getSalesStore().getLine(l.id))!.status).toBe('returned')
    expect((await getOpsStore().movements(a.id)).map((m) => m.type)).toEqual(expect.arrayContaining(['sell', 'return']))
  })
})

describe('editing an item', () => {
  it('records only changed fields, before and after', async () => {
    const a = await item({ colors: 'ירוק' })
    expect(await editItem(a.id, a.version, { title: 'כורסה', priceMinor: 55000, colors: 'ירוק' }, actor)).toMatchObject({ ok: true })
    const edit = (await getOpsStore().movements(a.id)).find((m) => m.type === 'edit')!
    expect(edit.detail.changes).toEqual({ priceMinor: { from: 50000, to: 55000 } })
    const cur = (await getOpsStore().getItem(a.id))!
    expect(await editItem(a.id, cur.version, { priceMinor: 55000 }, actor)).toMatchObject({ ok: true, message: 'Nothing changed.' })
  })
})

describe('discount and coupon code', () => {
  it('spreads a sale discount over the lines in whole agorot, never past a line', () => {
    expect(spreadDiscount([50000, 110000], 16000)).toEqual([5000, 11000])
    expect(spreadDiscount([100, 100, 100], 100)).toEqual([34, 33, 33])
    expect(spreadDiscount([1, 0], 1)).toEqual([1, 0])
    expect(spreadDiscount([500], 0)).toEqual([0])
    expect(discountFromInput('percent', '10', 35000)).toBe(3500)
    expect(discountFromInput('amount', '₪ 1,250.5', 0)).toBe(125050)
    expect(discountFromInput('amount', '', 100)).toBe(0)
    expect(discountFromInput('percent', '120', 100)).toBeNull()
    expect(discountFromInput('amount', 'abc', 100)).toBeNull()
  })

  it('sells at the discounted price: total, sold price, analytics movement, coupon kept as typed', async () => {
    const a = await item()
    const b = await item({ title: 'שולחן', priceMinor: 110000 })
    const r = await createShopSale({ contactId: null, note: null, lines: [line(a.id), line(b.id, { unitPriceMinor: 110000 })], discountMinor: 16000, couponCode: ' SUMMER10 ', payment: { amountMinor: 144000, method: 'cash' } }, 'req-disc-1', actor)
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('discount') })
    if (!r.ok) return
    expect(r.sale).toMatchObject({ totalMinor: 144000, discountMinor: 16000, couponCode: 'SUMMER10' })
    const detail = (await getSalesStore().getSale(r.sale.id))!
    expect(detail.lines.map((l) => l.discountMinor)).toEqual([5000, 11000])
    expect(saleMoney(detail.sale, detail.lines, detail.payments)).toMatchObject({ totalMinor: 144000, discountMinor: 16000, dueMinor: 144000, balanceMinor: 0, state: 'paid' })
    expect((await getOpsStore().getItem(a.id))!.soldPriceMinor).toBe(45000)
    const moves = await getOpsStore().movements(b.id)
    expect(moves.find((m) => m.type === 'sell')!.detail.priceMinor).toBe(99000)
  })

  it('a return gives back what was paid for those units, the whole share when the whole line comes back', async () => {
    const lot = await item({ title: 'כיסאות', quantity: 3, kind: 'batch', priceMinor: 1000 })
    const r = await createShopSale({ contactId: null, note: null, lines: [line(lot.id, { quantity: 3, unitPriceMinor: 1000 })], discountMinor: 100, payment: null }, 'req-disc-2', actor)
    if (!r.ok) throw new Error(r.message)
    const l = (await getSalesStore().getSale(r.sale.id))!.lines[0]!
    const one = await returnSaleUnits(l.id, 1, 0, null, 'did not fit', actor)
    expect(one.message).toContain('₪9.67')
    const two = await returnSaleUnits(l.id, 2, 1, null, 'did not fit', actor)
    expect(two.message).toContain('₪19.33')
    const detail = (await getSalesStore().getSale(r.sale.id))!
    expect(saleMoney(detail.sale, detail.lines, detail.payments)).toMatchObject({ totalMinor: 2900, returnedMinor: 2900, dueMinor: 0 })
  })

  it('refuses a discount larger than the sale', async () => {
    const a = await item()
    expect(await createShopSale({ contactId: null, note: null, lines: [line(a.id)], discountMinor: 50001, payment: null }, 'req-disc-3', actor)).toMatchObject({ ok: false, message: expect.stringContaining('larger') })
  })
})
