import 'server-only'
import { env } from '@/lib/env'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveProfile } from '@/lib/auth/session'
import { listWebsiteProductsByIds } from '@/lib/integrations/website/manage'
import { searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { getSalesStore } from '@/lib/sales/store'

/**
 * How long the reads behind a page take in production, each one ALONE and in
 * sequence (the main self-check runs ~50 reads at once, which inflates every
 * number). Called by the "Production check" workflow with ?timing=1. Times
 * only: no data, names or keys.
 */
export interface Timing {
  name: string
  /** Every run in order; the first one may include a cold start of the source. */
  runsMs: (number | null)[]
  medianMs: number | null
  error?: string
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

async function time(name: string, runs: number, once: () => Promise<unknown>): Promise<Timing> {
  const runsMs: (number | null)[] = []
  let error: string | undefined
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    try {
      await once()
      runsMs.push(Math.round(performance.now() - t0))
    } catch (e) {
      runsMs.push(null)
      error = (e instanceof Error ? e.message : String(e)).slice(0, 160)
    }
  }
  return { name, runsMs, medianMs: median(runsMs.filter((x): x is number => x != null)), ...(error ? { error } : {}) }
}

const must = <T extends { state: string }>(r: T) => {
  if (r.state !== 'ok') throw new Error(`state ${r.state}`)
  return r
}

export async function runTimings(): Promise<{ region: string | null; timings: Timing[] }> {
  const e = env()
  const db = supabaseAdmin()
  const out: Timing[] = []
  // The command center's own database and auth: every page pays these before it reads anything.
  out.push(await time('CC database: one-row query', 5, async () => {
    const { error } = await db.from('cc_profiles').select('id').limit(1)
    if (error) throw new Error(error.message)
  }))
  out.push(await time('CC auth server: /auth/v1/health', 5, async () => {
    const r = await fetch(`${e.cc.supabaseUrl}/auth/v1/health`, { headers: { apikey: e.cc.supabaseAnonKey ?? '' }, cache: 'no-store' })
    await r.body?.cancel()
  }))
  const { data: owner } = await db.from('cc_profiles').select('auth_user_id').eq('is_active', true).not('auth_user_id', 'is', null).limit(1).maybeSingle()
  if (owner?.auth_user_id) out.push(await time('Signed-in user lookup (profile + roles + permissions)', 3, () => resolveProfile(owner.auth_user_id as string)))
  out.push(await time('Inventory/CRM snapshot (overview, top bar)', 3, async () => must(await getOpsSnapshot())))
  out.push(await time('Shop sales, last 30 days', 3, () => getSalesStore().listSales({ since: new Date(Date.now() - 30 * 86_400_000).toISOString(), limit: 500 })))
  // Sources, through the same adapters the pages use (uncached reads).
  out.push(await time('Website endpoint: one product', 3, async () => must(await listWebsiteProductsByIds([1]))))
  out.push(await time('Gift card endpoint: card search', 3, async () => must(await searchGiftCards('zz-timing'))))
  return { region: process.env.VERCEL_REGION ?? null, timings: out }
}
