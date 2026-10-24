import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getOpsStore, ConflictError } from '@/lib/ops'
import { emptyData, memoryStore } from '@/lib/ops/memory'
import { adoptWebsiteProducts, hideWebsiteProducts, listManyOnWebsite, listOnWebsite, reserveItem, sellInStore, releaseItem } from '@/lib/inventory/service'
import { planProductAdoption } from '@/lib/sync/products'
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

type Product = { id: number; slug: string; name_he: string; price: number | null; quantity: number; in_stock: boolean; published: boolean; updated_at: string; category_id?: number | null; image_url?: string | null }
function website(opts: { orders?: unknown[]; inquiries?: unknown[]; failStockSet?: boolean } = {}) {
  const products = new Map<number, Product>()
  let next = 500
  const full = (p: Product) => ({ name_en: null, description_he: null, description_en: null, story_he: null, story_en: null, original_price: null, category_id: null, condition: null, style: null, dimensions: null, material: null, origin: null, image_url: null, images: [], featured: false, tags: [], created_at: p.updated_at, categories: null, ...p })
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
          if (b.id != null) {
            const old = products.get(b.id as number)
            if (!old) return { status: 404, body: { error: 'no product' } }
            if (old.updated_at !== b.expectUpdatedAt) return { status: 409, body: { error: 'changed' } }
            const p: Product = { ...old, published: input.published as boolean, updated_at: new Date(Date.parse(old.updated_at) + 1000).toISOString() }
            products.set(p.id, p)
            return { status: 200, body: { product: full(p) } }
          }
          if ([...products.values()].some((x) => x.slug === input.slug)) return { status: 409, body: { error: `Another product already uses the address /product/${String(input.slug)}` } }
          const p: Product = { id: ++next, slug: String(input.slug), name_he: String(input.name_he), price: input.price as number, quantity: input.quantity as number, in_stock: true, published: (input.published as boolean | undefined) ?? true, category_id: input.category_id as number | null, updated_at: new Date().toISOString() }
          products.set(p.id, p)
          return { status: 200, body: { product: full(p) } }
        }
        case 'product-update': {
          const p = products.get(b.id as number)
          if (!p) return { status: 404, body: { error: 'no product' } }
          if (p.updated_at !== b.expectUpdatedAt) return { status: 409, body: { error: 'changed' } }
          Object.assign(p, b.patch as object, { updated_at: new Date(Date.parse(p.updated_at) + 1000).toISOString() })
          return { status: 200, body: { product: full(p) } }
        }
        case 'product-get': {
          const p = products.get(b.id as number)
          return p ? { status: 200, body: { product: full(p) } } : { status: 404, body: { error: 'no product' } }
        }
        case 'product-meta':
          return { status: 200, body: { categories: [{ id: 3, name_he: 'שולחן אוכל', name_en: null, slug: 'dining' }], lowStockThreshold: 2 } }
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

  it('listing many publishes each in its category; a slug already taken is refused and the rest still go', async () => {
    const w = website()
    await connect(w)
    const a = await newItem({ sku: 'JAS-0001', category: 'שולחן אוכל' })
    const b = await newItem({ sku: 'JAS-0002', category: 'כיסא' })
    const c = await newItem({ sku: 'JAS-0003' })
    w.products.set(9, { id: 9, slug: 'jas-0003', name_he: 'old', price: 100, quantity: 1, in_stock: true, published: true, updated_at: '2026-10-01T00:00:00.000Z' })
    const r = await listManyOnWebsite([a.id, b.id, c.id], actor)
    expect(r.listed.map((i) => i.sku).sort()).toEqual(['JAS-0001', 'JAS-0002'])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0]).toContain('JAS-0003')
    const bySlug = new Map([...w.products.values()].map((p) => [p.slug, p]))
    expect(bySlug.get('jas-0001')).toMatchObject({ published: true, category_id: 3 })
    expect(bySlug.get('jas-0002')).toMatchObject({ published: true, category_id: null })
    expect((await getOpsStore().getItem(c.id))!.status).toBe('in_storage')
  })

  it('hiding unpublishes a website product and keeps it', async () => {
    const w = website()
    await connect(w)
    w.products.set(9, { id: 9, slug: 'old-chair', name_he: 'כיסא ישן', price: 100, quantity: 1, in_stock: true, published: true, updated_at: '2026-10-01T00:00:00.000Z', image_url: 'https://img/x.jpg' })
    const r = await hideWebsiteProducts([9], actor)
    expect(r).toMatchObject({ hidden: 1, refused: [] })
    expect(w.products.get(9)).toMatchObject({ published: false, quantity: 1 })
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

describe('products added on the website (studio /manager/quick) reach inventory', () => {
  const old = new Date(Date.now() - 3_600_000).toISOString()
  const product = (id: number, over: Partial<Product> = {}): Product => ({ id, slug: `p-${id}`, name_he: `כורסה ${id}`, price: 320, quantity: 1, in_stock: true, published: true, updated_at: old, ...over })
  const step = (r: Awaited<ReturnType<typeof runOpsSync>>) => r.steps.find((x) => x.step === 'website_products')!

  it('first run adopts nothing; later new products are adopted once, after they settle', async () => {
    const w = website()
    w.products.set(300, product(300))
    await connect(w)
    expect(step(await runOpsSync())).toMatchObject({ state: 'ok', counts: { adopted: 0 } })
    expect(await getOpsStore().listItems({})).toHaveLength(0)

    w.products.set(301, product(301, { quantity: 2, price: 149.9 }))
    w.products.set(302, product(302, { updated_at: new Date().toISOString() })) // still being edited in the studio
    w.products.set(303, product(303, { slug: 'jas-000009' })) // a command center listing, never adopted
    w.products.set(304, product(304, { quantity: 0, in_stock: false })) // nothing left to sell
    resetSourceCache()
    expect(step(await runOpsSync())).toMatchObject({ state: 'ok', counts: { adopted: 1 } })
    const [item] = await getOpsStore().listItems({ websiteProductIds: [301] })
    expect(item).toMatchObject({ title: 'כורסה 301', status: 'listed', quantity: 2, kind: 'batch', priceMinor: 14990, websiteProductId: 301 })
    expect((await getOpsStore().movements(item!.id))[0]).toMatchObject({ type: 'intake', refKind: 'website_product', refId: '301' })

    w.products.get(302)!.updated_at = old
    resetSourceCache()
    expect(step(await runOpsSync())).toMatchObject({ counts: { adopted: 1 } })
    resetSourceCache()
    await runOpsSync()
    expect((await getOpsStore().listItems({})).map((i) => i.websiteProductId).sort()).toEqual([301, 302])
  })

  it('a website sale of an adopted product sells the item; a studio "mark sold" opens one check task', async () => {
    const w = website()
    w.products.set(300, product(300))
    await connect(w)
    await runOpsSync()
    w.products.set(310, product(310))
    w.products.set(311, product(311))
    resetSourceCache()
    await runOpsSync()

    w.products.get(311)!.in_stock = false // "סימון כנמכר" in the studio, no order
    resetSourceCache()
    await runOpsSync()
    resetSourceCache()
    await runOpsSync()
    const checks = (await getOpsStore().listTasks({ status: 'open' })).filter((t) => t.source === 'automation:website_stock')
    expect(checks).toHaveLength(1)
    expect(checks[0]!.title).toMatch(/marked sold on the website/)

    const T = new Date().toISOString()
    const order = { id: 20, order_number: 'JAS-2001', customer_name: 'Dana Levi', customer_email: 'dana@x.com', customer_phone: '0501234567', items: [{ product_id: 310, price: 320, quantity: 1 }], subtotal: 320, shipping: 0, total: 320, status: 'paid', notes: null, paid_at: T, created_at: T, updated_at: T }
    const w2 = website({ orders: [order] })
    for (const [k, v] of w.products) w2.products.set(k, v)
    w2.products.get(310)!.quantity = 0
    w2.products.get(310)!.in_stock = false
    await connect(w2)
    resetSourceCache()
    await runOpsSync()
    const [sold] = await getOpsStore().listItems({ websiteProductIds: [310] })
    expect(sold).toMatchObject({ status: 'sold', soldChannel: 'website', websiteOrderNumber: 'JAS-2001' })
    expect(await getOpsStore().listContacts()).toHaveLength(1)
    expect((await getOpsStore().listTasks({ status: 'open' })).filter((t) => t.source === 'automation:website_stock')).toHaveLength(1)
  })

  it('older products are brought in by a person, once, and only with stock', async () => {
    const w = website()
    w.products.set(300, product(300))
    w.products.set(305, product(305, { quantity: 0, in_stock: false }))
    await connect(w)
    const shelf = await getOpsStore().saveLocation({ name: 'Shop floor', kind: 'shop' })
    const r = await adoptWebsiteProducts([300, 305, 999], { locationId: shelf.id }, actor)
    expect(r.created).toHaveLength(1)
    expect(r.created[0]).toMatchObject({ websiteProductId: 300, locationId: shelf.id, status: 'listed' })
    expect(r.refused.join(' ')).toMatch(/out of stock.*#999: no longer/)
    resetSourceCache()
    const again = await adoptWebsiteProducts([300], { locationId: null }, actor)
    expect(again.created).toHaveLength(0)
    expect(again.refused[0]).toMatch(/already in inventory/)
  })

  it('the cursor never passes a product that is still settling', () => {
    const now = Date.parse('2026-10-24T10:00:00Z')
    const p = (id: number, mins: number) => ({ id, slug: `p-${id}`, name_he: 'x', name_en: null, price: 1, original_price: null, quantity: 1, in_stock: true, featured: false, published: true, image_url: null, updated_at: new Date(now - mins * 60_000).toISOString() })
    expect(planProductAdoption([p(5, 60)], new Set(), null, now)).toEqual({ adopt: [], cursor: 5 })
    const r = planProductAdoption([p(6, 60), p(7, 1), p(8, 60)], new Set(), 5, now)
    expect(r.adopt.map((x) => x.id)).toEqual([6, 8])
    expect(r.cursor).toBe(6)
    expect(planProductAdoption([p(6, 60), p(7, 60), p(8, 60)], new Set([6, 8]), 6, now)).toMatchObject({ cursor: 8 })
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
