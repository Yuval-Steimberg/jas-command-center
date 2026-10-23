/** Pure: Vercel deployment rows → one line per project. Tested in tests/unit/deployments.test.ts. */

export interface DeploymentRow {
  id: string
  project: string
  url: string | null
  inspectorUrl: string | null
  createdAt: string
  /** READY, ERROR, BUILDING, QUEUED, INITIALIZING, CANCELED. */
  state: string
  commit: string | null
  branch: string | null
}

export interface ProjectDeployments {
  project: string
  /** Newest production attempt, whatever its state. */
  latest: DeploymentRow
  /** What production is serving: the newest READY deployment (null = none in the window). */
  live: DeploymentRow | null
  /** The newest attempt failed while an older one is still serving. */
  latestFailed: boolean
  failedLast24h: number
}

const DAY = 24 * 60 * 60 * 1000

export function summariseDeployments(rows: DeploymentRow[], now = new Date()): ProjectDeployments[] {
  const byProject = new Map<string, DeploymentRow[]>()
  for (const r of rows) byProject.set(r.project, [...(byProject.get(r.project) ?? []), r])
  return [...byProject.entries()]
    .map(([project, list]) => {
      const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const latest = sorted[0]!
      return {
        project,
        latest,
        live: sorted.find((d) => d.state === 'READY') ?? null,
        latestFailed: latest.state === 'ERROR',
        failedLast24h: sorted.filter((d) => d.state === 'ERROR' && now.getTime() - Date.parse(d.createdAt) < DAY).length,
      }
    })
    .sort((a, b) => Number(b.latestFailed) - Number(a.latestFailed) || b.latest.createdAt.localeCompare(a.latest.createdAt))
}

/** Which product a Vercel project deploys, by its name. null = not one of the five (e.g. the command center itself). */
export function productForProject(name: string): 'website' | 'gift_cards' | 'furniture' | 'design_agent' | 'map' | null {
  const n = name.toLowerCase()
  if (n.includes('gift')) return 'gift_cards'
  if (n.includes('website') || n.includes('just-a-second')) return 'website'
  if (n.includes('furniture') || n.includes('collect')) return 'furniture'
  if (n.includes('whats') || n.includes('bot')) return 'design_agent'
  if (n.includes('map')) return 'map'
  return null
}
