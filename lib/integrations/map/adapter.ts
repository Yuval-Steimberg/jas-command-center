import 'server-only'
import { env } from '@/lib/env'
import { probe, SourceError } from '../http'
import { readSource } from '../read'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'
import { parsePlacesData, type MapData } from './parse'

const e = () => env().map

export interface MapSnapshot extends MapData {
  sha: string
  repo: string
  branch: string
}

/** The raw file and its blob sha, from the branch GitHub Pages publishes. Not cached. */
export async function readPlacesSource(): Promise<{ source: string; sha: string; latencyMs: number }> {
  const { repo, branch, githubToken } = env().map
  const started = performance.now()
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/places-data.js?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  const latencyMs = Math.round(performance.now() - started)
  if (!res.ok) {
    const hint = res.status === 404 && !githubToken ? ' (private repository? set GITHUB_TOKEN)' : res.status === 403 ? ' (rate limited — set GITHUB_TOKEN)' : ''
    throw new SourceError(`GitHub HTTP ${res.status}${hint}`, res.status, latencyMs)
  }
  const body = (await res.json()) as { sha: string; content: string; encoding: string }
  if (body.encoding !== 'base64') throw new SourceError('unexpected GitHub encoding', 200, latencyMs)
  return { source: Buffer.from(body.content, 'base64').toString('utf8'), sha: body.sha, latencyMs }
}

/** Reads places-data.js from the repository branch GitHub Pages publishes. */
export async function getMapData(): Promise<SourceResult<MapSnapshot>> {
  const { repo, branch } = env().map
  return readSource(`map:data:${repo}:${branch}`, 5 * 60_000, `GitHub ${repo}@${branch}/places-data.js`, async () => {
    const { source, sha, latencyMs } = await readPlacesSource()
    return { data: { ...parsePlacesData(source), sha, repo, branch }, latencyMs }
  })
}

export const mapAdapter: IntegrationAdapter = {
  product: 'map',
  name: 'Interactive map',
  description: 'Static Leaflet site on GitHub Pages (map.justasecond.co.il); data in places-data.js.',
  config() {
    const e = env().map
    return { required: [], missing: [!e.githubToken && 'GITHUB_TOKEN', !e.ga4PropertyId && 'MAP_GA4_PROPERTY_ID', !e.ga4ServiceAccount && 'GA4_SERVICE_ACCOUNT_JSON'].filter(Boolean) as string[], optional: ['GITHUB_TOKEN', 'MAP_GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON', 'MAP_SITE_URL', 'MAP_GITHUB_REPO', 'MAP_GITHUB_BRANCH'] }
  },
  capabilities: () => [
    // e(): read lazily so the rows follow the deployment's variables.
    { id: 'places', label: 'Places, categories, coordinates', kind: 'read', status: 'available', note: 'Works without a token if the repository is public (60 requests/hour).' },
    { id: 'edit', label: 'Add / edit / remove a place (as a reviewed pull request)', kind: 'write', status: e().githubToken ? 'available' : 'needs_credentials', note: 'Opens a one-line pull request on Interactive-map; the public map changes when you merge it. Needs GITHUB_TOKEN (fine-grained, that repository only, Contents + Pull requests: read and write).' },
    { id: 'projects', label: 'Furniture projects on the map', kind: 'read', status: 'available', note: 'Each furniture project page links its recorded address to OpenStreetMap. They are deliberately not plotted on the public map: that is a route of partner places, and a demolition site is not one.' },
    { id: 'traffic', label: 'Map visitors', kind: 'read', status: e().ga4PropertyId && e().ga4ServiceAccount ? 'available' : 'needs_credentials', note: 'GA4 Data API, read-only service account. Needs MAP_GA4_PROPERTY_ID (numeric) and GA4_SERVICE_ACCOUNT_JSON.' },
  ],
  async health() {
    const e = env().map
    const checks: HealthCheck[] = []
    const p = await probe(e.siteUrl)
    checks.push({ name: 'Public site', status: p.ok ? 'operational' : 'down', detail: p.ok ? `HTTP ${p.status}` : (p.error ?? `HTTP ${p.status}`), checkedAt: new Date().toISOString(), latencyMs: p.latencyMs })
    const d = await getMapData()
    if (d.state === 'ok') checks.push({ name: 'Place data', status: 'operational', detail: `${d.data.places.length} places parse cleanly`, checkedAt: d.checkedAt, latencyMs: d.latencyMs })
    else if (d.state === 'error') checks.push({ name: 'Place data', status: 'down', detail: d.error, checkedAt: d.checkedAt, latencyMs: d.latencyMs })
    return { product: 'map', status: rollup(checks), checks }
  },
}
