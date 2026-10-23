import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getWebsiteSnapshot, websiteAdapter } from '@/lib/integrations/website/adapter'
import { editGiftCardRecipient, getGiftCard, getGiftCardSummary, giftCardsAdapter, resendGiftCard, runCardLifecycle, searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getDesignAgentHealthz, designAgentAdapter, retryDeadJob } from '@/lib/integrations/design-agent/adapter'
import { allHealth } from '@/lib/integrations/registry'
import { getFurnitureProject, setItemDestination, setProjectArchived } from '@/lib/integrations/furniture/manage'
import { listWebsiteInquiries, setWebsiteInquiryHandled, uploadWebsiteImage, sendWebsiteCampaign, listWebsiteDiscounts, saveWebsiteDiscount, deleteWebsiteDiscount, listWebsiteSubscribers, listWebsiteCampaigns, getWebsitePost, saveWebsitePost, getWebsiteProduct, getWebsiteProductMeta, saveWebsiteProduct, deleteWebsiteProduct, createWebsiteCategory, deleteWebsiteReviews, listWebsiteReviews, setWebsiteReviewsApproved, listWebsiteContent, listWebsiteOrders, listWebsiteProducts, setWebsiteContent, setWebsiteOrderStatus, updateWebsiteProduct } from '@/lib/integrations/website/manage'
import { websiteSnapshotFixture, giftSummaryFixture } from '../fixtures/sources'

const ENV_KEYS = ['WEBSITE_URL', 'WEBSITE_AGENT_API_KEY', 'WEBSITE_COMMAND_CENTER_KEY', 'GIFT_CARDS_URL', 'GIFT_CARDS_INTEGRATION_KEY', 'FURNITURE_SUPABASE_URL', 'FURNITURE_SUPABASE_KEY', 'FURNITURE_APP_URL', 'DESIGN_AGENT_URL', 'DESIGN_AGENT_ADMIN_TOKEN', 'MAP_SITE_URL']
let closers: (() => Promise<void>)[] = []
beforeEach(() => {
  resetSourceCache()
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})
const range = { from: '2026-10-16', to: '2026-10-22' }

describe('not configured is explicit, never zero', () => {
  it('reports exactly which variables are missing', async () => {
    expect(await getWebsiteSnapshot(range)).toMatchObject({ state: 'not_configured', missing: ['WEBSITE_URL', 'WEBSITE_AGENT_API_KEY'] })
    expect(await getGiftCardSummary()).toMatchObject({ state: 'not_configured', missing: ['GIFT_CARDS_URL', 'GIFT_CARDS_INTEGRATION_KEY'] })
    expect(await getFurnitureProjects()).toMatchObject({ state: 'not_configured' })
  })
  it('an unconfigured product is "unknown", never "operational"', async () => {
    expect((await websiteAdapter.health()).status).toBe('unknown')
    expect((await designAgentAdapter.health()).status).toBe('unknown')
  })
})

