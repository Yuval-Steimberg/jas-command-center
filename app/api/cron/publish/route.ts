import { NextResponse } from 'next/server'
import { cronDenied } from '../guard'
import { autoPublish } from '@/lib/sync/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Stop starting items this long after the request began; leaves room to answer inside maxDuration. */
const BUDGET_MS = 45_000

/**
 * The automatic website publishing step (items marked "on the website" that
 * became ready + Photoroom catalog photos), pinged hourly by
 * .github/workflows/sweep.yml right after the alert sweep. It used to run
 * inside /api/cron/sweep, where Photoroom edits pushed the whole sweep past
 * the 60 s limit and no alert went out for two days (Nov 2026). Here it has
 * its own invocation and a deadline: what does not fit waits for the next run.
 * Counts only in the response.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req)
  if (denied) return denied
  const started = Date.now()
  const step = await autoPublish(started + BUDGET_MS).catch((e) => ({ step: 'website_publish' as const, state: 'error' as const, message: e instanceof Error ? e.message : String(e), counts: {} }))
  // Counts only, like the sweep: the reasons are on each item card and in "Sync now" on /sales.
  return NextResponse.json({ ok: true, state: step.state, counts: step.counts, ms: Date.now() - started }, { headers: { 'Cache-Control': 'no-store' } })
}
