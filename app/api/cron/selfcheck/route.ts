import { NextResponse } from 'next/server'
import { runSelfCheck } from '@/lib/selfcheck/run'
import { runTimings } from '@/lib/selfcheck/timing'
import { cronDenied } from '../guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Read-only production check of every Command Center section (see
 * lib/selfcheck/run.ts). Locked by CRON_SECRET like the other cron routes;
 * called by .github/workflows/prod-check.yml. Counts and states only.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req)
  if (denied) return denied
  // ?timing=1: the reads behind a page timed one at a time (lib/selfcheck/timing.ts), instead of the check.
  if (new URL(req.url).searchParams.get('timing') === '1') return NextResponse.json(await runTimings(), { headers: { 'Cache-Control': 'no-store' } })
  const result = await runSelfCheck()
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
