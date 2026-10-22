import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache } from './fake-server'
import { getGiftCardSales } from '@/lib/integrations/gift-cards/adapter'
import { getDesignAgentActivity } from '@/lib/integrations/design-agent/adapter'
import { agentActivityFixture, giftSalesFixture } from '../fixtures/sources'

const ENV_KEYS = ['GIFT_CARDS_URL', 'GIFT_CARDS_INTEGRATION_KEY', 'DESIGN_AGENT_URL', 'DESIGN_AGENT_ADMIN_TOKEN']
let closers: (() => Promise<void>)[] = []
beforeEach(() => {
  resetSourceCache()
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})
const range = { from: '2026-10-21', to: '2026-10-22' }

describe('gift card sales (contract: GET /api/integration/v1/sales?from&to)', () => {
  it('is explicit when not configured', async () => {
    expect(await getGiftCardSales(range)).toMatchObject({ state: 'not_configured', missing: ['GIFT_CARDS_URL', 'GIFT_CARDS_INTEGRATION_KEY'] })
  })

  it('sends the key and the range, and validates the reply', async () => {
    const key = 'g'.repeat(40)
    const s = await fakeServer((r) => (r.headers.authorization === `Bearer ${key}` ? { status: 200, body: giftSalesFixture } : { status: 401, body: { error: 'unauthorized' } }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = key
    const r = await getGiftCardSales(range)
    expect(r.state).toBe('ok')
    expect(s.seen[0]!.path).toBe('/api/integration/v1/sales?from=2026-10-21&to=2026-10-22')
  })

  it('a deployment without the endpoint says how to fix it', async () => {
    const s = await fakeServer(() => ({ status: 404, body: { error: 'not found' } }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(40)
    const r = await getGiftCardSales(range)
    expect(r.state === 'error' && r.error).toMatch(/predates the sales endpoint/)
  })

  it('refuses money that is not integer agorot', async () => {
    const bad = { ...giftSalesFixture, current: { ...giftSalesFixture.current, totals: { ...giftSalesFixture.current.totals, salesMinor: 750.5 } } }
    const s = await fakeServer(() => ({ status: 200, body: bad }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(40)
    const r = await getGiftCardSales(range)
    expect(r.state === 'error' && r.error).toMatch(/unexpected sales shape \(current.totals.salesMinor\)/)
  })
})

describe('design agent activity (contract: GET /admin/activity?from&to)', () => {
  it('needs the admin token', async () => {
    process.env.DESIGN_AGENT_URL = 'http://127.0.0.1:1'
    expect(await getDesignAgentActivity(range)).toMatchObject({ state: 'not_configured', missing: ['DESIGN_AGENT_ADMIN_TOKEN'] })
  })

  it('reads one range per call with the bearer token', async () => {
    const token = 't'.repeat(20)
    const s = await fakeServer((r) => (r.headers.authorization === `Bearer ${token}` ? { status: 200, body: agentActivityFixture('2026-10-21', '2026-10-22', 2) } : { status: 401, body: { error: 'unauthorized' } }))
    closers.push(s.close)
    process.env.DESIGN_AGENT_URL = s.url
    process.env.DESIGN_AGENT_ADMIN_TOKEN = token
    const r = await getDesignAgentActivity(range)
    expect(r.state === 'ok' && r.data.totals.versions).toBe(4)
    expect(s.seen[0]!.path).toBe('/admin/activity?from=2026-10-21&to=2026-10-22')
  })

  it('an older bot without the endpoint says to redeploy it', async () => {
    const s = await fakeServer(() => ({ status: 404, body: { error: 'not found' } }))
    closers.push(s.close)
    process.env.DESIGN_AGENT_URL = s.url
    process.env.DESIGN_AGENT_ADMIN_TOKEN = 't'.repeat(20)
    const r = await getDesignAgentActivity(range)
    expect(r.state === 'error' && r.error).toMatch(/redeploy it on Railway/)
  })
})
