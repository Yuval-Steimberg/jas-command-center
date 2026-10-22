'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { authMode } from '@/lib/auth/mode'
import { DEV_COOKIE, DEV_SESSION_MS, issueDevSession, passwordMatches } from '@/lib/auth/dev-session'
import { supabaseUserClient } from '@/lib/supabase'
import { resolveProfile } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { allowAttempt, clearAttempts } from '@/lib/auth/rate-limit'

export type LoginState = { error?: string }

const creds = z.object({ email: z.string().trim().email().max(200).optional(), password: z.string().min(1).max(200) })

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const mode = authMode()
  if (mode.kind === 'unconfigured') return { error: mode.reason }
  const ip = headers().get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (!allowAttempt(`login:${ip}`)) return { error: 'Too many attempts. Wait 15 minutes and try again.' }

  const parsed = creds.safeParse({ email: form.get('email') || undefined, password: form.get('password') })
  if (!parsed.success) return { error: 'Enter your email and password.' }

  if (mode.kind === 'dev') {
    if (!passwordMatches(parsed.data.password, mode.password)) return { error: 'Wrong password.' }
    cookies().set(DEV_COOKIE, issueDevSession(mode.secret), { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: DEV_SESSION_MS / 1000 })
    await audit({ id: 'dev-owner', email: 'owner@localhost', role: 'owner' }, { action: 'auth.login', product: null, target: null, outcome: 'succeeded', detail: { ip, mode: 'dev' } })
  } else {
    if (!parsed.data.email) return { error: 'Enter your email.' }
    const client = supabaseUserClient()
    const { data, error } = await client.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password })
    // One message for every failure: never reveal which half was wrong.
    if (error || !data.user) return { error: 'Email or password is incorrect.' }
    const s = await resolveProfile(data.user.id)
    if (!s) {
      await client.auth.signOut()
      return { error: 'This account has no active command center role. Ask the owner to grant one.' }
    }
    await audit(s.user, { action: 'auth.login', product: null, target: null, outcome: 'succeeded', detail: { ip } })
  }
  clearAttempts(`login:${ip}`)
  redirect('/')
}

export async function signOut() {
  const mode = authMode()
  if (mode.kind === 'dev') cookies().delete(DEV_COOKIE)
  else if (mode.kind === 'supabase') await supabaseUserClient().auth.signOut()
  redirect('/login')
}
