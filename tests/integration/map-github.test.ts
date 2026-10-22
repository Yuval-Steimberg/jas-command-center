import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPlacePullRequests, openPlacePullRequest } from '@/lib/integrations/map/github'

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'github_pat_test'
  process.env.MAP_GITHUB_REPO = 'Owner/Interactive-map'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GITHUB_TOKEN
  delete process.env.MAP_GITHUB_REPO
})

const input = { source: 'const LOCS = [];', fileSha: 'blob1', placeId: 24, summary: 'Add place #24 "x"', requestedBy: 'o@jas.co', reason: 'new partner' }

function stub(handler: (method: string, path: string, body: any) => [number, unknown]) {
  const calls: { method: string; path: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { method?: string; body?: string; headers: Record<string, string> }) => {
    const path = url.replace('https://api.github.com/repos/Owner/Interactive-map', '')
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method ?? 'GET', path, body })
    expect(init.headers.Authorization).toBe('Bearer github_pat_test')
    const [status, out] = handler(init.method ?? 'GET', path, body)
    return new Response(out == null ? '' : JSON.stringify(out), { status })
  })
  return calls
}

describe('map changes as pull requests', () => {
  it('branches from main, commits against the blob it read, and opens a PR (never commits to main)', async () => {
    const calls = stub((m, p) => {
      if (p === '/git/ref/heads/main') return [200, { object: { sha: 'base' } }]
      if (p === '/git/refs') return [201, {}]
      if (p === '/contents/places-data.js') return [200, {}]
      if (p === '/pulls') return [201, { number: 7, html_url: 'https://github.com/x/pull/7', title: input.summary, created_at: '2026-10-22T20:00:00Z' }]
      return [404, { message: m }]
    })
    const pr = await openPlacePullRequest(input)
    expect(pr).toMatchObject({ number: 7, url: 'https://github.com/x/pull/7' })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toMatchObject({ sha: 'blob1', branch: pr.branch })
    expect(pr.branch).toMatch(/^command-center\/place-24-/)
    expect(calls.find((c) => c.path === '/pulls')!.body).toMatchObject({ base: 'main', head: pr.branch })
  })

  it('a file changed since it was read opens nothing and deletes the branch', async () => {
    const calls = stub((m, p) => {
      if (p === '/git/ref/heads/main') return [200, { object: { sha: 'base' } }]
      if (p === '/git/refs') return [201, {}]
      if (p === '/contents/places-data.js') return [409, { message: 'sha does not match' }]
      if (m === 'DELETE') return [204, null]
      return [500, {}]
    })
    await expect(openPlacePullRequest(input)).rejects.toThrow(/changed since this page loaded/)
    expect(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/git/refs/heads/command-center'))).toBe(true)
    expect(calls.some((c) => c.path === '/pulls')).toBe(false)
  })

  it('lists only the pull requests this console opened', async () => {
    stub(() => [200, [
      { number: 1, html_url: 'u1', title: 'mine', created_at: 't', head: { ref: 'command-center/place-3-x' } },
      { number: 2, html_url: 'u2', title: 'someone else', created_at: 't', head: { ref: 'feature/x' } },
    ]])
    expect((await listPlacePullRequests()).map((p) => p.number)).toEqual([1])
  })
})
