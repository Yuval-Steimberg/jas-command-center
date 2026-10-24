import { NextResponse } from 'next/server'
import { currentVolunteer } from '@/lib/session'
import { getStore } from '@/lib/store'
import { env } from '@/lib/env'
import { placeHe } from '@/lib/format'

export const dynamic = 'force-dynamic'

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`)

/** A calendar file for one of my own sign-ups. Someone else's sign-up id answers 404. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const v = await currentVolunteer()
  if (!v) return new NextResponse('Not found', { status: 404 })
  const store = getStore()
  const s = (await store.listSignups({ volunteerId: v.id })).find((x) => x.id === params.id)
  const shift = s ? await store.getShift(s.shiftId) : null
  const a = shift ? await store.getActivity(shift.activityId) : null
  if (!s || !shift || !a) return new NextResponse('Not found', { status: 404 })
  const url = env().appUrl ? `${env().appUrl}/my/${s.id}` : ''
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Just A Second//Volunteers//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${s.id}@volunteers.justasecond`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(shift.startsAt)}`,
    `DTEND:${stamp(shift.endsAt)}`,
    `SUMMARY:${esc(`התנדבות: ${a.title}`)}`,
    `LOCATION:${esc(placeHe(a))}`,
    `DESCRIPTION:${esc([a.summary, a.arrivalInfo, url].filter(Boolean).join('\n'))}`,
    shift.status === 'cancelled' || a.status === 'cancelled' || s.status !== 'confirmed' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
  return new NextResponse(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="jas-${shift.startsAt.slice(0, 10)}.ics"`, 'cache-control': 'no-store' } })
}
