import { NextResponse, type NextRequest } from 'next/server'
import { currentScheduler, LOCATION_COOKIE } from '@/lib/schedule/store'

export const dynamic = 'force-dynamic'

/** Only paths inside schedule mode; anything else goes to the week. */
const safeNext = (n: string | null) => (n && /^\/schedule(\/[\w\-/]*)?(\?[\w=&%-]*)?$/.test(n) ? n : '/schedule')

/**
 * Switch the place the schedule shows (?id=<location>&next=/schedule/...).
 * The cookie is a preference, never a permission: the place must be one of
 * the person's own, and every read and write is still decided by the database.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const next = safeNext(url.searchParams.get('next'))
  const res = NextResponse.redirect(new URL(next, url.origin), 303)
  const s = await currentScheduler()
  if ('error' in s || !id || !s.locations.some((l) => l.id === id)) return res
  res.cookies.set(LOCATION_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/schedule', maxAge: 60 * 60 * 24 * 365 })
  return res
}
