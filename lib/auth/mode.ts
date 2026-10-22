import 'server-only'
import { env } from '@/lib/env'

export type AuthMode =
  | { kind: 'supabase' }
  | { kind: 'dev'; secret: string; password: string }
  | { kind: 'unconfigured'; reason: string }

/**
 * Production ALWAYS uses Supabase Auth. The local owner login exists so the
 * app can be developed without a Supabase project, and it refuses to run in a
 * production build no matter what is set.
 */
export function authMode(): AuthMode {
  const e = env()
  if (e.cc.supabaseUrl && e.cc.supabaseAnonKey && e.cc.supabaseServiceKey) return { kind: 'supabase' }
  if (e.isProduction) {
    return {
      kind: 'unconfigured',
      reason:
        'Sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for the command center Supabase project.',
    }
  }
  if (e.cc.devPassword && e.cc.sessionSecret && e.cc.sessionSecret.length >= 32) {
    return { kind: 'dev', secret: e.cc.sessionSecret, password: e.cc.devPassword }
  }
  return {
    kind: 'unconfigured',
    reason:
      'Local sign-in needs CC_DEV_PASSWORD and CC_SESSION_SECRET (32+ characters) in .env.local, or the Supabase variables.',
  }
}
