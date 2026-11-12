'use server'

import { headers } from 'next/headers'
import { authMode } from '@/lib/auth/mode'
import { supabaseUserClient } from '@/lib/supabase'
import { resolveProfile, SetupError } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { allowAttempt, clearAttempts } from '@/lib/auth/rate-limit'
import { safeNext } from '@/lib/portal/model'
import { challengeIdSchema, credentialSchema, errorCode } from '@/lib/auth/passkeys'
import type { JsonRequestOptions } from '@/lib/auth/passkey-browser'

/**
 * Sign-in with a saved passkey (Face ID / fingerprint). Two steps, both on the
 * server, so Supabase sets the same session cookie a password sign-in sets and
 * the same profile + role check runs: (1) fetch Supabase's challenge, (2) the
 * browser signs it, and Supabase checks the answer and opens the session.
 * No email is asked: the passkey itself says whose it is.
 */

const ip = () => headers().get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

export type PasskeyStart = { ok: true; challengeId: string; options: JsonRequestOptions } | { ok: false; code: string }
export type PasskeyFinish = { ok: true; to: string } | { ok: false; code: string; message?: string }

export async function startPasskeySignIn(): Promise<PasskeyStart> {
  if (authMode().kind !== 'supabase') return { ok: false, code: 'passkey_disabled' }
  // Not counted against the sign-in limit: the login page fetches one on load (see usePrefetchedChallenge).
  const { data, error } = await supabaseUserClient().auth.passkey.startAuthentication()
  if (error || !data) return { ok: false, code: errorCode(error) }
  return { ok: true, challengeId: data.challenge_id, options: data.options as unknown as JsonRequestOptions }
}

export async function finishPasskeySignIn(challengeId: unknown, credential: unknown, next: unknown): Promise<PasskeyFinish> {
  if (authMode().kind !== 'supabase') return { ok: false, code: 'passkey_disabled' }
  const where = ip()
  if (!allowAttempt(`login:${where}`)) return { ok: false, code: 'rate_limited' }
  const id = challengeIdSchema.safeParse(challengeId)
  const cred = credentialSchema.safeParse(credential)
  if (!id.success || !cred.success) return { ok: false, code: 'webauthn_verification_failed' }

  const client = supabaseUserClient()
  const { data, error } = await client.auth.passkey.verifyAuthentication({ challengeId: id.data, credential: cred.data as never })
  if (error || !data?.user) return { ok: false, code: errorCode(error) }

  let s
  try {
    s = await resolveProfile(data.user.id)
  } catch (e) {
    await client.auth.signOut()
    if (e instanceof SetupError) return { ok: false, code: 'setup', message: e.message }
    throw e
  }
  if (!s) {
    await client.auth.signOut()
    return { ok: false, code: 'no_role' }
  }
  await audit(s.user, { action: 'auth.login', product: null, target: null, outcome: 'succeeded', detail: { ip: where, method: 'passkey' } })
  clearAttempts(`login:${where}`)
  return { ok: true, to: safeNext(typeof next === 'string' ? next : '') ?? '/' }
}
