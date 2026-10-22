import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getWebsiteSnapshot, websiteAdapter } from '@/lib/integrations/website/adapter'
import { editGiftCardRecipient, getGiftCard, getGiftCardSummary, giftCardsAdapter, resendGiftCard, searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getDesignAgentHealthz, designAgentAdapter, retryDeadJob } from '@/lib/integrations/design-agent/adapter'
import { allHealth } from '@/lib/integrations/registry'
import { listWebsiteOrders, listWebsiteProducts, setWebsiteOrderStatus, updateWebsiteProduct } from '@/lib/integrations/website/manage'
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
    expect(h.checks.find((c) => c.name === 'Delivery & payments')?.detail).toMatch(/2 paid card/)
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
