import 'server-only'
import { env } from '@/lib/env'
import { fetchJson, SourceError } from '../http'
import { notConfigured, readSource } from '../read'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'
import { giftCardHealth, giftCardSummary, type GiftCardHealth, type GiftCardSummary } from './contract'

export async function getGiftCardSummary(): Promise<SourceResult<GiftCardSummary>> {
  const { url, integrationKey } = env().giftCards
  const missing = [!url && 'GIFT_CARDS_URL', !integrationKey && 'GIFT_CARDS_INTEGRATION_KEY'].filter(Boolean) as string[]
  if (missing.length)
    return notConfigured(missing, 'GIFT_CARDS_INTEGRATION_KEY must equal INTEGRATION_API_KEY on the gift card deployment (needs the integration endpoint from the gift_card_system PR).')
  return readSource('gift:summary', 60_000, 'Gift Card System /api/integration/v1/summary', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/integration/v1/summary`, { headers: { Authorization: `Bearer ${integrationKey}` } })
    const parsed = giftCardSummary.safeParse(data)
    if (!parsed.success) throw new SourceError(`unexpected summary shape (${parsed.error.issues[0]?.path.join('.')})`, 200, latencyMs)
    return { data: parsed.data, latencyMs }
  })
}

export async function getGiftCardHealth(): Promise<SourceResult<GiftCardHealth>> {
  const { url } = env().giftCards
  if (!url) return notConfigured(['GIFT_CARDS_URL'])
  return readSource('gift:health', 30_000, 'Gift Card System /api/health', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/health`, { timeoutMs: 10_000 })
    return { data: giftCardHealth.parse(data), latencyMs }
  })
}

export const giftCardsAdapter: IntegrationAdapter = {
  product: 'gift_cards',
  name: 'Gift cards',
  description: 'gift_card_system on Vercel (gift.justasecond.co.il): sales, liability, delivery, redemption.',
  config() {
    const e = env().giftCards
    return {
      required: ['GIFT_CARDS_URL'],
      missing: [!e.url && 'GIFT_CARDS_URL', !e.integrationKey && 'GIFT_CARDS_INTEGRATION_KEY'].filter(Boolean) as string[],
      optional: ['GIFT_CARDS_INTEGRATION_KEY'],
    }
  },
  capabilities: () => [
    { id: 'health', label: 'Deployment health (store, tables, auth layer)', kind: 'read', status: 'available' },
    { id: 'summary', label: 'Sales, liability, redeemed, failed deliveries, paid-but-not-delivered', kind: 'read', status: 'needs_source_change', note: 'Companion PR adds GET /api/integration/v1/summary; then set INTEGRATION_API_KEY there and GIFT_CARDS_INTEGRATION_KEY here.' },
    { id: 'search', label: 'Search cards, view details (masked code)', kind: 'read', status: 'not_built' },
    { id: 'resend', label: 'Resend card email, edit recipient', kind: 'write', status: 'not_built', note: 'Must call the gift card system’s own adminEditRecipient/resend paths, never re-implement them.' },
    { id: 'refund', label: 'Refund / void', kind: 'write', status: 'not_built', note: 'Owner-only (gift_cards:financial), confirmation required.' },
    { id: 'grow', label: 'Grow transaction reconciliation', kind: 'read', status: 'needs_credentials', note: 'gift_card_system has no GROW_* API keys (its gotcha #20).' },
    { id: 'fees', label: 'Payment processing fees', kind: 'read', status: 'unsupported', note: 'Not stored anywhere.' },
  ],
  async health() {
    const checks: HealthCheck[] = []
    const h = await getGiftCardHealth()
    if (h.state === 'not_configured') checks.push({ name: 'Deployment', status: 'unknown', detail: 'GIFT_CARDS_URL not set', checkedAt: null, latencyMs: null })
    else if (h.state === 'error') checks.push({ name: 'Deployment', status: 'down', detail: h.error, checkedAt: h.checkedAt, latencyMs: h.latencyMs })
    else
      checks.push({
        name: 'Deployment',
        status: h.data.ok ? 'operational' : 'degraded',
        detail: h.data.ok ? `store=${h.data.store ?? '?'} build=${h.data.build ?? '?'}` : 'health endpoint reports a failing probe',
        checkedAt: h.checkedAt,
        latencyMs: h.latencyMs,
      })
    const s = await getGiftCardSummary()
    if (s.state === 'not_configured') checks.push({ name: 'Delivery & payments', status: 'unknown', detail: `needs ${s.missing.join(', ')}`, checkedAt: null, latencyMs: null })
    else if (s.state === 'error') checks.push({ name: 'Delivery & payments', status: 'down', detail: s.error, checkedAt: s.checkedAt, latencyMs: s.latencyMs })
    else {
      const d = s.data.deliveryHealth
      const problems = d.unmatchedPayments + d.paidNotActivated + d.undelivered
      checks.push({
        name: 'Delivery & payments',
        status: problems ? 'degraded' : 'operational',
        detail: problems ? `${problems} paid card(s) need attention in the last ${d.windowDays} days` : `nothing stuck in the last ${d.windowDays} days`,
        checkedAt: s.checkedAt,
        latencyMs: s.latencyMs,
      })
    }
    return { product: 'gift_cards', status: rollup(checks), checks }
  },
}
