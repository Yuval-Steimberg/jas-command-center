import 'server-only'
import { env } from '@/lib/env'
import { fetchJson, SourceError, withHint } from '../http'
import { notConfigured, readOnce, readSource } from '../read'
import { invalidate } from '../cache'
import type { DateRange } from '@/lib/time'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'
import { giftCardDetail, giftCardHealth, giftCardSales, giftCardSearch, giftCardSummary, lifecycleResult, resendAllResult, writeResult, type GiftCardDetail, type GiftCardHealth, type GiftCardSales, type GiftCardSearch, type GiftCardSummary, type ResendAllResult } from './contract'

export async function getGiftCardSummary(): Promise<SourceResult<GiftCardSummary>> {
  const { url, integrationKey } = env().giftCards
  const missing = [!url && 'GIFT_CARDS_URL', !integrationKey && 'GIFT_CARDS_INTEGRATION_KEY'].filter(Boolean) as string[]
  if (missing.length)
    return notConfigured(missing, 'GIFT_CARDS_INTEGRATION_KEY must equal INTEGRATION_API_KEY on the gift card deployment (needs the integration endpoint from the gift_card_system PR).')
  return readSource('gift:summary', 60_000, 'Gift Card System /api/integration/v1/summary', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/integration/v1/summary`, { headers: { Authorization: `Bearer ${integrationKey}` } }).catch(async (e) => {
      if (e instanceof SourceError && e.status === 404) {
        const h = await getGiftCardHealth()
        const why = h.state === 'ok' ? disabledReason(h.data) : null
        withHint(e, () => `${why ?? 'The gift card deployment has the endpoint switched off'}: set INTEGRATION_API_KEY (32+ characters, the same value as GIFT_CARDS_INTEGRATION_KEY here) on the gift card Vercel project for Production, then redeploy that project`)
      }
      return withHint(e, (x) => (x.status === 401 ? 'The keys differ: GIFT_CARDS_INTEGRATION_KEY here must equal INTEGRATION_API_KEY on the gift card deployment' : null))
    })
    const parsed = giftCardSummary.safeParse(data)
    if (!parsed.success) throw new SourceError(`unexpected summary shape (${parsed.error.issues[0]?.path.join('.')})`, 200, latencyMs)
    return { data: parsed.data, latencyMs }
  })
}

/** Daily sales and redemptions for a range plus the period before it (analytics). */
export async function getGiftCardSales(range: DateRange): Promise<SourceResult<GiftCardSales>> {
  const { url, integrationKey } = env().giftCards
  const missing = [!url && 'GIFT_CARDS_URL', !integrationKey && 'GIFT_CARDS_INTEGRATION_KEY'].filter(Boolean) as string[]
  if (missing.length) return notConfigured(missing)
  const qs = new URLSearchParams({ from: range.from, to: range.to })
  return readSource(`gift:sales:${range.from}:${range.to}`, 60_000, 'Gift Card System /api/integration/v1/sales', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/integration/v1/sales?${qs}`, { headers: { Authorization: `Bearer ${integrationKey}` }, timeoutMs: 15_000 }).catch((e) =>
      withHint(e, (x) => (x.status === 404 ? 'The gift card deployment predates the sales endpoint (gift_card_system PR #7) or has INTEGRATION_API_KEY unset: redeploy it' : x.status === 401 ? 'The keys differ: GIFT_CARDS_INTEGRATION_KEY here must equal INTEGRATION_API_KEY on the gift card deployment' : null)),
    )
    const parsed = giftCardSales.safeParse(data)
    if (!parsed.success) throw new SourceError(`unexpected sales shape (${parsed.error.issues[0]?.path.join('.')})`, 200, latencyMs)
    return { data: parsed.data, latencyMs }
  })
}

/** What the gift card's own /api/health says about the key, from the running deployment. */
function disabledReason(h: GiftCardHealth): string | null {
  const len = h.env?.INTEGRATION_API_KEY_LEN
  const build = [h.branch, h.commit].filter((x) => typeof x === 'string').join(' @ ')
  const where = build ? ` (running ${build})` : ''
  if (typeof len !== 'number') return `The running gift card deployment${where} is older than the key diagnostics, so it was probably not redeployed`
  if (len === 0) return `INTEGRATION_API_KEY is not set on the running gift card deployment${where}`
  if (len < 32) return `INTEGRATION_API_KEY on the gift card deployment${where} is only ${len} characters`
  return null
}

