'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { supabaseUserClient } from '@/lib/supabase'
import { resolveProfile } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { OTP_TYPES } from '@/lib/auth/auth-link'

export type SetPasswordState = { error?: string }

const input = z.object({
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
  confirm: z.string(),
  accessToken: z.string().max(4000).optional(),
  refreshToken: z.string().max(4000).optional(),
  tokenHash: z.string().max(400).optional(),
  otpType: z.enum(OTP_TYPES).catch('invite'),
})

/**
 * The landing for a Supabase invite (or password-reset) link. The link carries
 * either session tokens in the URL fragment or a token_hash; either way the
 * session is established server-side, the password set, and only a person with
 * an active command center profile is let in.
 */
export async function setPassword(_prev: SetPasswordState, form: FormData): Promise<SetPasswordState> {
  const p = input.safeParse({
    password: form.get('password'),
    confirm: form.get('confirm'),
    accessToken: form.get('accessToken') || undefined,
    refreshToken: form.get('refreshToken') || undefined,
    tokenHash: form.get('tokenHash') || undefined,
    otpType: form.get('otpType'),
  })
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' }
  if (p.data.password !== p.data.confirm) return { error: 'The two passwords differ.' }
  const client = supabaseUserClient()
  const session = p.data.tokenHash
    ? await client.auth.verifyOtp({ token_hash: p.data.tokenHash, type: p.data.otpType })
    : p.data.accessToken && p.data.refreshToken
      ? await client.auth.setSession({ access_token: p.data.accessToken, refresh_token: p.data.refreshToken })
      : null
  if (!session || session.error || !session.data.user) return { error: 'This link has expired or was already used. Ask the owner to send a new link from Settings → Staff.' }
  const upd = await client.auth.updateUser({ password: p.data.password })
  if (upd.error) return { error: `Password not set: ${upd.error.message}` }
  const s = await resolveProfile(session.data.user.id)
  if (!s) {
    await client.auth.signOut()
    return { error: 'Your password is set, but this account has no active command center role. Ask the owner.' }
  }
  await audit(s.user, { action: 'auth.set_password', product: null, target: null, outcome: 'succeeded', detail: {} })
  redirect('/')
}
