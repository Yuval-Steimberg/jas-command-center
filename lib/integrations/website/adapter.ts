import 'server-only'
import { env } from '@/lib/env'
import { fetchJson, probe, withHint } from '../http'
import { notConfigured, readSource } from '../read'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'
import { metricsSnapshot, type MetricsSnapshot } from './contract'
import { israelDate, previousPeriod, type DateRange } from '@/lib/time'

const SOURCE = 'Website MetricsSnapshot (first-party events + Supabase orders)'

/**
 * Reads the website's own analytics engine through its read-only agent key.
 * Nothing is recomputed here: KPIs, availability labels and revenue rules
 * (paid statuses, verified vs unverified) are the website's definitions.
 */
export async function getWebsiteSnapshot(range: DateRange): Promise<SourceResult<MetricsSnapshot>> {
  const { url, agentKey } = env().website
  const missing = [!url && 'WEBSITE_URL', !agentKey && 'WEBSITE_AGENT_API_KEY'].filter(Boolean) as string[]
  if (missing.length) return notConfigured(missing, 'WEBSITE_AGENT_API_KEY must equal AGENT_API_KEY on the website (24+ characters).')
  return readSource(`website:snapshot:${range.from}:${range.to}`, 5 * 60_000, SOURCE, async () => {
    const { data, latencyMs } = await fetchJson(`${url}/api/analytics`, {
      method: 'POST',
      idempotent: true, // a snapshot is a read
      headers: { Authorization: `Bearer ${agentKey}` },
      body: { action: 'snapshot', range, compare: previousPeriod(range) },
      timeoutMs: 20_000,
    }).catch((e) =>
      withHint(e, (x) =>
        x.status === 404
          ? `Nothing answers at ${url}/api/analytics: WEBSITE_URL must be the website's own Vercel address (the one whose deployment includes api/analytics), not a page or another app`
          : x.status === 401
            ? 'The website refused the key: WEBSITE_AGENT_API_KEY here must equal AGENT_API_KEY on the website (24+ characters), and the website must be redeployed after setting it'
            : null,
      ),
    )
    const parsed = metricsSnapshot.safeParse(data)
    if (!parsed.success) throw new Error(`unexpected snapshot shape (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message})`)
    return { data: parsed.data, latencyMs }
  })
}

export const websiteAdapter: IntegrationAdapter = {
  product: 'website',
  name: 'Website & shop',
  description: 'just-a-second-website on Vercel: shop, checkout, first-party analytics.',
  config() {
    const e = env().website
    return {
      required: ['WEBSITE_URL', 'WEBSITE_AGENT_API_KEY'],
      missing: [!e.url && 'WEBSITE_URL', !e.agentKey && 'WEBSITE_AGENT_API_KEY'].filter(Boolean) as string[],
      optional: [],
    }
  },
  capabilities: () => [
    { id: 'analytics', label: 'Traffic, funnel, paid orders, revenue (verified vs unverified)', kind: 'read', status: 'available' },
    { id: 'errors', label: 'JS, API and checkout errors', kind: 'read', status: 'available' },
    { id: 'orders', label: 'Order list and fulfilment status', kind: 'read', status: 'needs_source_change', note: 'The agent key only reads aggregates. Needs a narrow orders endpoint on the website.' },
    { id: 'products', label: 'Edit products, prices, stock, images', kind: 'write', status: 'needs_source_change', note: 'Admin-only via Supabase RLS today; needs a server endpoint that reuses website pricing rules.' },
    { id: 'refunds', label: 'Refunds, tax, processing fees', kind: 'read', status: 'unsupported', note: 'The website does not store them.' },
    { id: 'deploys', label: 'Deployment status', kind: 'read', status: 'needs_credentials', note: 'Needs a Vercel API token.' },
  ],
  async health() {
    const e = env().website
    const checks: HealthCheck[] = []
    if (!e.url) {
      checks.push({ name: 'Site', status: 'unknown', detail: 'WEBSITE_URL not set', checkedAt: null, latencyMs: null })
    } else {
      const p = await probe(e.url)
      checks.push({ name: 'Site', status: p.ok ? 'operational' : 'down', detail: p.ok ? `HTTP ${p.status}` : (p.error ?? `HTTP ${p.status}`), checkedAt: new Date().toISOString(), latencyMs: p.latencyMs })
    }
    // The analytics API is the integration itself: probe it with a one-day snapshot.
    if (e.url && e.agentKey) {
      const today = israelDate()
      const r = await getWebsiteSnapshot({ from: today, to: today })
      checks.push(
        r.state === 'ok'
          ? { name: 'Analytics API', status: 'operational', detail: 'snapshot returned', checkedAt: r.checkedAt, latencyMs: r.latencyMs }
          : { name: 'Analytics API', status: 'down', detail: r.state === 'error' ? r.error : 'not configured', checkedAt: new Date().toISOString(), latencyMs: null },
      )
    } else {
      checks.push({ name: 'Analytics API', status: 'unknown', detail: 'WEBSITE_AGENT_API_KEY not set', checkedAt: null, latencyMs: null })
    }
    return { product: 'website', status: rollup(checks), checks }
  },
}