export async function getGiftCardHealth(): Promise<SourceResult<GiftCardHealth>> {
  const { url } = env().giftCards
  if (!url) return notConfigured(['GIFT_CARDS_URL'])
  return readSource('gift:health', 30_000, 'Gift Card System /api/health', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/health`, { timeoutMs: 10_000 })
    return { data: giftCardHealth.parse(data), latencyMs }
  })
}

/** The signed-in person, recorded in the gift card system's own audit log for every write. */
export interface GiftCardActor {
  email: string
  role: string
}

function configured() {
  const { url, integrationKey } = env().giftCards
  if (!url || !integrationKey) throw new SourceError('Gift cards are not connected (GIFT_CARDS_URL / GIFT_CARDS_INTEGRATION_KEY)', null, null)
  return { url, headers: { Authorization: `Bearer ${integrationKey}` } }
}

/** Search through the gift card system's own card list (masked codes). Not cached: a search is a person waiting. */
export async function searchGiftCards(query: string, status?: string): Promise<SourceResult<GiftCardSearch>> {
  const { url, integrationKey } = env().giftCards
  if (!url || !integrationKey) return notConfigured([!url && 'GIFT_CARDS_URL', !integrationKey && 'GIFT_CARDS_INTEGRATION_KEY'].filter(Boolean) as string[])
  const qs = new URLSearchParams({ q: query, limit: '50', ...(status ? { status } : {}) })
  return readOnce(`gift:search:${qs}`, 'Gift Card System /api/integration/v1/cards', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/integration/v1/cards?${qs}`, { headers: configured().headers })
    return { data: giftCardSearch.parse(data), latencyMs }
  })
}

export async function getGiftCard(id: string): Promise<SourceResult<GiftCardDetail> | null> {
  const { url, integrationKey } = env().giftCards
  if (!url || !integrationKey) return notConfigured([!url && 'GIFT_CARDS_URL', !integrationKey && 'GIFT_CARDS_INTEGRATION_KEY'].filter(Boolean) as string[])
  const r = await readOnce(`gift:card:${id}`, 'Gift Card System /api/integration/v1/cards/:id', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/integration/v1/cards/${encodeURIComponent(id)}`, { headers: configured().headers })
    return { data: giftCardDetail.parse(data), latencyMs }
  })
  return r.state === 'error' && /^HTTP 404: card not found/.test(r.error) ? null : r
}

/** Writes return what the gift card system confirmed; a validation refusal (422) is an answer, not an outage. */
async function write<T>(path: string, body: unknown, parse: (d: unknown) => T): Promise<T | { ok: false; message: string }> {
  const { url, headers } = configured()
  try {
    const { data } = await fetchJson(`${url}${path}`, { method: 'POST', headers, body, timeoutMs: 55_000 })
    return parse(data)
  } catch (e) {
    if (e instanceof SourceError && e.status === 422) return { ok: false, message: e.message.replace(/^HTTP 422: /, '') }
    throw e
  } finally {
    invalidate('gift:summary')
  }
}

export const resendGiftCard = (id: string, actor: GiftCardActor, reason: string) =>
  write(`/api/integration/v1/cards/${encodeURIComponent(id)}/resend`, { actor, reason }, (d) => writeResult.parse(d))

export const editGiftCardRecipient = (id: string, fields: { recipientName?: string; recipientEmail?: string; recipientPhone?: string }, resend: boolean, actor: GiftCardActor, reason: string) =>
  write(`/api/integration/v1/cards/${encodeURIComponent(id)}/recipient`, { actor, reason, resend, fields }, (d) => writeResult.parse(d))

export const resendAllUndelivered = (actor: GiftCardActor): Promise<ResendAllResult | { ok: false; message: string }> =>
  write('/api/integration/v1/delivery/resend-undelivered', { actor }, (d) => resendAllResult.parse(d))

/** The owner-only card actions. Each runs the gift card system's own /admin function. */
export const CARD_OPS = ['suspend', 'reactivate', 'cancel', 'refund', 'reissue', 'adjust', 'mark_paid'] as const
export type CardOp = (typeof CARD_OPS)[number]
export type CardOpInput =
  | { op: Exclude<CardOp, 'adjust'> }
  | { op: 'adjust'; direction: 'increase' | 'decrease'; amountMinor: number; requestId: string }

export const runCardLifecycle = (id: string, input: CardOpInput, actor: GiftCardActor, reason: string) =>
  write(`/api/integration/v1/cards/${encodeURIComponent(id)}/lifecycle`, { ...input, actor, reason }, (d) => lifecycleResult.parse(d))

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
    { id: 'summary', label: 'Sales, liability, redeemed, failed deliveries, paid-but-not-delivered', kind: 'read', status: 'available' },
    { id: 'search', label: 'Search cards, view details, delivery history and audit (masked code)', kind: 'read', status: 'available' },
    { id: 'resend', label: 'Resend card email, edit recipient, resend all undelivered', kind: 'write', status: 'available', note: 'Calls the gift card system’s own resend / editRecipient / resendAllUndelivered; audited on both sides.' },
    { id: 'refund', label: 'Refund, suspend, reissue, adjust balance, mark paid', kind: 'write', status: 'available', note: 'Owner-only (gift_cards:financial), on each card’s page, with confirmation. Runs the gift card admin’s own functions. A refund returns money through Grow only once GROW_* API keys are set; until then you are told to credit the buyer in Grow by hand.' },
    { id: 'grow', label: 'Grow transaction reconciliation', kind: 'read', status: 'needs_credentials', note: 'Set GROW_API_KEY (Grow userId) and GROW_API_SECRET (Grow apiKey) on the gift card deployment, then run npm run verify:grow there. Also enables automatic refunds.' },
    { id: 'fees', label: 'Payment processing fees', kind: 'read', status: 'unsupported', note: 'Grow does not send fees in its payment callback and nothing stores them. Possible only from Grow’s transaction API once keys exist, if its rows carry a fee field (verify:grow prints them).' },
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
