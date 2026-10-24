import 'server-only'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { env } from './env'
import { getStore } from './store'
import { sender } from './mail'

/**
 * Email one-time codes. Six digits, valid 10 minutes, 5 wrong guesses and the
 * code is dead, at most 5 codes per address per hour. The response never says
 * whether an address has an account (the same message either way).
 *
 * Phone (SMS) sign-in is not offered: there is no SMS provider. It would need
 * one (e.g. Twilio through Supabase Auth phone sign-in) and a budget.
 */
const TTL = 10 * 60_000
const MAX_TRIES = 5
const PER_HOUR = 5

const hash = (email: string, code: string) => createHmac('sha256', env().sessionSecret ?? 'development-only-secret-not-for-production-use').update(`${email}:${code}`).digest('hex')

export type SendCodeResult = { ok: true; devCode?: string } | { ok: false; message: string }

export async function sendLoginCode(email: string): Promise<SendCodeResult> {
  const store = getStore()
  const since = new Date(Date.now() - 3_600_000).toISOString()
  if ((await store.countLoginCodes(email, since)) >= PER_HOUR) return { ok: false, message: 'נשלחו כבר כמה קודים בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.' }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await store.addLoginCode(email, hash(email, code), new Date(Date.now() + TTL).toISOString())
  const send = sender()
  if (!send) {
    // Local development only: no email provider, the code is shown on screen.
    if (!env().production) return { ok: true, devCode: code }
    return { ok: false, message: 'שליחת אימייל עדיין לא הוגדרה. נסו שוב מאוחר יותר.' }
  }
  const r = await send(email, `קוד הכניסה שלך: ${code}`, [`קוד הכניסה ל-JAS Volunteers הוא: ${code}`, '', 'הקוד בתוקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.', '', '— Just A Second'].join('\n'))
  if (!r.ok) {
    console.error('login code email failed:', r.error)
    return { ok: false, message: 'לא הצלחנו לשלוח את הקוד כרגע. נסו שוב בעוד רגע.' }
  }
  return { ok: true }
}

export type VerifyResult = { ok: true } | { ok: false; message: string }

export async function verifyLoginCode(email: string, code: string): Promise<VerifyResult> {
  const store = getStore()
  const c = await store.latestLoginCode(email)
  const bad = { ok: false as const, message: 'הקוד לא נכון או שפג תוקפו. אפשר לבקש קוד חדש.' }
  if (!c || c.consumedAt || Date.parse(c.expiresAt) < Date.now() || c.attempts >= MAX_TRIES) return bad
  const a = Buffer.from(c.codeHash)
  const b = Buffer.from(hash(email, code))
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await store.failLoginCode(c.id)
    return bad
  }
  return (await store.consumeLoginCode(c.id)) ? { ok: true } : bad
}
