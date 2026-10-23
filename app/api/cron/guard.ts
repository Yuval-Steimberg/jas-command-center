import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

/**
 * Cron routes are outside the sign-in middleware, so this is their only lock:
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it when the variable
 * is set). No secret configured = the route does not exist.
 */
export function cronDenied(req: Request): NextResponse | null {
  const secret = env().email.cronSecret
  if (!secret || secret.length < 16) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const given = req.headers.get('authorization') ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(`Bearer ${secret}`)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  return ok ? null : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}
