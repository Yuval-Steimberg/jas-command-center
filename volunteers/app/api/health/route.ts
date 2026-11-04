import { NextResponse } from 'next/server'
import { env, missingConfig } from '@/lib/env'
import { getStore } from '@/lib/store'
import { getScheduleStore } from '@/lib/schedule'

export const dynamic = 'force-dynamic'

/** Configuration flags and one live read. Never returns a name, an address or a secret. */
export async function GET() {
  const e = env()
  let database: 'ok' | 'not_configured' | 'error' = 'not_configured'
  let error: string | undefined
  let schedule: 'ok' | 'not_configured' | 'error' = 'not_configured'
  if (e.supabaseUrl && e.supabaseServiceKey) {
    try {
      await getStore().listActivities({ statuses: ['published'] })
      database = 'ok'
      try {
        // A read of the scheduling tables (0011) for a volunteer id that cannot exist: proves they are there.
        await getScheduleStore().loadForVolunteer('00000000-0000-4000-8000-000000000000', '2000-01-01', '2000-01-01')
        schedule = 'ok'
      } catch {
        schedule = 'error'
        error = 'migration 0011_volunteer_schedule not applied'
      }
    } catch (err) {
      database = 'error'
      error = err instanceof Error && /0005_volunteers|does not exist|schema cache/.test(err.message) ? 'migration 0005_volunteers not applied' : 'read failed'
    }
  }
  const missing = missingConfig()
  return NextResponse.json(
    { ok: database === 'ok' && schedule === 'ok' && missing.length === 0, database, schedule, error, missing, email: e.sendgridKey ? 'sendgrid' : 'not_configured', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { headers: { 'cache-control': 'no-store' } },
  )
}
