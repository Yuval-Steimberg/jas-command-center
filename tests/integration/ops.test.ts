import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getOpsStore, ConflictError } from '@/lib/ops'
import { emptyData, memoryStore } from '@/lib/ops/memory'
import { listOnWebsite, reserveItem, sellInStore, releaseItem } from '@/lib/inventory/service'
import { runOpsSync } from '@/lib/sync/run'
import { proposalDef } from '@/lib/assistant/proposals'

/**
 * The operational modules end to end against the in-memory store (same
 * semantics as the SQL functions in 0003) and a fake website that implements
 * the website's own contract: products-list by ids, a compare-and-set
 * stock-set, product-save / product-delete, orders-list since, inquiries-list.
 */
const actor = { email: 'owner@jas.test', name: 'Owner' }
const g = globalThis as unknown as { __ccOpsData?: ReturnType<typeof emptyData> }

type Product = { id: number; slug: string; name_he: string; price: number | null; quantity: number; in_stock: boolean; published: boolean; updated_at: string }
function website(opts: { orders?: unknown[]; inquiries?: unknown[]; failStockSet?: boolean } = {}) {
  const products = new Map<number, Product>()
  let next = 500
  const full = (p: Product) => ({ ...p, name_en: null, description_he: null, description_en: null, story_he: null, story_en: null, original_price: null, category_id: null, condition: null, style: null, dimensions: null, material: null, origin: null, image_url: null, images: [], featured: false, tags: [], created_at: p.updated_at, categories: null })
  return {
    products,
    handler: (r: { body: string }) => {
      const b = JSON.parse(r.body) as Record<string, unknown>
      switch (b.action) {
        case 'products-list':
          return { status: 200, body: { products: [...products.values()].filter((p) => !b.ids || (b.ids as number[]).includes(p.id)).map(full) } }
        case 'stock-set': {
          if (opts.failStockSet) return { status: 500, body: { error: 'down' } }
          const p = products.get(b.id as number)
          if (!p) return { status: 404, body: { error: 'no product' } }
          if (p.quantity !== b.expectQuantity) return { status: 409, body: { error: 'Stock changed since it was read' } }
          p.quantity = b.quantity as number
          p.in_stock = p.quantity > 0
          p.updated_at = new Date().toISOString()
          return { status: 200, body: { product: { id: p.id, quantity: p.quantity, in_stock: p.in_stock, updated_at: p.updated_at } } }
        }
        case 'product-save': {
          const input = b.product as Record<string, unknown>
          const p: Product = { id: ++next, slug: String(input.slug), name_he: String(input.name_he), price: input.price as number, quantity: input.quantity as number, in_stock: true, published: false, updated_at: new Date().toISOString() }
          products.set(p.id, p)
          return { status: 200, body: { product: full(p) } }
        }
        case 'product-delete':
          products.delete(b.id as number)
          return { status: 200, body: { deleted: { id: b.id, slug: 'x' } } }
        case 'orders-list':
          return { status: 200, body: { orders: opts.orders ?? [] } }
        case 'inquiries-list':
          return { status: 200, body: { inquiries: opts.inquiries ?? [], openCount: 0 } }
        default:
          return { status: 400, body: { error: `unexpected ${String(b.action)}` } }
      }
    },
  }
}

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
async function connect(w: ReturnType<typeof website>) {
  const s = await fakeServer(w.handler)
  closers.push(s.close)
  process.env.WEBSITE_URL = s.url
  process.env.WEBSITE_COMMAND_CENTER_KEY = 'k'.repeat(40)
  return s
}
const newItem = (over: Record<string, unknown> = {}) =>
  getOpsStore().createItem({ title: 'שולחן אוכל אלון', priceMinor: 45000, photoUrl: 'https://img.example/t.jpg', createdBy: actor.email, ...over }, { actorEmail: actor.email })
const newContact = () => getOpsStore().createContact({ fullName: 'Dana Levi', email: 'dana@x.com', phone: '0501234567', roles: ['customer'], source: 'manual' })

