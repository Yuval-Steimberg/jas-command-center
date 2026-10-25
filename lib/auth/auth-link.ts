/**
 * What a Supabase email link (invite, password reset) carries in the URL
 * fragment, read in the browser. Pure and client-safe so it is unit-tested.
 *
 * Supabase appends the fragment to whatever URL it redirects to — the
 * invitation's redirectTo when that URL is on the project's allow list, its
 * Site URL otherwise. So the fragment can arrive on ANY page (usually `/`,
 * which signs a visitor out to /login), not only /login/set-password.
 */
export type AuthFragment =
  | { kind: 'tokens'; access: string; refresh: string; type: string | null }
  | { kind: 'error'; code: string | null; description: string | null }

export function parseAuthFragment(hash: string): AuthFragment | null {
  const h = new URLSearchParams(hash.replace(/^#/, ''))
  const access = h.get('access_token')
  const refresh = h.get('refresh_token')
  if (access && refresh) return { kind: 'tokens', access, refresh, type: h.get('type') }
  if (h.get('error') || h.get('error_code')) return { kind: 'error', code: h.get('error_code') ?? h.get('error'), description: h.get('error_description') }
  return null
}

export const SET_PASSWORD_PATH = '/login/set-password'

/** Where a page holding this fragment must send the browser, or null to stay. */
export function authLinkTarget(pathname: string, hash: string): string | null {
  if (pathname === SET_PASSWORD_PATH || !parseAuthFragment(hash)) return null
  return SET_PASSWORD_PATH + (hash.startsWith('#') ? hash : `#${hash}`)
}

/** The person-facing sentence for a link Supabase refused (expired, used, mistyped). */
export function describeLinkError(f: Extract<AuthFragment, { kind: 'error' }>): string {
  if (f.code === 'otp_expired') return 'This link has expired or was already used. Ask the owner to send a new one from Settings → Staff.'
  return `This link did not work${f.description ? ` (${f.description})` : ''}. Ask the owner to send a new one from Settings → Staff.`
}

/** token_hash link types /login/set-password accepts (Supabase verifyOtp types). */
export const OTP_TYPES = ['invite', 'recovery', 'magiclink', 'email'] as const
export type OtpType = (typeof OTP_TYPES)[number]
export const otpType = (v: unknown): OtpType => (OTP_TYPES as readonly unknown[]).includes(v) ? (v as OtpType) : 'invite'
