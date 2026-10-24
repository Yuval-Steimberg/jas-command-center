import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runVolunteerJobs } from '@shared/volunteers/notify'
import { env } from '@/lib/env'
import { getStore } from '@/lib/store'
import { notifyContext, sender } from '@/lib/mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Reminders, thank-yous and the outbox. The Command Center's hourly sweep runs
 * the same job; both are safe together because every message has a dedupe key
 * and the outbox claim is atomic. Locked by CRON_SECRET; without one it refuses.
 */
export async function GET(req: Request) {
  const secret = env().cronSecret
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || !same(auth, `Bearer ${secret}`)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const r = await runVolunteerJobs(getStore(), sender(), notifyContext())
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('volunteer cron failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'job failed' }, { status: 500 })
  }
}
