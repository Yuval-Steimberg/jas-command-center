import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Local-development session: `<expiresAtMs>.<hmac>` signed with CC_SESSION_SECRET.
 * Only ever accepted outside production AND when Supabase Auth is not configured
 * (see authMode()). Pure functions so they are unit-tested.
 */
export const DEV_COOKIE = 'cc_dev_session'
export const DEV_SESSION_MS = 8 * 60 * 60 * 1000

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url')

export function issueDevSession(secret: string, now = Date.now()): string {
  const exp = String(now + DEV_SESSION_MS)
  return `${exp}.${sign(`dev-owner.${exp}`, secret)}`
}

export function verifyDevSession(value: string | undefined, secret: string, now = Date.now()): boolean {
  if (!value) return false
  const [exp, mac] = value.split('.')
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) <= now) return false
  const expected = Buffer.from(sign(`dev-owner.${exp}`, secret))
  const got = Buffer.from(mac)
  return got.length === expected.length && timingSafeEqual(got, expected)
}

export function passwordMatches(given: string, expected: string): boolean {
  const a = createHmac('sha256', 'cmp').update(given).digest()
  const b = createHmac('sha256', 'cmp').update(expected).digest()
  return timingSafeEqual(a, b)
}
