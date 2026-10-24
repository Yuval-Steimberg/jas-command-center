import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Volunteer } from '@shared/volunteers/model'
import { env } from './env'
import { getStore } from './store'

/**
 * Volunteer sessions: an HMAC-signed cookie naming the volunteer and their
 * session version. Every request re-reads the volunteer, so blocking,
 * pausing or deleting an account (each bumps the version) signs them out
 * everywhere at once. No Command Center access is ever implied: staff log in
 * to the Command Center with Supabase Auth, volunteers never do.
 */
const COOKIE = 'jv_session'
const PENDING = 'jv_pending'
const DAYS = 60

function secret(): string {
  const s = env().sessionSecret
  if (s && s.length >= 32) return s
  if (env().production) throw new Error('VOLUNTEER_SESSION_SECRET is not set (32+ characters).')
  return 'development-only-secret-not-for-production-use'
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')
function verify(token: string | undefined): string[] | null {
  if (!token) return null
  const i = token.lastIndexOf('.')
  if (i < 0) return null
  const payload = token.slice(0, i)
  const a = Buffer.from(token.slice(i + 1))
  const b = Buffer.from(sign(payload))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const parts = payload.split('|')
  if (Number(parts.at(-1)) < Date.now()) return null
  return parts
}

const cookieOpts = (maxAge: number) => ({ httpOnly: true, secure: env().production, sameSite: 'lax' as const, path: '/', maxAge })

export function startSession(v: Pick<Volunteer, 'id' | 'sessionVersion'>) {
  const exp = Date.now() + DAYS * 86_400_000
  const payload = `${v.id}|${v.sessionVersion}|${exp}`
  cookies().set(COOKIE, `${payload}.${sign(payload)}`, cookieOpts(DAYS * 86_400))
  cookies().delete(PENDING)
}

export function endSession() {
  cookies().delete(COOKIE)
  cookies().delete(PENDING)
}

/** The signed-in volunteer, or null. Inactive or deleted accounts are signed out. */
export const currentVolunteer = cache(async (): Promise<Volunteer | null> => {
  const parts = verify(cookies().get(COOKIE)?.value)
  if (!parts) return null
  const [id, version] = parts
  const v = await getStore().getVolunteer(id!)
  if (!v || v.status !== 'active' || String(v.sessionVersion) !== version) return null
  return v
})

export async function requireVolunteer(next = '/'): Promise<Volunteer> {
  const v = await currentVolunteer()
  if (!v) redirect(`/login?next=${encodeURIComponent(next)}`)
  return v
}

/** After a verified code for an address that has no account yet: lets /join register exactly that address. */
export function setPendingEmail(email: string) {
  const exp = Date.now() + 30 * 60_000
  const payload = `${email}|${exp}`
  cookies().set(PENDING, `${payload}.${sign(payload)}`, cookieOpts(30 * 60))
}

export function pendingEmail(): string | null {
  const parts = verify(cookies().get(PENDING)?.value)
  return parts ? parts[0]! : null
}

/** Only same-site paths are followed after sign-in. */
export const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(v) ? v : '/')
