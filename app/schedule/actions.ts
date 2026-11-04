'use server'

import { z } from 'zod'
import { act, type ActResult } from '@/lib/schedule/act'
import { isDate } from '@/lib/volunteers/schedule'

const id = z.string().min(1).max(64)
const date = z.string().refine(isDate, 'date')
const reason = z.string().trim().max(300).nullable().optional()
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()
const bad = { ok: false, message: 'הנתונים לא תקינים. נא לרענן ולנסות שוב.' } as const

export async function setRequiredAction(raw: { slotId: string; version: number; required: number | null }): Promise<ActResult> {
  const p = z.object({ slotId: id, version: z.number().int(), required: z.number().int().min(0).max(200).nullable() }).safeParse(raw)
  if (!p.success) return bad
  return act('required', `slot:${p.data.slotId}`, { required: p.data.required }, 'היעד נשמר.', (st) => st.updateSlot(p.data.slotId, p.data.version, { required: p.data.required }))
}

export async function setHoursAction(raw: { slotId: string; version: number; startsAt: string | null; endsAt: string | null }): Promise<ActResult> {
  const p = z.object({ slotId: id, version: z.number().int(), startsAt: time, endsAt: time }).safeParse(raw)
  if (!p.success) return { ok: false, message: 'שעה לא תקינה (למשל 09:00).' }
  return act('hours', `slot:${p.data.slotId}`, { startsAt: p.data.startsAt, endsAt: p.data.endsAt }, 'השעות נשמרו.', (st) => st.updateSlot(p.data.slotId, p.data.version, { startsAt: p.data.startsAt, endsAt: p.data.endsAt }))
}

export async function addRegularAction(raw: { slotId: string; volunteerId: string; from: string }): Promise<ActResult> {
  const p = z.object({ slotId: id, volunteerId: id, from: date }).safeParse(raw)
  if (!p.success) return bad
  return act('add_regular', `slot:${p.data.slotId}`, p.data, 'נוסף/ה לקבועים.', (st) => st.addRegular(p.data.slotId, p.data.volunteerId, p.data.from))
}

export async function endRegularAction(raw: { regularId: string; last: string }): Promise<ActResult> {
  const p = z.object({ regularId: id, last: date }).safeParse(raw)
  if (!p.success) return bad
  return act('end_regular', `regular:${p.data.regularId}`, p.data, 'הוסר/ה מהקבועים.', (st) => st.endRegular(p.data.regularId, p.data.last))
}

export async function markAbsentAction(raw: { slotId: string; volunteerId: string; date: string; reason?: string | null }): Promise<ActResult> {
  const p = z.object({ slotId: id, volunteerId: id, date, reason }).safeParse(raw)
  if (!p.success) return bad
  return act('absence', `slot:${p.data.slotId}:${p.data.date}`, p.data, 'נרשם שלא יגיע/תגיע.', (st) => st.absence(p.data.slotId, p.data.volunteerId, p.data.date, p.data.reason ?? null, 'admin'))
}

export async function withdrawAbsenceAction(raw: { absenceId: string }): Promise<ActResult> {
  const p = z.object({ absenceId: id }).safeParse(raw)
  if (!p.success) return bad
  return act('absence_withdraw', `absence:${p.data.absenceId}`, p.data, 'ההיעדרות בוטלה: מגיע/ה.', (st) => st.withdrawAbsence(p.data.absenceId, 'admin', null))
}

export async function assignAction(raw: { slotId: string; volunteerId: string; date: string; status: 'confirmed' | 'tentative'; replaces?: string | null }): Promise<ActResult> {
  const p = z.object({ slotId: id, volunteerId: id, date, status: z.enum(['confirmed', 'tentative']), replaces: id.nullable().optional() }).safeParse(raw)
  if (!p.success) return bad
  return act('assign', `slot:${p.data.slotId}:${p.data.date}`, p.data, p.data.status === 'confirmed' ? 'שובץ/ה.' : 'נרשם: ממתין לאישור.', (st) => st.assign(p.data.slotId, p.data.volunteerId, p.data.date, p.data.status, p.data.replaces ?? null, null))
}

export async function setAssignmentStatusAction(raw: { assignmentId: string; status: 'confirmed' | 'tentative' }): Promise<ActResult> {
  const p = z.object({ assignmentId: id, status: z.enum(['confirmed', 'tentative']) }).safeParse(raw)
  if (!p.success) return bad
  return act('assignment_status', `assignment:${p.data.assignmentId}`, p.data, p.data.status === 'confirmed' ? 'אושר/ה: מגיע/ה.' : 'סומן: ממתין לאישור.', (st) => st.setAssignmentStatus(p.data.assignmentId, p.data.status))
}

export async function cancelAssignmentAction(raw: { assignmentId: string }): Promise<ActResult> {
  const p = z.object({ assignmentId: id }).safeParse(raw)
  if (!p.success) return bad
  return act('assignment_cancel', `assignment:${p.data.assignmentId}`, p.data, 'השיבוץ בוטל.', (st) => st.cancelAssignment(p.data.assignmentId, null))
}

export async function setClosureAction(raw: { slotId: string; date: string; closed: boolean; reason?: string | null }): Promise<ActResult> {
  const p = z.object({ slotId: id, date, closed: z.boolean(), reason }).safeParse(raw)
  if (!p.success) return bad
  return act(p.data.closed ? 'close' : 'reopen', `slot:${p.data.slotId}:${p.data.date}`, p.data, p.data.closed ? 'היום סומן כסגור.' : 'היום נפתח מחדש.', (st) => st.setClosure(p.data.slotId, p.data.date, p.data.closed, p.data.reason ?? null))
}
