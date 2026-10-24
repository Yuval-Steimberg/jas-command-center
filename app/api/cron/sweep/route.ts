import { NextResponse } from 'next/server'
import { runSweep } from '@/lib/live'
import { emailNewAlerts } from '@/lib/notifications/deliver'
import { cronDenied } from '../guard'
import { runOpsSync } from '@/lib/sync/run'
import { runVolunteerJobs } from '@/lib/volunteers/notify'
import { getVolunteerStore, volunteerContext, volunteerSender } from '@/lib/volunteer-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Reads every source, records alerts that opened or closed, and emails the
 * ones that just opened to the people who asked for them. Pinged hourly by
 * .github/workflows/sweep.yml (Vercel Hobby crons are daily only),
 * so an alert does not wait for someone to open the console. It also runs the
 * operations sync first (lib/sync/run.ts): counts only in the response, never names.
 * Volunteer reminders, thank-yous and the volunteer email outbox go out here
 * too (the volunteer app's own daily cron runs the same idempotent job).
 */
export async function GET(req: Request) {
  const denied = cronDenied(req)
  if (denied) return denied
  // Orders → inventory + customers, form messages → leads, expired reservations, BEFORE alerts are derived.
  const sync = await runOpsSync().catch((e) => ({ state: 'error' as const, steps: [], message: e instanceof Error ? e.message : String(e) }))
  const volunteers = await runVolunteerJobs(getVolunteerStore(), volunteerSender(), volunteerContext())
    .then((r) => ({ state: 'ok' as const, queued: r.queued, ...r.delivery }))
    .catch((e) => ({ state: 'error' as const, error: e instanceof Error ? e.message : String(e) }))
  const sweep = await runSweep()
  const email = await emailNewAlerts().catch((e) => ({ state: 'error' as const, error: e instanceof Error ? e.message : String(e) }))
  return NextResponse.json({ ok: true, sync: { state: sync.state, steps: sync.steps.map((x) => ({ step: x.step, state: x.state, counts: x.counts })) }, alerts: sweep.alerts, email, volunteers }, { headers: { 'Cache-Control': 'no-store' } })
}
