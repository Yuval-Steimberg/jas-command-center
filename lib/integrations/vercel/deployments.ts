import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson } from '../http'
import { notConfigured, readSource } from '../read'
import type { SourceResult } from '../types'
import { summariseDeployments, type ProjectDeployments } from './summarise'

/**
 * Production deployments of every Vercel project the token can see: what is
 * live, when it went out, and whether the newest attempt failed. Read-only:
 * this module never triggers, promotes or cancels a deployment.
 *
 * Vercel has no read-only token, so VERCEL_TOKEN lives only on this server
 * (never in the browser) and is scoped to the JAS team when it is created.
 */
const deployment = z.object({
  uid: z.string(),
  name: z.string(),
  url: z.string().nullable().optional(),
  created: z.number(),
  state: z.string().optional(),
  readyState: z.string().optional(),
  target: z.string().nullable().optional(),
  inspectorUrl: z.string().nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
})
const response = z.object({ deployments: z.array(deployment) })

export async function getDeployments(): Promise<SourceResult<ProjectDeployments[]>> {
  const { token, teamId } = env().vercel
  if (!token) return notConfigured(['VERCEL_TOKEN'])
  return readSource('vercel:deployments', 60_000, 'Vercel API: production deployments', async () => {
    const q = new URLSearchParams({ target: 'production', limit: '100', ...(teamId ? { teamId } : {}) })
    const { data, latencyMs } = await fetchJson(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` } })
    const rows = response.parse(data).deployments.map((d) => ({
      id: d.uid,
      project: d.name,
      url: d.url ? `https://${d.url}` : null,
      inspectorUrl: d.inspectorUrl ?? null,
      createdAt: new Date(d.created).toISOString(),
      state: (d.state ?? d.readyState ?? 'UNKNOWN').toUpperCase(),
      commit: typeof d.meta?.githubCommitMessage === 'string' ? d.meta.githubCommitMessage.split('\n')[0]!.slice(0, 120) : null,
      sha: typeof d.meta?.githubCommitSha === 'string' ? d.meta.githubCommitSha.slice(0, 7) : null,
      branch: typeof d.meta?.githubCommitRef === 'string' ? d.meta.githubCommitRef : null,
    }))
    return { data: summariseDeployments(rows), latencyMs }
  })
}
