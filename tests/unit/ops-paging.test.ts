import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseOpsStore } from '@/lib/ops/supabase'

/**
 * PostgREST cuts every response at max_rows (1000) without saying so. A list
 * asked for more (the inventory snapshot reads up to 5000 items) must page,
 * or every count above 1000 silently freezes.
 */
function fakeDb(total: number) {
  const calls: { range?: [number, number]; limit?: number }[] = []
  const chain = () => {
    const call: { range?: [number, number]; limit?: number } = {}
    calls.push(call)
    const result = () => {
      const [a, b] = call.range ?? [0, Math.min(call.limit ?? 1000, 1000) - 1]
      const rows = Array.from({ length: Math.max(0, Math.min(b, total - 1, a + 999) - a + 1) }, (_, i) => ({ id: `id-${a + i}`, status: 'listed' }))
      return { data: rows, error: null }
    }
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'in', 'eq', 'gte', 'or', 'contains', 'not']) q[m] = () => q
    q.limit = (n: number) => ((call.limit = n), q)
    q.range = (a: number, b: number) => ((call.range = [a, b]), q)
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad)
    return q
  }
  return { db: { from: () => chain() } as unknown as SupabaseClient, calls }
}

describe('ops lists page past PostgREST max_rows', () => {
  it('reads every row up to the limit, 1000 at a time', async () => {
    const { db, calls } = fakeDb(2500)
    const rows = await supabaseOpsStore(db).listItems({ limit: 5000 })
    expect(rows).toHaveLength(2500)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500)
    expect(calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('stops at the limit, and a small limit is one request', async () => {
    const big = fakeDb(5000)
    expect(await supabaseOpsStore(big.db).listContacts({ limit: 1500 })).toHaveLength(1500)
    expect(big.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1499]])
    const small = fakeDb(5000)
    expect(await supabaseOpsStore(small.db).listDeals({ limit: 300 })).toHaveLength(300)
    expect(small.calls).toEqual([{ limit: 300 }])
  })
})
