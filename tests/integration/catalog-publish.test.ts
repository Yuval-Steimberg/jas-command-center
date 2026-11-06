import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getOpsStore } from '@/lib/ops'
import { emptyData } from '@/lib/ops/memory'

/**
 * Catalog photos + automatic publishing end to end: the in-memory store, a
 * fake website implementing product-save / product-update / product-get, and
 * Photoroom + the photo store replaced (no network, no Supabase).
 */
const pr = vi.hoisted(() => ({ calls: 0, fail: false }))
vi.mock('@/lib/inventory/photoroom', () => ({
  photoroomConfigured: () => true,
  photoroomCatalog: async () => {
    pr.calls++
    return pr.fail ? { ok: false, message: 'Photoroom answered 500' } : { ok: true, bytes: new ArrayBuffer(8), type: 'image/jpeg' }
  },
}))
vi.mock('@/lib/inventory/photos', async (orig) => ({
  ...(await orig<typeof import('@/lib/inventory/photos')>()),
  uploadInventoryPhoto: async () => `https://store.example/catalog-${pr.calls}.jpg`,
}))

const { publishIfReady, runWebsiteAutoPublish, setCatalogPhotoOff, setShownOnWebsite, editItem } = await import('@/lib/inventory/service')

const actor = { email: 'owner@jas.test', name: 'Owner' }
const g = globalThis as unknown as { __ccOpsData?: ReturnType<typeof emptyData> }
type P = { id: number; slug: string; published: boolean; image_url: string | null; images: string[]; quantity: number; updated_at: string }

function website() {
  const products = new Map<number, P>()
  let next = 700
  const full = (p: P) => ({ name_he: 'x', name_en: null, description_he: null, description_en: null, story_he: null, story_en: null, price: 450, original_price: null, category_id: null, condition: null, style: null, dimensions: null, material: null, origin: null, featured: false, in_stock: true, tags: [], created_at: p.updated_at, categories: null, ...p })
  const bump = (p: P) => { p.updated_at = new Date(Date.parse(p.updated_at) + 1000).toISOString() }
  return {
    products,
    handler: (r: { body: string }) => {
      const b = JSON.parse(r.body) as Record<string, unknown>
      if (b.action === 'product-meta') return { status: 200, body: { categories: [], lowStockThreshold: 2 } }
      if (b.action === 'product-save') {
        const i = b.product as Record<string, unknown>
        const p: P = { id: ++next, slug: String(i.slug), published: i.published as boolean, image_url: i.image_url as string, images: i.images as string[], quantity: i.quantity as number, updated_at: '2026-11-06T10:00:00.000Z' }
        products.set(p.id, p)
        return { status: 200, body: { product: full(p) } }
      }
      const p = products.get(b.id as number)
      if (!p) return { status: 404, body: { error: 'no product' } }
      if (b.action === 'product-get' || b.action === 'products-list') return { status: 200, body: b.action === 'product-get' ? { product: full(p) } : { products: [full(p)] } }
      if (b.action === 'product-update') {
        if (p.updated_at !== b.expectUpdatedAt) return { status: 409, body: { error: 'changed' } }
        Object.assign(p, b.patch as object)
        bump(p)
        return { status: 200, body: { product: full(p) } }
      }
      return { status: 400, body: { error: `unexpected ${String(b.action)}` } }
    },
  }
}

const realFetch = globalThis.fetch
let closers: (() => Promise<void>)[] = []
beforeEach(() => {
  resetSourceCache()
  g.__ccOpsData = emptyData()
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'WEBSITE_URL', 'WEBSITE_COMMAND_CENTER_KEY']) delete process.env[k]
  pr.calls = 0
  pr.fail = false
  // The item's photo: any https://img.example link answers with a small JPEG.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://img.example/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    return realFetch(input, init)
  }) as typeof fetch
})
afterEach(async () => {
  globalThis.fetch = realFetch
  await Promise.all(closers.map((c) => c()))
  closers = []
})
async function connect() {
  const w = website()
  const s = await fakeServer(w.handler)
  closers.push(s.close)
  process.env.WEBSITE_URL = s.url
  process.env.WEBSITE_COMMAND_CENTER_KEY = 'k'.repeat(40)
  return w
}
const newItem = (over: Record<string, unknown> = {}) =>
  getOpsStore().createItem({ title: 'שולחן', priceMinor: 45000, photoUrl: 'https://img.example/orig.jpg', extraPhotos: ['https://img.example/side.jpg'], websiteWanted: true, createdBy: actor.email, ...over }, { actorEmail: actor.email })

