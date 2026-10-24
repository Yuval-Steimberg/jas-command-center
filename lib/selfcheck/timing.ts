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

/** One read may take this long before it counts as failed; the whole run stops starting reads after BUDGET_MS. */
const STEP_TIMEOUT_MS = 8_000
const BUDGET_MS = 40_000

const within = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${STEP_TIMEOUT_MS} ms`)), STEP_TIMEOUT_MS))])

async function time(name: string, runs: number, once: () => Promise<unknown>, deadline: number): Promise<Timing> {
  const runsMs: (number | null)[] = []
  let error: string | undefined
  for (let i = 0; i < runs; i++) {
    if (Date.now() > deadline) {
      error ??= 'skipped: the timing run is out of time'
      break
    }
    const t0 = performance.now()
    try {
      await within(once())
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

/**
 * How many asymmetric signing keys the auth server publishes. With one, a
 * session can be verified locally (no round trip per page); with none, every
 * verification is a call to the auth server.
 */
async function authSigningKeys(url: string | null | undefined, anon: string): Promise<number | null> {
  if (!url) return null
  try {
    const r = await fetch(`${url}/auth/v1/.well-known/jwks.json`, { headers: { apikey: anon }, cache: 'no-store', signal: AbortSignal.timeout(STEP_TIMEOUT_MS) })
    if (!r.ok) return null
    const body = (await r.json()) as { keys?: unknown[] }
    return Array.isArray(body.keys) ? body.keys.length : null
  } catch {
    return null
  }
}

export async function runTimings(): Promise<{ region: string | null; authSigningKeys: number | null; timings: Timing[] }> {
  const e = env()
  const db = supabaseAdmin()
  const out: Timing[] = []
  const deadline = Date.now() + BUDGET_MS
  const keys = await authSigningKeys(e.cc.supabaseUrl, e.cc.supabaseAnonKey ?? '')
  // The command center's own database and auth: every page pays these before it reads anything.
  out.push(await time('CC database: one-row query', 3, async () => {
    const { error } = await db.from('cc_profiles').select('id').limit(1)
    if (error) throw new Error(error.message)
  }, deadline))
  out.push(await time('CC auth server: /auth/v1/health', 3, async () => {
    const r = await fetch(`${e.cc.supabaseUrl}/auth/v1/health`, { headers: { apikey: e.cc.supabaseAnonKey ?? '' }, cache: 'no-store', signal: AbortSignal.timeout(STEP_TIMEOUT_MS) })
    await r.body?.cancel()
  }, deadline))
  const { data: owner } = await db.from('cc_profiles').select('auth_user_id').eq('is_active', true).not('auth_user_id', 'is', null).limit(1).maybeSingle()
  if (owner?.auth_user_id) out.push(await time('Signed-in user lookup (profile + roles + permissions)', 2, () => resolveProfile(owner.auth_user_id as string), deadline))
  out.push(await time('Inventory/CRM snapshot (overview, top bar)', 2, async () => must(await getOpsSnapshot()), deadline))
  out.push(await time('Shop sales, last 30 days', 2, () => getSalesStore().listSales({ since: new Date(Date.now() - 30 * 86_400_000).toISOString(), limit: 500 }), deadline))
  // Sources, through the same adapters the pages use (uncached reads).
  out.push(await time('Website endpoint: one product', 2, async () => must(await listWebsiteProductsByIds([1])), deadline))
  out.push(await time('Gift card endpoint: card search', 2, async () => must(await searchGiftCards('zz-timing')), deadline))
  return { region: process.env.VERCEL_REGION ?? null, authSigningKeys: keys, timings: out }
}
