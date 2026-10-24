import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseVolunteerStore } from '@/lib/volunteers/supabase'

/**
 * A PostgREST stand-in that behaves like Supabase where it matters: a response
 * is capped at 1000 rows whatever limit is asked for, `in` filters and
 * `range` are honoured, and every request is recorded.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const requests: { table: string; inLen: number; range: [number, number] | null }[] = []
  const from = (table: string) => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = []
    let range: [number, number] | null = null
    let order: string | null = null
    let inLen = 0
    const b = {
      select: () => b,
      order: (col: string) => { order ??= col; return b },
      in: (col: string, vals: string[]) => { inLen = Math.max(inLen, vals.length); filters.push((r) => vals.includes(String(r[col]))); return b },
      eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return b },
      gt: (col: string, v: string) => { filters.push((r) => String(r[col]) > v); return b },
      lt: (col: string, v: string) => { filters.push((r) => String(r[col]) < v); return b },
      gte: (col: string, v: string) => { filters.push((r) => String(r[col]) >= v); return b },
      range: (a: number, z: number) => { range = [a, z]; return b },
      limit: () => b,
      then: (res: (v: { data: unknown; error: null }) => void) => {
        requests.push({ table, inLen, range })
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        if (order) rows = [...rows].sort((x, y) => String(x[order!]).localeCompare(String(y[order!])) || String(x.id).localeCompare(String(y.id)))
        const [a, z] = range ?? [0, rows.length - 1]
        res({ data: rows.slice(a, Math.min(z + 1, a + 1000)), error: null })
      },
    }
    return b
  }
  return { db: { from } as unknown as SupabaseClient, requests }
}

const pad = (n: number) => String(n).padStart(6, '0')

describe('Supabase volunteer store paging', () => {
  it('reads past the 1000-row cap instead of silently stopping at it', async () => {
    const signups = Array.from({ length: 2500 }, (_, i) => ({ id: `s${pad(i)}`, shift_id: 'sh1', volunteer_id: `v${i}`, status: 'confirmed', created_at: `2026-01-01T00:00:${pad(i)}` }))
    const { db, requests } = fakeDb({ cc_vol_signups: signups })
    const rows = await supabaseVolunteerStore(db).listSignups({ shiftIds: ['sh1'] })
    expect(rows).toHaveLength(2500)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500)
    expect(requests.length).toBe(3)
  })

  it('splits a long id list so the URL stays short, and keeps the order', async () => {
    const shifts = Array.from({ length: 400 }, (_, i) => ({ id: `id${pad(i)}`, activity_id: `a${i % 7}`, status: 'open', starts_at: `2026-02-${String((i % 28) + 1).padStart(2, '0')}T08:00:00Z`, ends_at: '2026-03-01T00:00:00Z' }))
    const { db, requests } = fakeDb({ cc_vol_shifts: shifts })
    const rows = await supabaseVolunteerStore(db).listShifts({ ids: shifts.map((s) => s.id) })
    expect(rows).toHaveLength(400)
    expect(Math.max(...requests.map((r) => r.inLen))).toBeLessThanOrEqual(150)
    expect(rows.map((r) => r.startsAt)).toEqual([...rows.map((r) => r.startsAt)].sort())
  })

  it('respects an explicit limit', async () => {
    const outbox = Array.from({ length: 1500 }, (_, i) => ({ id: `o${pad(i)}`, status: 'sent', created_at: `2026-01-01T${pad(i)}` }))
    const { db } = fakeDb({ cc_vol_outbox: outbox })
    expect(await supabaseVolunteerStore(db).listOutbox({ limit: 1200 })).toHaveLength(1200)
  })
})
