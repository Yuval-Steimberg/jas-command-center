import { NextResponse } from 'next/server'
import { runSelfCheck } from '@/lib/selfcheck/run'
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
  const result = await runSelfCheck()
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
