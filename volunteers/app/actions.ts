'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { TRANSPORT, israeliMobile, isFullName, pickAreas, pickSkills, pickSlots, type Volunteer } from '@shared/volunteers/model'
import { signupMessage } from '@shared/volunteers/notify'
import { currentVolunteer, endSession } from '@/lib/session'
import { getStore } from '@/lib/store'
import { notify, notifyContext } from '@/lib/mail'
import { heMessage } from '@/lib/errors'

export type State = { ok?: boolean; message?: string }

const uuidish = z.string().min(1).max(64).regex(/^[\w-]+$/)

async function me(): Promise<Volunteer> {
  const v = await currentVolunteer()
  if (!v) redirect('/login')
  return v
}

const refresh = () => {
  for (const p of ['/', '/activities', '/my']) revalidatePath(p)
}

/**
 * Join a shift, or accept an invitation to it. Full shift → waitlist, said
 * plainly. On success the volunteer lands on the sign-up itself, because the
 * button they pressed is gone once they are signed up.
 */
export async function joinAction(_p: State, f: FormData): Promise<State> {
  const v = await me()
  const shiftId = uuidish.safeParse(f.get('shiftId'))
  if (!shiftId.success) return { ok: false, message: 'משמרת לא מוכרת.' }
  const store = getStore()
  let dest: string
  try {
    const before = (await store.listSignups({ shiftIds: [shiftId.data], volunteerId: v.id }))[0]
    const s = await store.join(shiftId.data, v.id, before?.status === 'invited' ? 'invite' : 'self', `volunteer:${v.id}`)
    const sh = (await store.getShift(s.shiftId))!
    const a = (await store.getActivity(sh.activityId))!
    if (before?.status !== s.status || before?.version !== s.version) await notify([signupMessage(s.status === 'waitlisted' ? 'waitlisted' : 'joined', v, s, sh, a, notifyContext())])
    refresh()
    dest = `/my/${s.id}?done=${s.status === 'waitlisted' ? 'waitlisted' : 'joined'}`
  } catch (e) {
    return { ok: false, message: heMessage(e) }
  }
  redirect(dest)
}

/** Cancel a sign-up (or decline an invitation). A freed place goes to the waitlist automatically. */
export async function leaveAction(_p: State, f: FormData): Promise<State> {
  const v = await me()
  const id = uuidish.safeParse(f.get('signupId'))
  if (!id.success) return { ok: false, message: 'הרשמה לא מוכרת.' }
  const decline = f.get('mode') === 'decline'
  const reason = String(f.get('reason') ?? '').trim().slice(0, 300) || null
  const store = getStore()
  try {
    const { promoted } = await store.leave(id.data, decline ? 'declined' : 'cancelled', reason, `volunteer:${v.id}`, v.id)
    if (promoted.length) {
      const sh = (await store.getShift(promoted[0]!.shiftId))!
      const a = (await store.getActivity(sh.activityId))!
      const people = await store.listVolunteers({ ids: promoted.map((p) => p.volunteerId) })
      await notify(promoted.map((p) => { const pv = people.find((x) => x.id === p.volunteerId); return pv ? signupMessage('promoted', pv, p, sh, a, notifyContext()) : null }))
    }
    refresh()
  } catch (e) {
    return { ok: false, message: heMessage(e) }
  }
  redirect(`/my/${id.data}?done=${decline ? 'declined' : 'cancelled'}`)
}

const profile = z.object({
  fullName: z.string().trim().refine(isFullName, 'נא לכתוב שם פרטי ושם משפחה.'),
  phone: z.string().trim().transform((p, ctx) => {
    const m = israeliMobile(p)
    if (!m) ctx.addIssue({ code: 'custom', message: 'נא לכתוב מספר נייד ישראלי, למשל 050-123-4567.' })
    return m ?? ''
  }),
  transport: z.enum(TRANSPORT),
  about: z.string().trim().max(500).transform((s) => s || null),
})

export async function updateProfileAction(_p: State, f: FormData): Promise<State> {
  const v = await me()
  const parsed = profile.safeParse({ fullName: f.get('fullName') ?? '', phone: f.get('phone') ?? '', transport: f.get('transport') ?? 'none', about: f.get('about') ?? '' })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'נא לבדוק את הפרטים.' }
  try {
    await getStore().updateVolunteer(v.id, {
      ...parsed.data,
      adult: f.get('adult') === 'on',
      areas: pickAreas(f.getAll('areas')),
      availability: pickSlots(f.getAll('availability')),
      skills: pickSkills(f.getAll('skills')),
      notifyReminders: f.get('notifyReminders') === 'on',
      notifyOpportunities: f.get('notifyOpportunities') === 'on',
      consentWhatsapp: f.get('consentWhatsapp') === 'on',
    })
    revalidatePath('/profile')
    revalidatePath('/')
    return { ok: true, message: 'הפרטים נשמרו.' }
  } catch (e) {
    return { ok: false, message: heMessage(e) }
  }
}

/** Delete my data. Asks for the word "מחיקה" so it cannot happen by a stray tap. */
export async function deleteAccountAction(_p: State, f: FormData): Promise<State> {
  const v = await me()
  if (String(f.get('confirm') ?? '').trim() !== 'מחיקה') return { ok: false, message: 'כדי למחוק, נא להקליד את המילה "מחיקה".' }
  try {
    await getStore().forget(v.id, `volunteer:${v.id}`)
  } catch (e) {
    return { ok: false, message: heMessage(e) }
  }
  endSession()
  redirect('/?deleted=1')
}

export async function signOutAction() {
  endSession()
  redirect('/')
}

export async function checkinAction(_p: State, f: FormData): Promise<State> {
  const v = await me()
  const shiftId = uuidish.safeParse(f.get('shiftId'))
  const code = z.string().min(8).max(64).regex(/^[\w-]+$/).safeParse(f.get('code'))
  if (!shiftId.success || !code.success) return { ok: false, message: 'הקוד לא תקין. נא לסרוק שוב את הקוד של המשמרת.' }
  const store = getStore()
  try {
    // Someone who came without signing up joins as a walk-in, but only with the
    // code that hangs at the activity, so the link alone cannot add anyone.
    const sh = await store.getShift(shiftId.data)
    if (!sh || sh.checkinCode !== code.data) return { ok: false, message: 'הקוד לא תקין. נא לסרוק שוב את הקוד של המשמרת.' }
    const mine = (await store.listSignups({ shiftIds: [sh.id], volunteerId: v.id }))[0]
    if (mine?.status !== 'confirmed') await store.join(sh.id, v.id, 'walk_in', `volunteer:${v.id}`)
    const s = await store.selfCheckin(shiftId.data, v.id, code.data)
    revalidatePath('/my')
    if (s.checkOutAt) return { ok: true, message: `נרשמה יציאה. תודה רבה על ההתנדבות היום.` }
    return { ok: true, message: 'נרשמה הגעה. כשמסיימים, אפשר לסרוק שוב כדי לרשום יציאה, או שהרכז/ת יסגור/תסגור את המשמרת.' }
  } catch (e) {
    return { ok: false, message: heMessage(e) }
  }
}

