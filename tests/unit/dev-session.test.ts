import { describe, expect, it } from 'vitest'
import { DEV_SESSION_MS, issueDevSession, passwordMatches, verifyDevSession } from '@/lib/auth/dev-session'

const SECRET = 'x'.repeat(40)

describe('dev session', () => {
  it('round-trips', () => {
    const now = 1_700_000_000_000
    expect(verifyDevSession(issueDevSession(SECRET, now), SECRET, now + 1000)).toBe(true)
  })
  it('expires', () => {
    const now = 1_700_000_000_000
    expect(verifyDevSession(issueDevSession(SECRET, now), SECRET, now + DEV_SESSION_MS + 1)).toBe(false)
  })
  it('rejects a forged expiry, another secret and garbage', () => {
    const now = 1_700_000_000_000
    const v = issueDevSession(SECRET, now)
    const [, mac] = v.split('.')
    expect(verifyDevSession(`${now + 10 * DEV_SESSION_MS}.${mac}`, SECRET, now)).toBe(false)
    expect(verifyDevSession(v, 'y'.repeat(40), now)).toBe(false)
    expect(verifyDevSession('nonsense', SECRET, now)).toBe(false)
    expect(verifyDevSession(undefined, SECRET, now)).toBe(false)
  })
  it('compares passwords exactly', () => {
    expect(passwordMatches('hunter2', 'hunter2')).toBe(true)
    expect(passwordMatches('hunter2 ', 'hunter2')).toBe(false)
  })
})
