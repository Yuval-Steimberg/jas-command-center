import 'server-only'
import { env } from '@/lib/env'
import { probe, SourceError } from '../http'
import { readSource } from '../read'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'
import { parsePlacesData, type MapData } from './parse'

export interface MapSnapshot extends MapData {
  sha: string
  repo: string
  branch: string
}

/** Reads places-data.js from the repository branch GitHub Pages publishes. */
export async function getMapData(): Promise<SourceResult<MapSnapshot>> {
  const { repo, branch, githubToken } = env().map
  return readSource(`map:data:${repo}:${branch}`, 5 * 60_000, `GitHub ${repo}@${branch}/places-data.js`, async () => {
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
    const data = parsePlacesData(Buffer.from(body.content, 'base64').toString('utf8'))
    return { data: { ...data, sha: body.sha, repo, branch }, latencyMs }
  })
}

export const mapAdapter: IntegrationAdapter = {
  product: 'map',
  name: 'Interactive map',
  description: 'Static Leaflet site on GitHub Pages (map.justasecond.co.il); data in places-data.js.',
  config() {
    const e = env().map
    return { required: [], missing: e.githubToken ? [] : ['GITHUB_TOKEN'], optional: ['GITHUB_TOKEN', 'MAP_SITE_URL', 'MAP_GITHUB_REPO', 'MAP_GITHUB_BRANCH'] }
  },
  capabilities: () => [
    { id: 'places', label: 'Places, categories, coordinates', kind: 'read', status: 'available', note: 'Works without a token if the repository is public (60 requests/hour).' },
    { id: 'edit', label: 'Add / edit a place (as a reviewed pull request)', kind: 'write', status: 'not_built', note: 'Needs GITHUB_TOKEN with contents + pull-request write on Interactive-map.' },
    { id: 'projects', label: 'Furniture projects on the map', kind: 'read', status: 'unsupported', note: 'No shared identifiers, and projects store a city, not coordinates.' },
    { id: 'traffic', label: 'Map visitors', kind: 'read', status: 'needs_credentials', note: 'GA4 property G-0EM74CEJ0J needs Data API credentials.' },
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
