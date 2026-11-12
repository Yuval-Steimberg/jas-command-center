'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { authMode } from '@/lib/auth/mode'
import { supabaseUserClient } from '@/lib/supabase'
import { audit } from '@/lib/audit/audit'
import { challengeIdSchema, credentialSchema, dropPasskeyCount, errorCode } from '@/lib/auth/passkeys'
import type { JsonCreationOptions } from '@/lib/auth/passkey-browser'

/**
 * Turning Face ID on for one device = saving a passkey to the signed-in
 * person's own Supabase Auth account. Each person manages only their own:
 * Supabase scopes every call to the session's user. Adding and removing are
 * audited (requested, then the outcome), because they change how someone can
 * get in.
 */

export type RegisterStart = { ok: true; challengeId: string; options: JsonCreationOptions } | { ok: false; code: string }
export type Done = { ok: true } | { ok: false; code: string }

async function me() {
  if (authMode().kind !== 'supabase') return null
  const s = await getSession()
  return s && !s.user.dev ? s.user : null
}

export async function startPasskeySetup(): Promise<RegisterStart> {
  const user = await me()
  if (!user) return { ok: false, code: 'no_role' }
  const { data, error } = await supabaseUserClient().auth.passkey.startRegistration()
  if (error || !data) return { ok: false, code: errorCode(error) }
  return { ok: true, challengeId: data.challenge_id, options: data.options as unknown as JsonCreationOptions }
}

const label = z.string().trim().min(1).max(60)

export async function finishPasskeySetup(challengeId: unknown, credential: unknown, deviceName: unknown): Promise<Done> {
  const user = await me()
  if (!user) return { ok: false, code: 'no_role' }
  const id = challengeIdSchema.safeParse(challengeId)
  const cred = credentialSchema.safeParse(credential)
  if (!id.success || !cred.success) return { ok: false, code: 'webauthn_verification_failed' }
  const name = label.safeParse(deviceName)

  await audit(user, { action: 'auth.passkey_add', product: null, target: user.id, outcome: 'requested', detail: { device: name.success ? name.data : null } })
  const client = supabaseUserClient()
  const { data, error } = await client.auth.passkey.verifyRegistration({ challengeId: id.data, credential: cred.data as never })
  if (error || !data) {
    const code = errorCode(error)
    await audit(user, { action: 'auth.passkey_add', product: null, target: user.id, outcome: 'failed', detail: { code } })
    return { ok: false, code }
  }
  // "iPhone · 12/11/2026" reads better in the list than "iCloud Keychain". A failed rename keeps Supabase's name.
  if (name.success) {
    const day = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Jerusalem' })
    await client.auth.passkey.update({ passkeyId: data.id, friendlyName: `${name.data} · ${day}` }).catch(() => undefined)
  }
  await audit(user, { action: 'auth.passkey_add', product: null, target: user.id, outcome: 'succeeded', detail: { passkeyId: data.id } })
  dropPasskeyCount(user.id)
  revalidatePath('/portal/face-id')
  return { ok: true }
}

export async function removePasskey(passkeyId: unknown): Promise<Done> {
  const user = await me()
  if (!user) return { ok: false, code: 'no_role' }
  const id = z.string().uuid().safeParse(passkeyId)
  if (!id.success) return { ok: false, code: 'webauthn_credential_not_found' }
  await audit(user, { action: 'auth.passkey_remove', product: null, target: user.id, outcome: 'requested', detail: { passkeyId: id.data } })
  const { error } = await supabaseUserClient().auth.passkey.delete({ passkeyId: id.data })
  const code = error ? errorCode(error) : null
  await audit(user, { action: 'auth.passkey_remove', product: null, target: user.id, outcome: code ? 'failed' : 'succeeded', detail: { passkeyId: id.data, ...(code ? { code } : {}) } })
  dropPasskeyCount(user.id)
  revalidatePath('/portal/face-id')
  return code ? { ok: false, code } : { ok: true }
}
