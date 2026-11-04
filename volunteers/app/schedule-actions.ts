'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isDate } from '@shared/volunteers/schedule'
import { scheduleErrorHe } from '@shared/volunteers/schedule-messages'
import { currentVolunteer } from '@/lib/session'
import { getScheduleStore } from '@/lib/schedule'

export type AbsenceState = { ok?: boolean; message?: string }

const id = z.string().min(1).max(64).regex(/^[\w-]+$/)

/**
 * "I will not come on this date": the one scheduling action a volunteer has.
 * Only for a date they are scheduled on (the database checks), only that date,
 * and it never touches their regular days. The scheduler sees it at once.
 */
export async function reportAbsenceAction(_p: AbsenceState, f: FormData): Promise<AbsenceState> {
  const v = await currentVolunteer()
  if (!v) redirect('/login')
  const slotId = id.safeParse(f.get('slotId'))
  const date = String(f.get('date') ?? '')
  if (!slotId.success || !isDate(date)) return { ok: false, message: 'התאריך לא מוכר. נא לרענן.' }
  const reason = String(f.get('reason') ?? '').trim().slice(0, 300) || null
  try {
    await getScheduleStore().absence(slotId.data, v.id, date, reason, 'volunteer')
  } catch (e) {
    return { ok: false, message: scheduleErrorHe(e) }
  }
  revalidatePath('/')
  redirect(`/?absent=${date}`)
}

/** Taking it back ("I can come after all"), before the day. */
export async function withdrawAbsenceAction(_p: AbsenceState, f: FormData): Promise<AbsenceState> {
  const v = await currentVolunteer()
  if (!v) redirect('/login')
  const absenceId = id.safeParse(f.get('absenceId'))
  if (!absenceId.success) return { ok: false, message: 'לא נמצא. נא לרענן.' }
  try {
    await getScheduleStore().withdrawAbsence(absenceId.data, 'volunteer', v.id)
  } catch (e) {
    return { ok: false, message: scheduleErrorHe(e) }
  }
  revalidatePath('/')
  redirect('/?back=1')
}