describe('website adapter (contract: POST /api/analytics, Bearer AGENT_API_KEY, action=snapshot)', () => {
  it('sends the agent key and a snapshot request with the previous period, and validates the reply', async () => {
    const key = 'w'.repeat(24)
    const s = await fakeServer((r) => (r.headers.authorization === `Bearer ${key}` ? { status: 200, body: websiteSnapshotFixture } : { status: 401, body: { error: 'Unauthorized' } }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_AGENT_API_KEY = key
    const r = await getWebsiteSnapshot(range)
    expect(r.state).toBe('ok')
    const body = JSON.parse(s.seen[0]!.body)
    expect(body).toEqual({ action: 'snapshot', range, compare: { from: '2026-10-09', to: '2026-10-15' } })
    expect(s.seen[0]!.path).toBe('/api/analytics')
  })

  it('refuses a reply whose shape changed instead of rendering wrong numbers', async () => {
    const s = await fakeServer(() => ({ status: 200, body: { ...websiteSnapshotFixture, kpis: { ...websiteSnapshotFixture.kpis, revenue: { value: '12' } } } }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_AGENT_API_KEY = 'x'.repeat(24)
    const r = await getWebsiteSnapshot(range)
    expect(r).toMatchObject({ state: 'error' })
    expect(r.state === 'error' && r.error).toMatch(/unexpected snapshot shape \(kpis.revenue/)
  })

  it('a rejected key is an error the owner can act on', async () => {
    const s = await fakeServer(() => ({ status: 401, body: { error: 'Unauthorized' } }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_AGENT_API_KEY = 'x'.repeat(24)
    const r = await getWebsiteSnapshot(range)
    expect(r.state === 'error' && r.error).toMatch(/^HTTP 401: Unauthorized\. .*AGENT_API_KEY/)
  })

  it("a host without the analytics function says so, with Vercel's own message", async () => {
    const s = await fakeServer(() => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'The page could not be found' } } }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_AGENT_API_KEY = 'x'.repeat(24)
    const r = await getWebsiteSnapshot(range)
    expect(r.state === 'error' && r.error).toMatch(/^HTTP 404: The page could not be found \(NOT_FOUND\)\. Nothing answers at .*\/api\/analytics/)
  })

  it('caches a success and shares it', async () => {
    const s = await fakeServer(() => ({ status: 200, body: websiteSnapshotFixture }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_AGENT_API_KEY = 'x'.repeat(24)
    await Promise.all([getWebsiteSnapshot(range), getWebsiteSnapshot(range), getWebsiteSnapshot(range)])
    expect(s.seen).toHaveLength(1)
  })

  it('does not cache a failure', async () => {
    let n = 0
    const s = await fakeServer(() => (++n <= 2 ? { status: 500, body: {} } : { status: 200, body: websiteSnapshotFixture }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_AGENT_API_KEY = 'x'.repeat(24)
    expect((await getWebsiteSnapshot(range)).state).toBe('error')
    expect((await getWebsiteSnapshot(range)).state).toBe('ok')
  })
})

describe('website orders and products (contract: POST /api/analytics, Bearer COMMAND_CENTER_API_KEY)', () => {
  const key = 'c'.repeat(32)
  const order = { id: 5, order_number: 'JAS-5', customer_name: 'דנה', customer_email: 'd@x.co', customer_phone: null, items: [{ product_id: 1, name_he: 'כיסא', price: 450, quantity: 1 }], subtotal: 450, shipping: 0, total: 450, status: 'paid', notes: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' }
  const product = { id: 1, slug: 'chair', name_he: 'כיסא', name_en: 'Chair', price: 450, original_price: null, quantity: 1, in_stock: true, featured: false, published: true, image_url: null, updated_at: 'u1', categories: null }

  it('is not configured without its own key, even when the snapshot key is set', async () => {
    process.env.WEBSITE_URL = 'http://127.0.0.1:9'
    process.env.WEBSITE_AGENT_API_KEY = 'w'.repeat(24)
    expect(await listWebsiteOrders('')).toMatchObject({ state: 'not_configured', missing: ['WEBSITE_COMMAND_CENTER_KEY'] })
  })

  it('lists orders and products with the command-center key and validates them', async () => {
    const s = await fakeServer((r) => {
      if (r.headers.authorization !== `Bearer ${key}`) return { status: 403, body: { error: 'no' } }
      const b = JSON.parse(r.body)
      return { status: 200, body: b.action === 'orders-list' ? { orders: [order] } : { products: [product] } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await listWebsiteOrders('dana', 'paid')).toMatchObject({ state: 'ok', data: [{ id: 5, status: 'paid' }] })
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ action: 'orders-list', q: 'dana', status: 'paid', limit: 100 })
    expect(await listWebsiteProducts('')).toMatchObject({ state: 'ok', data: [{ id: 1, price: 450 }] })
  })

  it('a stale or refused write is an answer, not an outage; writes are not retried', async () => {
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (b.action === 'order-set-status') return { status: 409, body: { error: 'The order changed since it was loaded' } }
      if (b.patch?.published !== undefined) return { status: 422, body: { error: 'Not editable' } }
      return { status: 200, body: { product: { ...product, price: b.patch.price, updated_at: 'u2' } } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await setWebsiteOrderStatus(5, 'paid', 'shipped')).toEqual({ ok: false, conflict: true, message: 'The order changed since it was loaded' })
    expect(s.seen).toHaveLength(1)
    expect(await updateWebsiteProduct(1, { price: 399.9 }, 'u1')).toMatchObject({ ok: true, value: { price: 399.9, updated_at: 'u2' } })
    expect(JSON.parse(s.seen[1]!.body)).toEqual({ action: 'product-update', id: 1, patch: { price: 399.9 }, expectUpdatedAt: 'u1' })
  })

  it('reads site content and writes one key conditionally; a stale edit is a conflict, not an outage', async () => {
    const item = { key: 'popup_title', label: 'כותרת', type: 'text', section: 'popup', sort_order: 20, value: 'שלום', stored: true, updated_at: 't0' }
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (b.action === 'content-list') return { status: 200, body: { items: [item, { ...item, key: 'popup_enabled', value: 'false', stored: false, updated_at: null }], sections: ['popup'] } }
      if (b.expectUpdatedAt === 'stale') return { status: 409, body: { error: 'כותרת changed since it was loaded. Reload and try again.' } }
      return { status: 200, body: { item: { key: b.key, value: b.value, updated_at: 't1' } } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    const r = await listWebsiteContent()
    expect(r.state === 'ok' && r.data.items.map((i) => i.updated_at)).toEqual(['t0', null])
    expect(await setWebsiteContent('popup_title', 'חדש', 't0')).toEqual({ ok: true, value: { key: 'popup_title', value: 'חדש', updated_at: 't1' } })
    expect(JSON.parse(s.seen[1]!.body)).toEqual({ action: 'content-set', key: 'popup_title', value: 'חדש', expectUpdatedAt: 't0' })
    expect(await setWebsiteContent('popup_enabled', 'true', null)).toMatchObject({ ok: true })
    expect(JSON.parse(s.seen[2]!.body).expectUpdatedAt).toBeNull()
    expect(await setWebsiteContent('popup_title', 'x', 'stale')).toMatchObject({ ok: false, conflict: true })
    expect(s.seen).toHaveLength(4)
  })

  it('carries a list key\'s field descriptor so the editor can draw it', async () => {
    const nav = {
      key: 'nav_links_json', label: 'תפריט עליון', type: 'textarea', section: 'navigation', sort_order: 10, value: '[{"label":"בית","href":"/"}]', stored: false, updated_at: null,
      list: { maxItems: 12, fields: [{ name: 'label', label: 'טקסט', type: 'text', required: true, max: 60 }, { name: 'href', label: 'כתובת', type: 'path', required: true, max: 200 }] },
    }
    const s = await fakeServer(() => ({ status: 200, body: { items: [nav], sections: ['navigation'] } }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    const r = await listWebsiteContent('navigation')
    expect(r.state === 'ok' && r.data.items[0]!.list).toEqual(nav.list)
  })

  it('lists and moderates reviews', async () => {
    const review = { id: 3, product_id: null, customer_name: 'רון', customer_email: 'r@x.co', rating: 4, title: null, content: 'יפה', approved: false, created_at: '2026-10-20T10:00:00Z', product: null, reply: '' }
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (b.action === 'reviews-list') return { status: 200, body: { reviews: [review] } }
      if (b.action === 'reviews-set-approved') return { status: 200, body: { updated: b.ids } }
      return { status: 200, body: { deleted: [] } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await listWebsiteReviews('pending')).toMatchObject({ state: 'ok', data: [{ id: 3, approved: false }] })
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ action: 'reviews-list', status: 'pending' })
    expect(await setWebsiteReviewsApproved([3], true)).toEqual({ ok: true, value: [3] })
    expect(JSON.parse(s.seen[1]!.body)).toEqual({ action: 'reviews-set-approved', ids: [3], approved: true })
    expect(await deleteWebsiteReviews([3])).toEqual({ ok: true, value: [] })
  })

  it('reads, creates and conflicts on blog posts', async () => {
    const summary = { id: 4, title_he: 'כותרת', title_en: null, slug: 'post', excerpt_he: null, cover_image: null, category: null, tags: null, author: null, published: false, published_at: null, featured: false, created_at: 't', updated_at: 'u1' }
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (b.action === 'blog-get') return b.id === 4 ? { status: 200, body: { post: { ...summary, content_he: '## א', images: [] } } } : { status: 404, body: { error: 'Post not found' } }
      if (b.id && b.expectUpdatedAt !== 'u1') return { status: 409, body: { error: 'The post changed since it was loaded. Reload and try again.' } }
      return { status: 200, body: { post: { ...summary, ...b.post } } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await getWebsitePost(4)).toMatchObject({ state: 'ok', data: { content_he: '## א' } })
    expect(await getWebsitePost(5)).toMatchObject({ state: 'ok', data: null })
    const input = { title_he: 'חדש', title_en: null, slug: 'new', excerpt_he: null, content_he: null, cover_image: null, images: [], category: null, tags: [], author: null, published: false, featured: false }
    expect(await saveWebsitePost(input)).toMatchObject({ ok: true, value: { slug: 'new' } })
    expect(await saveWebsitePost(input, 4, 'old')).toMatchObject({ ok: false, conflict: true })
  })

  it('reads, creates, conflicts on and deletes products, with categories', async () => {
    const full = {
      id: 7, name_he: 'כיסא', name_en: 'כיסא', slug: 'chair', description_he: null, description_en: null, story_he: null, story_en: null, price: 120, original_price: null,
      category_id: 1, condition: 'good', style: null, dimensions: null, material: null, origin: null, image_url: 'https://x.co/a.jpg', images: [], featured: false,
      in_stock: true, quantity: 2, tags: null, published: true, created_at: 't', updated_at: 'u1',
    }
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (b.action === 'product-get') return b.id === 7 ? { status: 200, body: { product: full } } : { status: 404, body: { error: 'Product not found' } }
      if (b.action === 'product-meta') return { status: 200, body: { categories: [{ id: 1, name_he: 'כיסאות', name_en: 'Chairs', slug: 'chairs' }], lowStockThreshold: 3, conditions: [] } }
      if (b.action === 'category-create') return { status: 200, body: { category: { id: 2, name_he: b.name_he, name_en: b.name_en, slug: 'lamps' } } }
      if (b.action === 'product-save' && b.product.slug === 'taken') return { status: 409, body: { error: 'Another product already uses the address /product/taken' } }
      if (b.id && b.expectUpdatedAt !== 'u1') return { status: 409, body: { error: 'The product changed since it was loaded. Reload and try again.' } }
      if (b.action === 'product-delete') return { status: 200, body: { deleted: { id: 7, slug: 'chair', name_he: 'כיסא' } } }
      return { status: 200, body: { product: { ...full, ...b.product, id: b.id ?? 8 } } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await getWebsiteProduct(7)).toMatchObject({ state: 'ok', data: { slug: 'chair', category_id: 1 } })
    expect(await getWebsiteProduct(9)).toMatchObject({ state: 'ok', data: null })
    expect(await getWebsiteProductMeta()).toMatchObject({ state: 'ok', data: { lowStockThreshold: 3, categories: [{ slug: 'chairs' }] } })
    const input = {
      name_he: 'מנורה', name_en: null, slug: 'lamp', description_he: null, description_en: null, story_he: null, story_en: null, price: 80, original_price: null,
      category_id: null, condition: 'good' as const, style: null, dimensions: null, material: null, origin: null, image_url: 'https://x.co/b.jpg', images: [], featured: false, quantity: 1, tags: [],
    }
    expect(await saveWebsiteProduct(input)).toMatchObject({ ok: true, value: { id: 8, slug: 'lamp' } })
    expect(await saveWebsiteProduct({ ...input, slug: 'taken' })).toMatchObject({ ok: false, conflict: true, message: expect.stringMatching(/already uses/) })
    expect(await saveWebsiteProduct(input, 7, 'old')).toMatchObject({ ok: false, conflict: true })
    expect(await deleteWebsiteProduct(7, 'u1')).toMatchObject({ ok: true, value: { slug: 'chair' } })
    expect(await createWebsiteCategory('מנורות', 'Lamps')).toMatchObject({ ok: true, value: { id: 2 } })
    expect(JSON.parse(s.seen.at(-1)!.body)).toEqual({ action: 'category-create', name_he: 'מנורות', name_en: 'Lamps' })
  })

  it('reads and writes marketing, and drops a malformed campaign entry', async () => {
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (b.action === 'discounts-list') return { status: 200, body: { codes: [{ code: 'SPRING', type: 'percent', value: 10, active: true, usedCount: 4, createdAt: 'c' }] } }
      if (b.action === 'discount-save') return b.mode === 'create' && b.code.code === 'SPRING' ? { status: 409, body: { error: 'The code SPRING already exists' } } : { status: 200, body: { code: { ...b.code, usedCount: 0 } } }
      if (b.action === 'discount-delete') return { status: 200, body: { deleted: b.code } }
      if (b.action === 'subscribers-list') return { status: 200, body: { subscribers: [{ id: 1, email: 'a@x.com', created_at: 't' }], total: 1 } }
      if (b.action === 'campaigns-list') return { status: 200, body: { campaigns: [{ id: 'c1', subject: 'שלום', sentAt: 's', recipients: 3, bodyHtml: '<p/>' }, { broken: true }] } }
      return { status: 400, body: { error: 'Unknown action' } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await listWebsiteDiscounts()).toMatchObject({ state: 'ok', data: [{ code: 'SPRING', usedCount: 4 }] })
    expect(await saveWebsiteDiscount({ code: 'SPRING', type: 'percent', value: 5, active: true }, 'create')).toMatchObject({ ok: false, conflict: true })
    expect(await saveWebsiteDiscount({ code: 'VIP', type: 'amount', value: 50, active: true }, 'create')).toMatchObject({ ok: true, value: { code: 'VIP' } })
    expect(await deleteWebsiteDiscount('VIP')).toEqual({ ok: true, value: 'VIP' })
    expect(await listWebsiteSubscribers('')).toMatchObject({ state: 'ok', data: { total: 1 } })
    expect(await listWebsiteCampaigns()).toMatchObject({ state: 'ok', data: [{ id: 'c1', recipients: 3 }] })
  })

  it('uploads an image to the signed link the website returns, never through the website function', async () => {
    let url = ''
    const s = await fakeServer((r) => {
      if (r.path === '/api/analytics') return { status: 200, body: { path: 'cc-products/a.webp', signedUrl: `${url}/storage/upload/cc-products/a.webp?token=t`, publicUrl: `${url}/public/cc-products/a.webp` } }
      return r.path.startsWith('/storage/upload/') ? { status: 200, body: { Key: 'x' } } : { status: 404, body: {} }
    })
    url = s.url
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await uploadWebsiteImage('products', new TextEncoder().encode('img').buffer as ArrayBuffer, 'image/webp')).toBe(`${s.url}/public/cc-products/a.webp`)
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ action: 'image-upload-url', folder: 'products', contentType: 'image/webp' })
    expect(s.seen[1]!.path).toMatch(/^\/storage\/upload\//)
    expect(s.seen[1]!.body).toBe('img')
  })

  it('reads form messages and marks one handled; a missing table is an error, not an empty inbox', async () => {
    let missingTable = false
    const s = await fakeServer((r) => {
      const b = JSON.parse(r.body)
      if (missingTable) return { status: 422, body: { error: 'The site_inquiries table does not exist yet: run …' } }
      if (b.action === 'inquiries-list') return { status: 200, body: { inquiries: [{ id: 1, kind: 'donate', name: 'דנה', phone: '0501234567', email: null, subject: null, message: 'כיסא', photos: ['data:image/jpeg;base64,AA'], emailed: false, handled_at: null, handled_by: null, created_at: 't' }], openCount: 1 } }
      return b.handled ? { status: 200, body: { inquiry: { id: 1, handled_at: 'h' } } } : { status: 409, body: { error: 'already open' } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await listWebsiteInquiries('open')).toMatchObject({ state: 'ok', data: { openCount: 1, inquiries: [{ kind: 'donate', photos: ['data:image/jpeg;base64,AA'] }] } })
    expect(await setWebsiteInquiryHandled(1, true, 'o@x')).toMatchObject({ ok: true })
    expect(await setWebsiteInquiryHandled(1, false, 'o@x')).toMatchObject({ ok: false, conflict: true })
    missingTable = true
    resetSourceCache()
    expect((await listWebsiteInquiries('all')).state).toBe('error')
  })

  it('sends a campaign once and is never retried', async () => {
    let calls = 0
    const s = await fakeServer((r) => {
      calls++
      const b = JSON.parse(r.body)
      return calls > 1 ? { status: 409, body: { error: 'This campaign was already sent' } } : { status: 200, body: { test: false, recipients: 2, failed: 0, total: 2, echo: b.requestId } }
    })
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    expect(await sendWebsiteCampaign('נושא', 'טקסט', { requestId: 'req-12345678', sentBy: 'o@x' })).toMatchObject({ ok: true, value: { recipients: 2 } })
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ action: 'campaign-send', subject: 'נושא', bodyText: 'טקסט', requestId: 'req-12345678', sentBy: 'o@x' })
    expect(await sendWebsiteCampaign('נושא', 'טקסט', { requestId: 'req-12345678', sentBy: 'o@x' })).toMatchObject({ ok: false, conflict: true })
    expect(calls).toBe(2)
  })

  it('a rejected key names the variable to fix', async () => {
    const s = await fakeServer(() => ({ status: 403, body: { error: 'The command center key cannot use this action' } }))
    closers.push(s.close)
    process.env.WEBSITE_URL = s.url
    process.env.WEBSITE_COMMAND_CENTER_KEY = key
    const r = await listWebsiteOrders('')
    expect(r.state === 'error' && r.error).toMatch(/WEBSITE_COMMAND_CENTER_KEY must equal COMMAND_CENTER_API_KEY/)
  })
})

describe('gift card adapter (contract: GET /api/integration/v1/summary)', () => {
  it('reads the summary with the integration key', async () => {
    const s = await fakeServer((r) => (r.headers.authorization === `Bearer ${'g'.repeat(32)}` ? { status: 200, body: giftSummaryFixture } : { status: 401, body: { error: 'unauthorized' } }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    const r = await getGiftCardSummary()
    expect(r.state === 'ok' && r.data.stats.outstandingMinor).toBe(45000)
  })

  it('health is degraded, not operational, when paid cards are stuck', async () => {
    const s = await fakeServer((r) =>
      r.path === '/api/health'
        ? { status: 200, body: { ok: true, store: 'supabase', build: 'b1' } }
        : { status: 200, body: { ...giftSummaryFixture, deliveryHealth: { ...giftSummaryFixture.deliveryHealth, undelivered: 2 } } },
    )
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    const h = await giftCardsAdapter.health()
    expect(h.status).toBe('degraded')
    expect(h.checks.find((c) => c.name === 'Delivery & payments')?.detail).toMatch(/2 active card\(s\) not delivered/)
  })

  it('a 404 names the missing INTEGRATION_API_KEY on the gift card side, and a pasted page path is ignored', async () => {
    const s = await fakeServer((r) => (r.path === '/api/integration/v1/summary' ? { status: 404, body: { error: 'not found' } } : { status: 500, body: {} }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = `${s.url}/admin/`
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    const r = await getGiftCardSummary()
    expect(r.state === 'error' && r.error).toMatch(/^HTTP 404: not found\. .*INTEGRATION_API_KEY .*redeploy/)
    expect(s.seen[0]!.path).toBe('/api/integration/v1/summary')
  })
})

describe('gift card 404 diagnosis from its own health endpoint', () => {
  it('says the key is not set on the running build, and which build that is', async () => {
    const s = await fakeServer((r) =>
      r.path === '/api/health'
        ? { status: 200, body: { ok: true, branch: 'claude/gift-card-system-build-0oflq7', commit: 'ef34ccd', env: { INTEGRATION_API_KEY_LEN: 0 } } }
        : { status: 404, body: { error: 'not found' } },
    )
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    const r = await getGiftCardSummary()
    expect(r.state === 'error' && r.error).toMatch(/INTEGRATION_API_KEY is not set on the running gift card deployment \(running claude\/gift-card-system-build-0oflq7 @ ef34ccd\)/)
  })
})

describe('gift card search and actions (contract: /api/integration/v1/cards…)', () => {
  const row = { id: '11111111-1111-4111-8111-111111111111', maskedCode: '••••-AB12', status: 'active', initialAmountMinor: 20000, balanceMinor: 20000, templateId: 't', buyerName: 'א ב', buyerEmail: 'b@x.co', recipientName: 'ג ד', recipientEmail: 'r@x.co', scheduledDeliveryAt: null, issuedAt: null, expiresAt: null, createdAt: '2026-10-22T00:00:00Z' }
  const setup = async (handler: Parameters<typeof fakeServer>[0]) => {
    const s = await fakeServer(handler)
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    return s
  }

  it('searches with the key and passes the query through', async () => {
    const s = await setup(() => ({ status: 200, body: { total: 1, items: [row] } }))
    const r = await searchGiftCards('יעל', 'active')
    expect(r.state === 'ok' && r.data.items[0]!.maskedCode).toBe('••••-AB12')
    expect(decodeURIComponent(s.seen[0]!.path)).toContain('q=יעל')
    expect(s.seen[0]!.path).toContain('status=active')
    expect(s.seen[0]!.headers.authorization).toBe(`Bearer ${'g'.repeat(32)}`)
  })

  it('an unknown card is null, not an outage', async () => {
    await setup((r) => (r.path.includes('/cards/') ? { status: 404, body: { error: 'card not found' } } : { status: 500, body: {} }))
    expect(await getGiftCard(row.id)).toBeNull()
  })

  it('a write sends who did it and the reason, and is never retried', async () => {
    const s = await setup(() => ({ status: 500, body: { error: 'resend failed' } }))
    await expect(resendGiftCard(row.id, { email: 'o@x.co', role: 'owner' }, 'never arrived')).rejects.toThrow(/HTTP 500/)
    expect(s.seen).toHaveLength(1)
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ actor: { email: 'o@x.co', role: 'owner' }, reason: 'never arrived' })
  })

  it("a validation refusal comes back as the gift card system's own message", async () => {
    await setup(() => ({ status: 422, body: { ok: false, resent: false, message: 'האם התכוונת ל-r@gmail.com?' } }))
    const r = await editGiftCardRecipient(row.id, { recipientEmail: 'r@gmial.com' }, true, { email: 'o@x.co', role: 'owner' }, 'typo')
    expect(r).toEqual({ ok: false, message: 'האם התכוונת ל-r@gmail.com?' })
  })

  it('money actions post the op, actor and reason to the lifecycle route and carry the refund outcome', async () => {
    const s = await setup(() => ({ status: 200, body: { ok: true, message: 'x', provider: 'failed', refundedMinor: 15000 } }))
    const r = await runCardLifecycle(row.id, { op: 'refund' }, { email: 'o@x.co', role: 'owner' }, 'customer asked')
    expect(r).toMatchObject({ ok: true, provider: 'failed', refundedMinor: 15000 })
    expect(s.seen[0]!.path).toBe(`/api/integration/v1/cards/${row.id}/lifecycle`)
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ op: 'refund', actor: { email: 'o@x.co', role: 'owner' }, reason: 'customer asked' })
  })

  it('an adjustment sends its request id; an illegal move comes back as the refusal', async () => {
    const s = await setup(() => ({ status: 422, body: { ok: false, message: 'adjustment would drive balance below zero' } }))
    const r = await runCardLifecycle(row.id, { op: 'adjust', direction: 'decrease', amountMinor: 99900, requestId: '22222222-2222-4222-8222-222222222222' }, { email: 'o@x.co', role: 'owner' }, 'fix')
    expect(r).toEqual({ ok: false, message: 'adjustment would drive balance below zero' })
    expect(JSON.parse(s.seen[0]!.body)).toMatchObject({ op: 'adjust', amountMinor: 99900, requestId: '22222222-2222-4222-8222-222222222222' })
    expect(s.seen).toHaveLength(1)
  })
})

describe('furniture adapter (contract: PostgREST projects + project_summary_counts)', () => {
  it('joins counts onto projects and sends the key the way Supabase expects', async () => {
    const s = await fakeServer((r) => {
      if (r.path.startsWith('/rest/v1/projects'))
        return { status: 200, body: [{ id: 'p1', name: 'בניין א', city: 'תל אביב', developer_name: 'Dev', start_date: '2026-09-01', archived: false, created_at: '2026-09-01T00:00:00Z' }, { id: 'p2', name: 'Old', city: null, developer_name: null, start_date: null, archived: true, created_at: '2025-01-01T00:00:00Z' }] }
      if (r.path.startsWith('/rest/v1/project_summary_counts')) return { status: 200, body: [{ project_id: 'p1', apartment_count: 35, completed_count: 12, items_total: 400, items_to_collect: 250, items_collected: 90 }] }
      return { status: 404, body: {} }
    })
    closers.push(s.close)
    process.env.FURNITURE_SUPABASE_URL = s.url
    process.env.FURNITURE_SUPABASE_KEY = 'sb_secret_abc'
    const r = await getFurnitureProjects()
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    expect(r.data[0]).toMatchObject({ id: 'p1', apartments: 35, apartmentsCompleted: 12, itemsCollected: 90 })
    // A project with no rows in the view has zero apartments — it exists, it is just empty.
    expect(r.data[1]).toMatchObject({ id: 'p2', apartments: 0, archived: true })
    expect(s.seen[0]!.headers.apikey).toBe('sb_secret_abc')
    expect(s.seen[0]!.headers.authorization).toBeUndefined() // new-style keys are not JWTs
  })

  it('accepts a project URL pasted with /rest/v1/ on the end', async () => {
    const s = await fakeServer((r) => (r.path.startsWith('/rest/v1/rest') ? { status: 404, body: { code: 'PGRST125', message: 'Invalid path specified in request URL' } } : { status: 200, body: [] }))
    closers.push(s.close)
    process.env.FURNITURE_SUPABASE_URL = `${s.url}/rest/v1/`
    process.env.FURNITURE_SUPABASE_KEY = 'sb_secret_abc'
    expect(await getFurnitureProjects()).toMatchObject({ state: 'ok', data: [] })
    expect(s.seen.every((x) => x.path.startsWith('/rest/v1/projects') || x.path.startsWith('/rest/v1/project_summary_counts'))).toBe(true)
  })

  it('explains an invalid-path 404 instead of only echoing it', async () => {
    const s = await fakeServer(() => ({ status: 404, body: { code: 'PGRST125', message: 'Invalid path specified in request URL' } }))
    closers.push(s.close)
    process.env.FURNITURE_SUPABASE_URL = s.url
    process.env.FURNITURE_SUPABASE_KEY = 'sb_secret_abc'
    const r = await getFurnitureProjects()
    expect(r.state === 'error' && r.error).toMatch(/FURNITURE_SUPABASE_URL must be the Furniture-Collect project URL/)
  })
})

describe('furniture project detail and writes (contract: PostgREST projects/apartments/items)', () => {
  const pid = '11111111-1111-4111-8111-111111111111'
  const iid = '22222222-2222-4222-8222-222222222222'
  const itemRow = { id: iid, apartment_id: 'a1', description: 'ספה', quantity: 1, gallery_type: 'jas_collection', intended_for_collection: true, collected: false, collected_by: null, status: 'pending', item_type: 'furniture', updated_at: '2026-10-20T10:00:00+00:00' }

  it('reads one project with its apartments and items; an unknown id is a 404, not an error', async () => {
    const s = await fakeServer((r) => {
      if (r.path.startsWith('/rest/v1/projects')) return { status: 200, body: r.path.includes(pid) ? [{ id: pid, name: 'בניין א', city: null, developer_name: null, start_date: null, archived: false }] : [] }
      if (r.path.startsWith('/rest/v1/apartments')) return { status: 200, body: [{ id: 'a1', project_id: pid, building_number: '1', apartment_number: '2', status: 'DOCUMENTING', updated_at: null }] }
      return { status: 200, body: [itemRow] }
    })
    closers.push(s.close)
    process.env.FURNITURE_SUPABASE_URL = s.url
    process.env.FURNITURE_SUPABASE_KEY = 'sb_secret_x'
    expect(await getFurnitureProject(pid)).toMatchObject({ state: 'ok', data: { project: { name: 'בניין א' }, apartments: [{ id: 'a1' }], items: [{ id: iid }] } })
    expect(await getFurnitureProject('22222222-2222-4222-8222-000000000000')).toBeNull()
    expect(await getFurnitureProject('not-a-uuid')).toBeNull()
  })

  it('moves an item only if it is unchanged since loaded, and archives with a plain column update', async () => {
    const s = await fakeServer((r) => {
      if (r.method !== 'PATCH') return { status: 405, body: {} }
      if (r.path.startsWith('/rest/v1/projects')) return { status: 200, body: [{ id: pid, archived: JSON.parse(r.body).archived }] }
      const fresh = r.path.includes(encodeURIComponent(encodeURIComponent(itemRow.updated_at))) || r.path.includes(encodeURIComponent(itemRow.updated_at))
      return { status: 200, body: fresh ? [{ ...itemRow, gallery_type: 'third_party', intended_for_collection: false, updated_at: 'later' }] : [] }
    })
    closers.push(s.close)
    process.env.FURNITURE_SUPABASE_URL = s.url
    process.env.FURNITURE_SUPABASE_KEY = 'sb_secret_x'
    expect(await setItemDestination(iid, 'third_party', itemRow.updated_at)).toMatchObject({ ok: true, value: { intended_for_collection: false } })
    expect(JSON.parse(s.seen[0]!.body)).toEqual({ gallery_type: 'third_party' })
    expect(s.seen[0]!.headers.prefer).toBe('return=representation')
    expect(await setItemDestination(iid, 'donation', 'stale')).toMatchObject({ ok: false, conflict: true })
    expect(await setProjectArchived(pid, true)).toMatchObject({ ok: true, value: { archived: true } })
  })
})

describe('design agent adapter (contract: /healthz, /admin/status, /admin/jobs/:id/retry)', () => {
  it('reads a 503 healthz as "stuck", not as unreachable', async () => {
    const s = await fakeServer(() => ({ status: 503, body: { ok: false, version: { commit: 'abc123', branch: 'main', started_at: 1 }, jobs: { queued: 4, done: 10 }, stuck: 2 } }))
    closers.push(s.close)
    process.env.DESIGN_AGENT_URL = s.url
    const r = await getDesignAgentHealthz()
    expect(r.state === 'ok' && r.data.stuck).toBe(2)
    expect((await designAgentAdapter.health()).checks[0]).toMatchObject({ status: 'degraded' })
  })

  it('retry reports what the bot confirmed', async () => {
    const s = await fakeServer((r) => (r.method === 'POST' && r.path === '/admin/jobs/7/retry' ? { status: 200, body: { retried: true } } : { status: 404, body: { retried: false } }))
    closers.push(s.close)
    process.env.DESIGN_AGENT_URL = s.url
    process.env.DESIGN_AGENT_ADMIN_TOKEN = 't'.repeat(20)
    expect(await retryDeadJob(7)).toEqual({ retried: true })
    expect(await retryDeadJob(8)).toEqual({ retried: false })
    expect(s.seen[0]!.headers.authorization).toBe(`Bearer ${'t'.repeat(20)}`)
    await expect(retryDeadJob(-1)).rejects.toThrow(/Invalid job id/)
  })
})

describe('isolation', () => {
  it('one broken product never takes the others down', async () => {
    const bad = await fakeServer(() => ({ status: 500, body: { error: 'boom' } }))
    const good = await fakeServer(() => ({ status: 200, body: { ok: true, version: { commit: 'c' }, jobs: {}, stuck: 0 } }))
    closers.push(bad.close, good.close)
    process.env.GIFT_CARDS_URL = bad.url
    process.env.DESIGN_AGENT_URL = good.url
    process.env.MAP_SITE_URL = good.url
    const h = await allHealth()
    expect(h).toHaveLength(5)
    expect(h.find((x) => x.product === 'gift_cards')?.status).toBe('down')
    expect(h.find((x) => x.product === 'design_agent')?.checks[0]?.status).toBe('operational')
  })
})