describe('the store: one item, one outcome', () => {
  it('two reservations racing for one item: exactly one wins, one movement, one version bump', async () => {
    const store = memoryStore()
    const it0 = await store.createItem({ title: 'Lamp' }, { actorEmail: 'a' })
    const attempt = (who: string) => store.applyItem(it0.id, { version: 1, from: ['in_storage', 'listed'] }, { status: 'reserved', reservedFor: who }, { type: 'reserve', actorEmail: who })
    const results = await Promise.allSettled([attempt('a'), attempt('b')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toBeInstanceOf(ConflictError)
    expect((await store.movements(it0.id)).map((m) => m.type).sort()).toEqual(['intake', 'reserve'])
    expect((await store.getItem(it0.id))!.version).toBe(2)
  })

  it('replaying a movement with the same ref changes nothing; one field item enters inventory once', async () => {
    const store = memoryStore()
    const a = await store.createItem({ title: 'Chair', furnitureItemId: 'f-1', status: 'listed' }, { actorEmail: 'a' })
    const sell = () => store.applyItem(a.id, { from: ['listed'] }, { status: 'sold' }, { type: 'sell', refKind: 'website_order', refId: '10', actorEmail: 'sync' })
    await sell()
    await sell()
    expect((await store.movements(a.id)).filter((m) => m.type === 'sell')).toHaveLength(1)
    await expect(store.createItem({ title: 'Chair again', furnitureItemId: 'f-1' }, { actorEmail: 'a' })).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('inventory ↔ website: sellable in exactly one place', () => {
  it('listing creates an unpublished draft and links it', async () => {
    const w = website()
    await connect(w)
    const i = await newItem()
    const r = await listOnWebsite(i.id, i.version, {}, actor)
    expect(r).toMatchObject({ ok: true })
    const p = [...w.products.values()][0]!
    expect(p).toMatchObject({ slug: i.sku.toLowerCase(), price: 450, published: false, quantity: 1 })
    expect((await getOpsStore().getItem(i.id))).toMatchObject({ status: 'listed', websiteProductId: p.id })
  })

  it('reserving a listed item takes it off sale online; releasing puts it back', async () => {
    const w = website()
    await connect(w)
    const i = await newItem()
    await listOnWebsite(i.id, 1, {}, actor)
    const listed = (await getOpsStore().getItem(i.id))!
    const c = await newContact()
    resetSourceCache()
    expect(await reserveItem(i.id, listed.version, c.id, 3, null, actor)).toMatchObject({ ok: true })
    expect(w.products.get(listed.websiteProductId!)!.quantity).toBe(0)
    resetSourceCache()
    expect(await releaseItem(i.id, 'changed their mind', actor)).toMatchObject({ ok: true })
    expect(w.products.get(listed.websiteProductId!)!.quantity).toBe(1)
    expect((await getOpsStore().getItem(i.id))!.status).toBe('listed')
  })

  it('when the website cannot be taken off sale, the in-store sale is refused and nothing changes here', async () => {
    const w = website({ failStockSet: true })
    await connect(w)
    const i = await newItem()
    const p = { id: 900, slug: 'jas-x', name_he: 'x', price: 450, quantity: 1, in_stock: true, published: true, updated_at: new Date().toISOString() }
    w.products.set(900, p)
    const linked = await getOpsStore().applyItem(i.id, { from: ['in_storage'] }, { status: 'listed', websiteProductId: 900 }, { type: 'list', actorEmail: actor.email })
    const r = await sellInStore(i.id, linked.version, { priceMinor: 45000, contactId: null, note: null }, actor)
    expect(r.ok).toBe(false)
    expect((await getOpsStore().getItem(i.id))!.status).toBe('listed')
    expect(p.quantity).toBe(1)
  })
})

describe('the website sync', () => {
  const T = '2026-10-23T08:00:00.000Z'
  it('a paid website order sells the linked item, creates the customer, and is idempotent', async () => {
    const i = await newItem()
    const linked = await getOpsStore().applyItem(i.id, { from: ['in_storage'] }, { status: 'listed', websiteProductId: 77 }, { type: 'list', actorEmail: actor.email })
    const order = { id: 10, order_number: 'JAS-1001', customer_name: 'Dana Levi', customer_email: 'Dana@X.com', customer_phone: '+972 50-123-4567', items: [{ product_id: 77, name_he: 'שולחן', price: 450, quantity: 1 }], subtotal: 450, shipping: 0, total: 450, status: 'paid', notes: null, paid_at: T, created_at: T, updated_at: T }
    await connect(website({ orders: [order] }))
    const r1 = await runOpsSync()
    expect(r1.steps.find((s) => s.step === 'website_orders')).toMatchObject({ state: 'ok', counts: { sold: 1, customers: 1 } })
    const sold = (await getOpsStore().getItem(linked.id))!
    expect(sold).toMatchObject({ status: 'sold', soldChannel: 'website', websiteOrderNumber: 'JAS-1001', soldPriceMinor: 45000 })
    const contacts = await getOpsStore().listContacts()
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({ email: 'dana@x.com', phone: '0501234567', roles: ['customer'] })
    expect((await getOpsStore().listTasks({ status: 'open' })).map((t) => t.source)).toContain('automation:sale_needs_delivery')

    resetSourceCache()
    await runOpsSync()
    expect((await getOpsStore().movements(linked.id)).filter((m) => m.type === 'sell')).toHaveLength(1)
    expect(await getOpsStore().listContacts()).toHaveLength(1)
  })

  it('an item sold in the shop and then paid for online becomes a double-sale task, never a second sale', async () => {
    const i = await newItem()
    await getOpsStore().applyItem(i.id, { from: ['in_storage'] }, { status: 'sold', soldChannel: 'in_store', websiteProductId: 78 }, { type: 'sell', actorEmail: actor.email })
    await connect(website({ orders: [{ id: 11, order_number: 'JAS-1002', customer_name: null, customer_email: null, customer_phone: null, items: [{ product_id: 78, price: 450, quantity: 1 }], subtotal: 450, shipping: 0, total: 450, status: 'paid', notes: null, paid_at: T, created_at: T, updated_at: T }] }))
    await runOpsSync()
    const tasks = await getOpsStore().listTasks({ status: 'open' })
    expect(tasks.filter((t) => t.source === 'automation:double_sale')).toHaveLength(1)
    expect((await getOpsStore().movements(i.id)).filter((m) => m.type === 'sell')).toHaveLength(1)
  })

  it('a website form message becomes one contact, one lead and one reply task', async () => {
    await connect(website({ inquiries: [{ id: 5, kind: 'contact', name: 'Noa', phone: '0521112222', email: null, subject: 'ספה', message: 'יש לכם ספה?', photos: [], emailed: true, handled_at: null, handled_by: null, created_at: T }] }))
    await runOpsSync()
    resetSourceCache()
    await runOpsSync()
    expect(await getOpsStore().listDeals()).toHaveLength(1)
    expect((await getOpsStore().listTasks({ status: 'open' })).filter((t) => t.source === 'automation:website_form_lead')).toHaveLength(1)
  })
})

describe('assistant proposals for inventory write nothing until confirmed', () => {
  it('propose reserve: looks up, describes without the name, changes nothing', async () => {
    const w = website()
    await connect(w)
    const i = await newItem()
    const c = await newContact()
    const before = JSON.stringify(g.__ccOpsData)
    const r = await proposalDef('inventory_reserve')!.prepare({ itemId: i.id, contactId: c.id, days: 2, note: null })
    expect(r).toMatchObject({ ok: true, params: { version: 1 } })
    expect(r.ok && r.summary).not.toContain('Dana')
    expect(JSON.stringify(g.__ccOpsData)).toBe(before)
  })

  it('propose listing: refuses an item with no price, writes nothing to the website', async () => {
    const w = website()
    const s = await connect(w)
    const i = await newItem({ priceMinor: null })
    expect(await proposalDef('inventory_list_on_website')!.prepare({ itemId: i.id })).toMatchObject({ ok: false })
    const ok = await newItem()
    expect(await proposalDef('inventory_list_on_website')!.prepare({ itemId: ok.id })).toMatchObject({ ok: true })
    expect(s.seen).toHaveLength(0)
    expect(w.products.size).toBe(0)
  })

  it('propose task: describes it and creates nothing', async () => {
    const r = await proposalDef('task_create')!.prepare({ title: 'Call the buyer', dueDate: '2026-10-25', itemId: null })
    expect(r).toMatchObject({ ok: true })
    expect(await getOpsStore().listTasks()).toHaveLength(0)
  })
})
