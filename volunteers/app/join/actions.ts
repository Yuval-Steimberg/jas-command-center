'use server'

import { redirect } from 'next/navigation'
import { israeliMobile, isFullName, pickAreas, pickSkills, pickSlots, TRANSPORT, type Transport } from '@shared/volunteers/model'
import { welcomeMessage } from '@shared/volunteers/notify'
import { pendingEmail, safeNext, startSession } from '@/lib/session'
import { getStore } from '@/lib/store'
import { notify, notifyContext } from '@/lib/mail'
import { heMessage } from '@/lib/errors'
import type { State } from '@/app/actions'

/** Register the address that just proved itself with a code (the pending cookie), nothing else. */
export async function registerAction(_p: State, f: FormData): Promise<State> {
  const email = pendingEmail()
  if (!email) return { ok: false, message: 'פג הזמן לאימות. נא להיכנס שוב עם קוד חדש.' }
  const fullName = String(f.get('fullName') ?? '').trim().replace(/\s+/g, ' ')
  const phone = israeliMobile(String(f.get('phone') ?? ''))
  if (!isFullName(fullName)) return { ok: false, message: 'נא לכתוב שם פרטי ושם משפחה.' }
  if (!phone) return { ok: false, message: 'נא לכתוב מספר נייד ישראלי, למשל 050-123-4567. הוא נשאר אצל הצוות בלבד.' }
  if (f.get('age16') !== 'on') return { ok: false, message: 'ההתנדבות פתוחה מגיל 16. נא לאשר את הגיל.' }
  if (f.get('consent') !== 'on') return { ok: false, message: 'כדי להשתתף צריך להסכים לקבל אימיילים על המשמרות שנרשמת אליהן.' }
  const transport = (TRANSPORT as readonly string[]).includes(String(f.get('transport'))) ? (String(f.get('transport')) as Transport) : 'none'
  try {
    const store = getStore()
    const v = await store.register({
      fullName, email, phone, adult: f.get('adult') === 'on', areas: pickAreas(f.getAll('areas')), availability: pickSlots(f.getAll('availability')),
      skills: pickSkills(f.getAll('skills')), transport, about: String(f.get('about') ?? '').trim().slice(0, 500) || null,
      notifyReminders: f.get('notifyReminders') === 'on', notifyOpportunities: f.get('notifyOpportunities') === 'on', consentWhatsapp: f.get('consentWhatsapp') === 'on', source: 'app',
    })
    startSession(v)
    await notify([welcomeMessage(v, notifyContext())])
  } catch (e) {
    return { ok: false, message: heMessage(e) }
  }
  const next = safeNext(f.get('next'))
  redirect(next === '/' ? '/activities?welcome=1' : next)
}
