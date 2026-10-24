'use server'

import { redirect } from 'next/navigation'
import { normalizeEmail } from '@shared/volunteers/model'
import { sendLoginCode, verifyLoginCode } from '@/lib/login'
import { safeNext, setPendingEmail, startSession } from '@/lib/session'
import { getStore } from '@/lib/store'
import { heMessage } from '@/lib/errors'

export type LoginState = { step: 'email' | 'code'; email?: string; message?: string; ok?: boolean; devCode?: string; next?: string }

export async function loginAction(prev: LoginState, f: FormData): Promise<LoginState> {
  const next = safeNext(f.get('next'))
  if (f.get('intent') === 'restart') return { step: 'email', next }
  if (prev.step === 'email' || f.get('intent') === 'resend') {
    const email = normalizeEmail(String(f.get('email') ?? prev.email ?? ''))
    if (!email) return { step: 'email', next, ok: false, message: 'נא לכתוב כתובת אימייל תקינה.' }
    try {
      const r = await sendLoginCode(email)
      if (!r.ok) return { step: 'email', email, next, ok: false, message: r.message }
      return { step: 'code', email, next, ok: true, message: `שלחנו קוד בן 6 ספרות אל ${email}. הוא בתוקף ל-10 דקות.`, devCode: r.devCode }
    } catch (e) {
      return { step: 'email', email, next, ok: false, message: heMessage(e) }
    }
  }
  const email = normalizeEmail(prev.email ?? '')
  const code = String(f.get('code') ?? '').replace(/\D/g, '')
  if (!email) return { step: 'email', next }
  if (code.length !== 6) return { ...prev, next, ok: false, message: 'הקוד הוא 6 ספרות.' }
  let dest = next
  try {
    const r = await verifyLoginCode(email, code)
    if (!r.ok) return { ...prev, next, ok: false, message: r.message }
    const v = await getStore().getVolunteerByEmail(email)
    if (v && v.status === 'active') {
      startSession(v)
      await getStore().touch(v.id).catch(() => undefined)
    } else if (v) {
      return { step: 'email', next, ok: false, message: v.status === 'deleted' ? 'החשבון הזה נמחק.' : 'החשבון שלך מושהה כרגע. לשאלות אפשר לפנות לצוות.' }
    } else {
      setPendingEmail(email)
      dest = `/join?next=${encodeURIComponent(next)}`
    }
  } catch (e) {
    return { ...prev, next, ok: false, message: heMessage(e) }
  }
  redirect(dest)
}
