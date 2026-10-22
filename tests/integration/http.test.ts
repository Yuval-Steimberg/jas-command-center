import { afterEach, describe, expect, it } from 'vitest'
import { fetchJson, scrub, SourceError } from '@/lib/integrations/http'
import { fakeServer } from './fake-server'

let close: (() => Promise<void>) | null = null
afterEach(async () => {
  await close?.()
  close = null
})

describe('fetchJson', () => {
  it('retries a 5xx read once, then succeeds', async () => {
    let n = 0
    const s = await fakeServer(() => (++n === 1 ? { status: 503, body: { error: 'warming up' } } : { status: 200, body: { ok: true } }))
    close = s.close
    const r = await fetchJson<{ ok: boolean }>(`${s.url}/x`)
    expect(r.data.ok).toBe(true)
    expect(n).toBe(2)
  })

  it('does not retry a 4xx and surfaces the source message', async () => {
    let n = 0
    const s = await fakeServer(() => (n++, { status: 401, body: { error: 'bad key' } }))
    close = s.close
    await expect(fetchJson(`${s.url}/x`)).rejects.toThrow('HTTP 401: bad key')
    expect(n).toBe(1)
  })

  it('never retries a non-idempotent POST', async () => {
    let n = 0
    const s = await fakeServer(() => (n++, { status: 500, body: {} }))
    close = s.close
    await expect(fetchJson(`${s.url}/x`, { method: 'POST', body: {} })).rejects.toBeInstanceOf(SourceError)
    expect(n).toBe(1)
  })

  it('times out', async () => {
    const s = await fakeServer(() => new Promise((ok) => setTimeout(() => ok({ status: 200, body: {} }), 500)))
    close = s.close
    await expect(fetchJson(`${s.url}/x`, { timeoutMs: 50, retries: 0 })).rejects.toThrow(/timed out/)
  })

  it('scrubs credentials from error text', () => {
    expect(scrub('Authorization: Bearer abc.def-123')).not.toContain('abc.def-123')
    expect(scrub('https://x/y?token=s3cret&a=1')).not.toContain('s3cret')
    expect(scrub('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe('[jwt]')
  })
})

describe('error bodies', () => {
  it('reads nested {error:{code,message}} instead of printing [object Object]', async () => {
    const { errorDetail } = await import('@/lib/integrations/http')
    expect(errorDetail({ error: { code: 'NOT_FOUND', message: 'The page could not be found' } })).toBe('The page could not be found (NOT_FOUND)')
    expect(errorDetail({ error: 'not found' })).toBe('not found')
    expect(errorDetail({ message: 'Invalid path' })).toBe('Invalid path')
    expect(errorDetail({ unrelated: 1 })).toBeNull()
  })
})
