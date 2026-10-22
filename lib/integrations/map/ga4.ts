import 'server-only'
import { createSign } from 'node:crypto'
import { z } from 'zod'
import { env } from '@/lib/env'
import { SourceError } from '../http'
import { notConfigured, readSource } from '../read'
import type { SourceResult } from '../types'

/**
 * Map visitors from Google Analytics 4 (the map site's own gtag property),
 * through the GA4 Data API with a read-only service account.
 *
 * Numbers are GA's, as GA reports them: no consent-mode modelling is added
 * and nothing is extrapolated. A property GA has no data for comes back as
 * zero rows, which is shown as "no data", not as zero visitors.
 */

const serviceAccount = z.object({ client_email: z.string().email(), private_key: z.string().includes('PRIVATE KEY'), token_uri: z.string().url().optional() })

/** Accepts the key file as pasted JSON or base64 of it. */
export function parseServiceAccount(raw: string): z.infer<typeof serviceAccount> {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  return serviceAccount.parse(JSON.parse(text))
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

let token: { value: string; expires: number; email: string } | null = null

async function accessToken(sa: z.infer<typeof serviceAccount>): Promise<string> {
  if (token && token.email === sa.client_email && token.expires > Date.now() + 60_000) return token.value
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud, iat: now, exp: now + 3600 }
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key)
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !body.access_token) throw new SourceError(`Google sign-in failed: ${body.error_description ?? `HTTP ${res.status}`}`, res.status, null)
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000, email: sa.client_email }
  return token.value
}

const report = z.object({
  rows: z.array(z.object({ dimensionValues: z.array(z.object({ value: z.string() })).optional(), metricValues: z.array(z.object({ value: z.string() })) })).optional(),
})

async function runReport(propertyId: string, bearer: string, body: unknown) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!res.ok) {
    const hint = res.status === 403 ? ' (add the service account email as a Viewer on the GA4 property)' : res.status === 400 ? ' (MAP_GA4_PROPERTY_ID must be the numeric property id, not G-…)' : ''
    throw new SourceError(`GA4 HTTP ${res.status}: ${data.error?.message ?? 'request failed'}${hint}`, res.status, null)
  }
  return report.parse(data).rows ?? []
}

const METRICS = ['activeUsers', 'sessions', 'screenPageViews'] as const
type Totals = Record<(typeof METRICS)[number], number>

export interface MapTraffic {
  days: number
  current: Totals
  previous: Totals
  daily: { date: string; activeUsers: number; sessions: number }[]
  sources: { source: string; sessions: number }[]
  hasData: boolean
}

const num = (v: string | undefined) => Number(v ?? 0) || 0

export async function getMapTraffic(days = 28): Promise<SourceResult<MapTraffic>> {
  const { ga4PropertyId, ga4ServiceAccount } = env().map
  if (!ga4PropertyId || !ga4ServiceAccount) return notConfigured([!ga4PropertyId && 'MAP_GA4_PROPERTY_ID', !ga4ServiceAccount && 'GA4_SERVICE_ACCOUNT_JSON'].filter(Boolean) as string[])
  return readSource(`map:ga4:${days}`, 10 * 60_000, `GA4 property ${ga4PropertyId}`, async () => {
    const started = performance.now()
    let sa
    try {
      sa = parseServiceAccount(ga4ServiceAccount)
    } catch {
      throw new SourceError('GA4_SERVICE_ACCOUNT_JSON is not a service-account key file (needs client_email and private_key)', null, null)
    }
    const bearer = await accessToken(sa)
    const current = { startDate: `${days - 1}daysAgo`, endDate: 'today' }
    const previous = { startDate: `${2 * days - 1}daysAgo`, endDate: `${days}daysAgo` }
    const metrics = METRICS.map((name) => ({ name }))
    const [totals, daily, sources] = await Promise.all([
      runReport(ga4PropertyId, bearer, { dateRanges: [current, previous], metrics }),
      runReport(ga4PropertyId, bearer, { dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }] }),
      runReport(ga4PropertyId, bearer, { dateRanges: [current], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }),
    ])
    // With two date ranges GA adds a dateRange dimension: date_range_0 = current, date_range_1 = previous.
    const pick = (range: string): Totals => {
      const row = totals.find((r) => r.dimensionValues?.[0]?.value === range) ?? (range === 'date_range_0' && totals.length === 1 && !totals[0]!.dimensionValues ? totals[0] : undefined)
      return Object.fromEntries(METRICS.map((m, i) => [m, num(row?.metricValues[i]?.value)])) as Totals
    }
    const data: MapTraffic = {
      days,
      current: pick('date_range_0'),
      previous: pick('date_range_1'),
      daily: daily.map((r) => {
        const d = r.dimensionValues?.[0]?.value ?? ''
        return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, activeUsers: num(r.metricValues[0]?.value), sessions: num(r.metricValues[1]?.value) }
      }),
      sources: sources.map((r) => ({ source: r.dimensionValues?.[0]?.value ?? '(not set)', sessions: num(r.metricValues[0]?.value) })),
      hasData: totals.length > 0,
    }
    return { data, latencyMs: Math.round(performance.now() - started) }
  })
}
