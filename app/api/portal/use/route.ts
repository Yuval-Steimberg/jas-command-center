import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { ID_RE } from '@/lib/portal/model'
import { getUsageStore } from '@/lib/portal/usage'

export const dynamic = 'force-dynamic'

/**
 * A tap on a portal button, sent by the browser (navigator.sendBeacon) as it
 * opens the link. Counts toward that person's most used buttons. Never fails
 * loudly: the link opens whatever happens here, and a lost count is harmless.
 * Not audited: it records nothing about the business, only the person's own
 * shortcut order.
 */
export async function POST(req: Request) {
  const s = await getSession()
  if (!s) return new NextResponse(null, { status: 204 })
  const id = (await req.text().catch(() => '')).trim()
  if (!ID_RE.test(id)) return new NextResponse(null, { status: 204 })
  try {
    await getUsageStore().record(s.user.id, id)
  } catch (e) {
    console.warn('portal usage not recorded', e instanceof Error ? e.message : e)
  }
  return new NextResponse(null, { status: 204 })
}
