import { describe, expect, it } from 'vitest'
import { authLinkTarget, describeLinkError, otpType, parseAuthFragment } from '@/lib/auth/auth-link'

const invite = '#access_token=aaa&expires_in=3600&refresh_token=rrr&token_type=bearer&type=invite'

describe('auth link fragment', () => {
  it('reads invite tokens', () => {
    expect(parseAuthFragment(invite)).toEqual({ kind: 'tokens', access: 'aaa', refresh: 'rrr', type: 'invite' })
  })
  it('reads a refused link', () => {
    const f = parseAuthFragment('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(f).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' })
    expect(describeLinkError(f as Extract<typeof f, { kind: 'error' }>)).toMatch(/expired/)
  })
  it('ignores ordinary fragments', () => {
    expect(parseAuthFragment('')).toBeNull()
    expect(parseAuthFragment('#section-2')).toBeNull()
    expect(parseAuthFragment('#access_token=only')).toBeNull()
  })
})

describe('forwarding a link that landed on the wrong page', () => {
  it('forwards from the Site URL fallback (/ → /login) to set-password, keeping the fragment', () => {
    expect(authLinkTarget('/login', invite)).toBe(`/login/set-password${invite}`)
    expect(authLinkTarget('/', invite)).toBe(`/login/set-password${invite}`)
    expect(authLinkTarget('/', '#error_code=otp_expired')).toBe('/login/set-password#error_code=otp_expired')
  })
  it('never loops on set-password and leaves normal pages alone', () => {
    expect(authLinkTarget('/login/set-password', invite)).toBeNull()
    expect(authLinkTarget('/inventory', '#top')).toBeNull()
    expect(authLinkTarget('/inventory', '')).toBeNull()
  })
})

describe('token_hash link type', () => {
  it('accepts known types and defaults to invite', () => {
    expect(otpType('recovery')).toBe('recovery')
    expect(otpType('signup')).toBe('invite')
    expect(otpType(undefined)).toBe('invite')
  })
})
