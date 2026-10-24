import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getVolunteerStore, notifyVolunteers, volunteerContext } from '@/lib/volunteer-store'
import { coordinatorMessage, signupMessage } from '@/lib/volunteers/notify'
import { LIVE } from '@/lib/volunteers/model'
import { israelTime } from '@/lib/volunteers/time'
import { volunteerRef } from './volunteer-tools'
import type { ProposalDef } from './proposals'

/**
 * Volunteer actions the assistant may propose. Same contract as proposals.ts:
 * prepare reads the shift and the volunteer and describes them from the
 * records; execute runs only on the person's Confirm and makes the same store
 * calls and emails as the shift page's Invite and Message buttons. The card is
 * also sent back to the model, so a volunteer is named by reference, never by
 * name. Nobody is ever placed on a shift from here: an invitation still needs
 * the volunteer's own yes.
 */
const str = (description: string) => ({ type: 'string' as const, description })
const staff = (email: string) => `staff:${email}`
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'short' })
const when = (startsAt: string, endsAt: string) => `${dayFmt.format(new Date(startsAt))} ${israelTime(startsAt)}–${israelTime(endsAt)}`

const inviteParams = z.object({ shiftId: z.string().uuid(), volunteerId: z.string().uuid() }).strict()
const messageParams = z.object({ shiftId: z.string().uuid(), text: z.string().trim().min(5).max(1000) }).strict()
const messageExec = messageParams.extend({ requestId: z.string().uuid() }).strict()

async function shiftAndActivity(shiftId: string) {
  const store = getVolunteerStore()
  const sh = await store.getShift(shiftId)
  const a = sh ? await store.getActivity(sh.activityId) : null
  return sh && a ? { sh, a } : null
}

export const VOLUNTEER_PROPOSALS: ProposalDef[] = [
  {
    kind: 'volunteer_invite',
    label: 'Invite a volunteer to a shift',
    description:
      'Propose inviting one volunteer to one upcoming shift. They get an email and accept or decline themselves; nobody is put on the shift. Get the shift id from get_volunteer_overview and the volunteer id from suggest_volunteers_for_shift. Nothing is sent until the user confirms.',
    product: 'volunteers',
    permissions: ['volunteers:operate'],
    params: inviteParams,
    schema: { type: 'object', properties: { shiftId: str('Shift id from get_volunteer_overview'), volunteerId: str('Volunteer id from suggest_volunteers_for_shift') }, required: ['shiftId', 'volunteerId'], additionalProperties: false },
    async prepare(raw) {
      const p = inviteParams.parse(raw)
      const store = getVolunteerStore()
      const [x, v, existing] = await Promise.all([shiftAndActivity(p.shiftId), store.getVolunteer(p.volunteerId), store.listSignups({ shiftIds: [p.shiftId], volunteerIds: [p.volunteerId] })])
      if (!x) return { ok: false, reason: 'No shift with that id.' }
      if (!v || v.status !== 'active') return { ok: false, reason: 'That volunteer does not exist or is not active.' }
      if (x.a.status !== 'published' || x.sh.status !== 'open') return { ok: false, reason: 'That shift is not open (its activity is not published, or it was cancelled).' }
      if (Date.parse(x.sh.startsAt) <= Date.now()) return { ok: false, reason: 'That shift has already started.' }
      const live = existing.find((s) => LIVE.includes(s.status))
      if (live) return { ok: false, reason: `${volunteerRef(v.id)} is already ${live.status} on that shift.` }
      return { ok: true, params: p, summary: `Invite ${volunteerRef(v.id)} to "${x.a.title}", ${when(x.sh.startsAt, x.sh.endsAt)}. They get an email and decide themselves.` }
    },
    async execute(raw, actor) {
      const p = inviteParams.parse(raw)
      const store = getVolunteerStore()
      const [x, v] = await Promise.all([shiftAndActivity(p.shiftId), store.getVolunteer(p.volunteerId)])
      if (!x || !v) return { ok: false, message: 'The shift or the volunteer no longer exists.' }
      const s = await store.invite(p.shiftId, p.volunteerId, staff(actor.email))
      if (s.status !== 'invited') return { ok: true, message: `${volunteerRef(v.id)} is already ${s.status} on this shift. Nothing was sent.` }
      const r = await notifyVolunteers([signupMessage('invited', v, s, x.sh, x.a, volunteerContext())])
      return { ok: true, message: `Invited ${volunteerRef(v.id)}.${r.warning ? ` ${r.warning}` : ''}` }
    },
  },
  {
    kind: 'volunteer_message_shift',
    label: 'Email the volunteers on a shift',
    description:
      'Propose emailing everyone confirmed on one shift (a change of meeting point, what to bring…). Plain text, up to 1000 characters, written as it should reach them (usually Hebrew). Respects quiet hours. Nothing is sent until the user confirms, and confirming twice does not send twice.',
    product: 'volunteers',
    permissions: ['volunteers:operate'],
    params: messageParams,
    schema: { type: 'object', properties: { shiftId: str('Shift id from get_volunteer_overview'), text: str('The message, exactly as volunteers should read it') }, required: ['shiftId', 'text'], additionalProperties: false },
    async prepare(raw) {
      const p = messageParams.parse(raw)
      const x = await shiftAndActivity(p.shiftId)
      if (!x) return { ok: false, reason: 'No shift with that id.' }
      if (Date.parse(x.sh.endsAt) <= Date.now()) return { ok: false, reason: 'That shift has already ended.' }
      const confirmed = await getVolunteerStore().listSignups({ shiftIds: [p.shiftId], statuses: ['confirmed'] })
      if (!confirmed.length) return { ok: false, reason: 'Nobody is confirmed on that shift yet.' }
      return { ok: true, params: { ...p, requestId: randomUUID() }, summary: `Email the ${confirmed.length} volunteer(s) confirmed on "${x.a.title}", ${when(x.sh.startsAt, x.sh.endsAt)}: "${p.text}"` }
    },
    async execute(raw) {
      const p = messageExec.parse(raw)
      const x = await shiftAndActivity(p.shiftId)
      if (!x) return { ok: false, message: 'This shift no longer exists.' }
      const store = getVolunteerStore()
      const signups = await store.listSignups({ shiftIds: [p.shiftId], statuses: ['confirmed'] })
      const people = signups.length ? await store.listVolunteers({ ids: signups.map((s) => s.volunteerId) }) : []
      const r = await notifyVolunteers(signups.map((s) => { const v = people.find((q) => q.id === s.volunteerId); return v ? coordinatorMessage(v, s, x.sh, x.a, p.text, p.requestId, volunteerContext()) : null }))
      return { ok: true, message: r.queued ? `Queued for ${r.queued} volunteer(s).${r.warning ? ` ${r.warning}` : ''}` : 'Nobody new to send to (already sent, or nobody is confirmed).' }
    },
  },
]

export const VOLUNTEER_EXEC_PARAMS: Record<string, z.ZodType<Record<string, unknown>>> = {
  volunteer_invite: inviteParams,
  volunteer_message_shift: messageExec,
}
