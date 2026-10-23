import { NextResponse } from 'next/server'
import { runSweep } from '@/lib/live'
import { emailNewAlerts } from '@/lib/notifications/deliver'
import { cronDenied } from '../guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Reads every source, records alerts that opened or closed, and emails the
 * ones that just opened to the people who asked for them. Pinged hourly by
 * .github/workflows/sweep.yml (Vercel Hobby crons are daily only),
 * so an alert does not wait for someone to open the console.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req)
  if (denied) return denied
  const sweep = await runSweep()
  const email = await emailNewAlerts().catch((e) => ({ state: 'error' as const, error: e instanceof Error ? e.message : String(e) }))
  return NextResponse.json({ ok: true, alerts: sweep.alerts, email }, { headers: { 'Cache-Control': 'no-store' } })
}
