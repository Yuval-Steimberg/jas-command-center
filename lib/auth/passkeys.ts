import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { authMode } from './mode'
import { supabaseUserClient } from '@/lib/supabase'
import { cached, invalidate } from '@/lib/integrations/cache'

/**
 * Passkeys (Face ID / fingerprint) are Supabase Auth's own: it stores them,
 * issues the challenge and checks the answer. Nothing about them is kept in the
 * command center's database. They are switched on per project in the Supabase
 * dashboard (Authentication → Passkeys) — see docs/PASSKEYS.md.
 */

/**
 * Is passkey sign-in switched on for the command center's Supabase project?
 * `null` = could not tell (the button is then offered and Supabase's own answer
 * is shown if it refuses). Read from the public /auth/v1/settings, cached 5 min.
 */
export async function passkeysEnabled(): Promise<boolean | null> {
  if (authMode().kind !== 'supabase') return false
  const e = env().cc
  return cached('passkeys:enabled', 5 * 60_000, async () => {
    try {
      const r = await fetch(`${e.supabaseUrl!.replace(/\/+$/, '')}/auth/v1/settings`, {
        headers: { apikey: e.supabaseAnonKey! },
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      })
      if (!r.ok) return null
      return readEnabled(await r.json())
    } catch {
      return null
    }
  })
}

/** Exported for tests. The field name is not documented; accept the spellings seen so far. */
export function readEnabled(settings: unknown): boolean | null {
  if (!settings || typeof settings !== 'object') return null
  const s = settings as Record<string, unknown>
  for (const k of ['passkeys_enabled', 'passkey_enabled']) if (typeof s[k] === 'boolean') return s[k] as boolean
  const ext = s.external as Record<string, unknown> | undefined
  if (ext && typeof ext.passkey === 'boolean') return ext.passkey
  return null
}

const b64 = z.string().max(16_384).regex(/^[A-Za-z0-9_-]*$/)

/** The browser's answer, checked before it is forwarded to Supabase. */
export const credentialSchema = z
  .object({
    id: b64.min(1).max(1024),
    rawId: b64.min(1).max(1024),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: b64,
        attestationObject: b64.optional(),
        authenticatorData: b64.optional(),
        signature: b64.optional(),
        userHandle: b64.optional(),
        transports: z.array(z.string().max(40)).max(10).optional(),
      })
      .strict(),
    clientExtensionResults: z.record(z.unknown()).default({}),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  })
  .strict()

export const challengeIdSchema = z.string().min(1).max(200)

/** Supabase's error_code, or a word for the failure. Never the raw message (it may name the account). */
export function errorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; name?: unknown }
    if (typeof o.code === 'string' && o.code) return o.code
  }
  return 'unknown'
}

const COUNT = 'passkeys:count:'

/**
 * How many passkeys the signed-in person has (null = could not read). Kept 10 min
 * per person, so the home page's offer costs one Supabase round trip, not one per view.
 * `userId` is the command center profile id, only used as the cache key.
 */
export async function passkeyCount(userId: string): Promise<number | null> {
  return cached(`${COUNT}${userId}`, 10 * 60_000, async () => {
    const { data, error } = await supabaseUserClient().auth.passkey.list()
    return error || !data ? null : data.length
  })
}

export function dropPasskeyCount(userId: string) {
  invalidate(`${COUNT}${userId}`)
}