describe('marked for the website → goes up by itself, with a catalog photo', () => {
  it('waits for an approved price, then publishes with the catalog photo and the originals in the gallery', async () => {
    const w = await connect()
    const i = await newItem({ priceApproved: false })
    expect(await runWebsiteAutoPublish(actor)).toMatchObject({ listed: 0, waiting: 1 })
    expect(w.products.size).toBe(0)
    expect(pr.calls).toBe(0)

    const approved = await editItem(i.id, i.version, { priceApproved: true }, actor)
    expect(approved.ok).toBe(true)
    expect(await publishIfReady(i.id, actor)).toMatchObject({ state: 'listed' })
    const p = [...w.products.values()][0]!
    expect(p).toMatchObject({ published: true, image_url: 'https://store.example/catalog-1.jpg', images: ['https://img.example/orig.jpg', 'https://img.example/side.jpg'] })
    expect(await getOpsStore().getItem(i.id)).toMatchObject({ status: 'listed', photoUrl: 'https://img.example/orig.jpg', catalogPhotoFrom: 'https://img.example/orig.jpg' })
  })

  it('an item nobody marked is never published by the automatic step', async () => {
    const w = await connect()
    await newItem({ websiteWanted: false })
    expect(await runWebsiteAutoPublish(actor)).toMatchObject({ listed: 0, waiting: 0 })
    expect(w.products.size).toBe(0)
  })

  it('a workshop item waits; "don\'t put it on the website" stops it for good', async () => {
    const w = await connect()
    const ws = await getOpsStore().saveLocation({ name: 'בית מלאכה', kind: 'zone' })
    const i = await newItem({ locationId: ws.id })
    expect(await runWebsiteAutoPublish(actor)).toMatchObject({ waiting: 1 })
    expect(await setShownOnWebsite(i.id, false, actor)).toMatchObject({ ok: true })
    const cur = (await getOpsStore().getItem(i.id))!
    expect(cur.websiteWanted).toBe(false)
    await getOpsStore().applyItem(i.id, {}, { locationId: null }, { type: 'move', actorEmail: 'x' })
    expect(await runWebsiteAutoPublish(actor)).toMatchObject({ listed: 0, waiting: 0 })
    expect(w.products.size).toBe(0)
  })

  it('the hourly run counts catalog photos made while publishing, and reports a Photoroom failure', async () => {
    await connect()
    await newItem()
    expect(await runWebsiteAutoPublish(actor)).toMatchObject({ listed: 1, photos: 1, problems: [] })
    pr.fail = true
    await newItem({ photoUrl: 'https://img.example/other.jpg' })
    const r = await runWebsiteAutoPublish(actor)
    expect(r).toMatchObject({ listed: 1, photos: 0 })
    expect(r.problems.join(' ')).toMatch(/No catalog photo: Photoroom answered 500/)
  })

  it('Photoroom failing never blocks the sale: listed with the original, and not retried every hour', async () => {
    const w = await connect()
    pr.fail = true
    const i = await newItem()
    const r = await publishIfReady(i.id, actor)
    expect(r).toMatchObject({ state: 'listed' })
    expect(r.state === 'listed' && r.warning).toMatch(/No catalog photo/)
    expect([...w.products.values()][0]).toMatchObject({ image_url: 'https://img.example/orig.jpg', images: ['https://img.example/side.jpg'] })
    expect(await getOpsStore().getItem(i.id)).toMatchObject({ catalogPhotoError: 'Photoroom answered 500', catalogPhotoUrl: null })
    await runWebsiteAutoPublish(actor)
    await runWebsiteAutoPublish(actor)
    expect(pr.calls).toBe(1)
  })

  it('"use the original photo" swaps the website back; the catalog photo is kept to switch again', async () => {
    const w = await connect()
    const i = await newItem()
    await publishIfReady(i.id, actor)
    expect(await setCatalogPhotoOff(i.id, true, actor)).toMatchObject({ ok: true })
    const p = [...w.products.values()][0]!
    expect(p).toMatchObject({ image_url: 'https://img.example/orig.jpg', images: ['https://img.example/side.jpg'] })
    expect(await getOpsStore().getItem(i.id)).toMatchObject({ catalogPhotoOff: true, catalogPhotoUrl: 'https://store.example/catalog-1.jpg' })
    await setCatalogPhotoOff(i.id, false, actor)
    expect(p.image_url).toBe('https://store.example/catalog-1.jpg')
    expect(pr.calls).toBe(1)
  })

  it('a new main photo on a listed item gets a new catalog photo on the next hourly run', async () => {
    const w = await connect()
    const i = await newItem()
    await publishIfReady(i.id, actor)
    const cur = (await getOpsStore().getItem(i.id))!
    await editItem(i.id, cur.version, { photoUrl: 'https://img.example/better.jpg' }, actor)
    expect(await runWebsiteAutoPublish(actor)).toMatchObject({ photos: 1 })
    expect([...w.products.values()][0]).toMatchObject({ image_url: 'https://store.example/catalog-2.jpg', images: ['https://img.example/better.jpg', 'https://img.example/side.jpg'] })
  })
})
