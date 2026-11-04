'use server'

import { z } from 'zod'
import { afterQuietHours } from '@/lib/volunteers/time'
import { isDate, plusDays, weekdayOf } from '@/lib/volunteers/schedule'
import { reminderEmail, reminderRecipients } from '@/lib/volunteers/schedule-reminder'
import { currentScheduler } from '@/lib/schedule/store'
import { act, type ActResult } from '@/lib/schedule/act'
import { getVolunteerStore, notifyVolunteers, volunteerContext } from '@/lib/volunteer-store'
import { israelDate } from '@/lib/time'

const week = z.string().refine((w) => isDate(w) && weekdayOf(w) === 0, 'week')

/**
 * The weekly "can't come? tell us" email, pressed by the scheduler. The
 * database first records the send (and refuses anyone who does not schedule
 * this place); then one email per volunteer for that week goes into the
 * outbox, whose dedupe key makes a second press send nothing new.
 */
export async function sendReminderEmailsAction(raw: { week: string }): Promise<ActResult> {
  const p = z.object({ week }).safeParse(raw)
  if (!p.success) return { ok: false, message: 'שבוע לא תקין. נא לרענן.' }
  const s = await currentScheduler()
  if ('error' in s) return { ok: false, message: 'אין לך גישה ללוח.' }
  const today = israelDate()
  const data = await s.store.load(s.location.id, p.data.week, plusDays(p.data.week, 6))
  const recipients = reminderRecipients(data, p.data.week, today)
  if (!recipients.length) return { ok: false, message: 'אין מתנדבים משובצים בשבוע הזה, אז אין למי לשלוח.' }
  const vols = new Map((await getVolunteerStore().listVolunteers({ ids: recipients.map((r) => r.volunteerId), statuses: ['active'], limit: 5000 })).map((v) => [v.id, v]))
  const ctx = volunteerContext()
  const notBefore = new Date(afterQuietHours(Date.now())).toISOString()
  const rows = recipients.flatMap((r) => {
    const v = vols.get(r.volunteerId)
    if (!v || !v.notifyReminders) return []
    const row = reminderEmail(v, r, { locationId: s.location.id, locationName: s.location.name, week: p.data.week, appUrl: ctx.appUrl, notBefore })
    return row ? [row] : []
  })
  const skipped = recipients.length - rows.length
  if (!rows.length) return { ok: false, message: `לאף אחד מ-${recipients.length} המשובצים אין מייל שאפשר לשלוח אליו. אפשר לשלוח בוואטסאפ.` }
  let queued = 0
  let warning: string | undefined
  const res = await act('reminder_email', `week:${p.data.week}`, { week: p.data.week, emails: rows.length, skipped }, '', async (st) => {
    await st.logReminder(s.location.id, p.data.week, 'email', rows.length)
    const r = await notifyVolunteers(rows)
    queued = r.queued
    warning = r.warning
  })
  if (!res.ok) return res
  const repeat = rows.length - queued
  return {
    ok: true,
    message: [
      queued ? `נשלחו ${queued} מיילים.` : 'כל המשובצים כבר קיבלו את התזכורת לשבוע הזה; לא נשלח שוב.',
      queued && repeat ? `${repeat} כבר קיבלו קודם ולא קיבלו שוב.` : null,
      skipped ? `${skipped} בלי מייל או שביקשו לא לקבל תזכורות: כדאי לשלוח להם בוואטסאפ.` : null,
      warning ?? null,
    ].filter(Boolean).join(' '),
  }
}

/** Records that the scheduler opened WhatsApp with the reminder (we cannot know it was sent: the sending is hers). */
export async function logWhatsappReminderAction(raw: { week: string; recipients: number }): Promise<ActResult> {
  const p = z.object({ week, recipients: z.number().int().min(0).max(5000) }).safeParse(raw)
  if (!p.success) return { ok: false, message: 'שבוע לא תקין.' }
  const s = await currentScheduler()
  if ('error' in s) return { ok: false, message: 'אין לך גישה ללוח.' }
  return act('reminder_whatsapp', `week:${p.data.week}`, p.data, 'נרשם ביומן התזכורות.', (st) => st.logReminder(s.location.id, p.data.week, 'whatsapp', p.data.recipients))
}
