import { NextResponse } from 'next/server'
import { emailScheduledReports } from '@/lib/notifications/deliver'
import { cronDenied } from '../guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The scheduled business report by email (vercel.json: daily 18:00 UTC = evening in Israel, so "today" is a full day). */
export async function GET(req: Request) {
  const denied = cronDenied(req)
  if (denied) return denied
  try {
    return NextResponse.json({ ok: true, reports: await emailScheduledReports() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
