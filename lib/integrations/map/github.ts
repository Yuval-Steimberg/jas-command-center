import 'server-only'
import { env } from '@/lib/env'
import { SourceError } from '../http'
import { invalidate } from '../cache'

/**
 * Map changes go to GitHub as a pull request, never a direct commit to the
 * branch Pages publishes: the person reviews the one-line diff and merges it,
 * and only then does the public map change.
 *
 * Needs GITHUB_TOKEN with Contents + Pull requests: read and write on the map
 * repository (a fine-grained token scoped to that one repository).
 */
export const BRANCH_PREFIX = 'command-center/place-'

async function gh<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { repo, githubToken } = env().map
  if (!githubToken) throw new SourceError('GITHUB_TOKEN is not set: map changes need a token with Contents and Pull requests write access', null, null)
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${githubToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 404 ? ' (does GITHUB_TOKEN have Contents and Pull requests write access to the map repository?)' : ''
    throw new SourceError(`GitHub HTTP ${res.status}: ${data?.message ?? 'request failed'}${hint}`, res.status, null)
  }
  return data as T
}

export interface MapPullRequest {
  number: number
  url: string
  title: string
  createdAt: string
  branch: string
}

/**
 * Branch from the published branch, commit the new file, open the PR.
 * `fileSha` is the blob the edit was computed from: if someone changed the
 * file since, GitHub refuses the commit (409) and nothing is opened.
 */
export async function openPlacePullRequest(input: { source: string; fileSha: string; placeId: number; summary: string; requestedBy: string; reason: string }): Promise<MapPullRequest> {
  const { branch } = env().map
  const base = await gh<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`)
  const head = `${BRANCH_PREFIX}${input.placeId}-${Date.now().toString(36)}`
  await gh(`/git/refs`, { method: 'POST', body: { ref: `refs/heads/${head}`, sha: base.object.sha } })
  try {
    await gh(`/contents/places-data.js`, {
      method: 'PUT',
      body: { message: input.summary, content: Buffer.from(input.source, 'utf8').toString('base64'), sha: input.fileSha, branch: head },
    })
  } catch (e) {
    // Leave no empty branch behind.
    await gh(`/git/refs/heads/${encodeURIComponent(head)}`, { method: 'DELETE' }).catch(() => {})
    if (e instanceof SourceError && e.status === 409) throw new SourceError('places-data.js changed since this page loaded. Reload and make the change again.', 409, null)
    throw e
  }
  const pr = await gh<{ number: number; html_url: string; title: string; created_at: string }>(`/pulls`, {
    method: 'POST',
    body: {
      title: input.summary,
      head,
      base: branch,
      body: `${input.summary}\n\nRequested in the JAS Command Center by ${input.requestedBy}.\nReason: ${input.reason}\n\nMerging this publishes the change on the public map.`,
    },
  })
  invalidate(`map:prs`)
  return { number: pr.number, url: pr.html_url, title: pr.title, createdAt: pr.created_at, branch: head }
}

/** Open place changes waiting for review (only the ones this console opened). */
export async function listPlacePullRequests(): Promise<MapPullRequest[]> {
  const prs = await gh<{ number: number; html_url: string; title: string; created_at: string; head: { ref: string } }[]>(`/pulls?state=open&per_page=50`)
  return prs.filter((p) => p.head.ref.startsWith(BRANCH_PREFIX)).map((p) => ({ number: p.number, url: p.html_url, title: p.title, createdAt: p.created_at, branch: p.head.ref }))
}
