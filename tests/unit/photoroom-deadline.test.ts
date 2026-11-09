import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { photoroomCatalog } from '@/lib/inventory/photoroom'

/**
 * The hourly publishing run hands Photoroom its deadline. A call is never
 * started with too little time left, and one cut short by that deadline comes
 * back `deferred` (not recorded against the photo), unlike Photoroom being down.
 */
const realFetch = globalThis.fetch
const img = new ArrayBuffer(8)
beforeEach(() => { process.env.PHOTOROOM_API_KEY = 'test-key' })
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.PHOTOROOM_API_KEY
})

/** A Photoroom that never answers; honours the abort signal like real fetch. */
function hanging() {
  const seen: number[] = []
  globalThis.fetch = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
    seen.push(Date.now())
    return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)))
  }) as unknown as typeof fetch
  return seen
}

describe('photoroomCatalog with a deadline', () => {
  it('does not start a call with under 8 s left', async () => {
    const seen = hanging()
    expect(await photoroomCatalog(img, 'image/jpeg', { deadline: Date.now() + 5_000 })).toMatchObject({ ok: false, deferred: true })
    expect(seen).toHaveLength(0)
  })

  it('a call cut short by the deadline is deferred, not a Photoroom failure', async () => {
    hanging()
    const t = Date.now()
    const r = await photoroomCatalog(img, 'image/jpeg', { deadline: Date.now() + 8_300 })
    expect(r).toMatchObject({ ok: false, deferred: true })
    expect(Date.now() - t).toBeLessThan(9_500)
  }, 15_000)

  it('without a deadline an unreachable Photoroom is a real failure', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const r = await photoroomCatalog(img, 'image/jpeg')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.deferred).toBeFalsy()
    expect(r.ok === false && r.message).toMatch(/could not be reached/)
  })

  it('a refused relight is not retried when the time is gone', async () => {
    let n = 0
    globalThis.fetch = vi.fn(async () => { n++; await new Promise((ok) => setTimeout(ok, 1_000)); return new Response('{"detail":"too big"}', { status: 400 }) }) as unknown as typeof fetch
    expect(await photoroomCatalog(img, 'image/jpeg', { deadline: Date.now() + 8_500 })).toMatchObject({ ok: false, deferred: true })
    expect(n).toBe(1)
  }, 15_000)
})
