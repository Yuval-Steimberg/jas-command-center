import { describe, expect, it } from 'vitest'
import { fromCall, fromSource, summarise } from '@/lib/selfcheck/probe'

describe('self-check probes', () => {
  it('maps each source state without inventing a pass', () => {
    const ok = fromSource('s', 'a', { state: 'ok', data: [1, 2], checkedAt: '', latencyMs: 5, source: 'x' }, (d) => `${d.length}`)
    const nc = fromSource('s', 'b', { state: 'not_configured', missing: ['K'] }, () => 'never')
    const err = fromSource('s', 'c', { state: 'error', error: 'x'.repeat(400), checkedAt: '', latencyMs: null }, () => 'never')
    expect(ok).toMatchObject({ state: 'ok', detail: '2', latencyMs: 5 })
    expect(nc).toMatchObject({ state: 'not_configured', detail: 'needs K' })
    expect(err.state).toBe('error')
    expect(err.detail.length).toBeLessThanOrEqual(160)
  })

  it('a throwing read is an error, never ok', async () => {
    const p = await fromCall('s', 'd', async () => {
      throw new Error('boom')
    })
    expect(p).toMatchObject({ state: 'error', detail: 'boom' })
  })

  it('summary fails only on errors; not configured is counted apart', () => {
    const s = summarise([
      { section: 'a', name: 'x', state: 'ok', latencyMs: 1, detail: '' },
      { section: 'a', name: 'y', state: 'not_configured', latencyMs: null, detail: '' },
    ])
    expect(s).toEqual({ ok: true, counts: { ok: 1, not_configured: 1, error: 0 }, failing: [] })
    expect(summarise([{ section: 'b', name: 'z', state: 'error', latencyMs: null, detail: '' }])).toMatchObject({ ok: false, failing: ['b: z'] })
  })
})
