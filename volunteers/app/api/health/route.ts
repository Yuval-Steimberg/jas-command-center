import { NextResponse } from 'next/server'
import { env, missingConfig } from '@/lib/env'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** Configuration flags and one live read. Never returns a name, an address or a secret. */
export async function GET() {
  const e = env()
  let database: 'ok' | 'not_configured' | 'error' = 'not_configured'
  let error: string | undefined
  if (e.supabaseUrl && e.supabaseServiceKey) {
    try {
      await getStore().listActivities({ statuses: ['published'] })
      database = 'ok'
    } catch (err) {
      database = 'error'
      error = err instanceof Error && /0005_volunteers|does not exist|schema cache/.test(err.message) ? 'migration 0005_volunteers not applied' : 'read failed'
    }
  }
  const missing = missingConfig()
  return NextResponse.json(
    { ok: database === 'ok' && missing.length === 0, database, error, missing, email: e.sendgridKey ? 'sendgrid' : 'not_configured', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { headers: { 'cache-control': 'no-store' } },
  )
}
