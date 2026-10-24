'use server'

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { runAct, formStr as str, type ActionState } from '@/lib/ops/act'
import { getVolunteerStore, notifyVolunteers, volunteerContext } from '@/lib/volunteer-store'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { AREAS, KINDS, httpsUrl, israeliMobile, isFullName, normalizeEmail, pickSkills, shiftProblem, type Activity, type ActivityInput, type Area, type Shift, type ShiftInput } from '@/lib/volunteers/model'
import { changeMessage, coordinatorMessage, opportunityRows, signupMessage } from '@/lib/volunteers/notify'
import { israelDay, israelTime, israelToUtc, shiftByDays } from '@/lib/volunteers/time'
import type { AttendanceOp } from '@/lib/volunteers/store'

const id = z.string().uuid()
const PATHS = ['/volunteers', '/volunteers/activities', '/volunteers/people', '/volunteers/calendar']
const actor = (email: string) => `staff:${email}`
const warn = (...w: (string | undefined)[]) => w.filter(Boolean).join(' ') || undefined

// ── Form parsing ───────────────────────────────────────────────────────────

/** The linked furniture project must be a real one: its id and name are read from the field app, never typed. */
async function projectOf(f: FormData): Promise<{ id: string | null; name: string | null } | string> {
  const raw = String(f.get('furnitureProjectId') ?? '').trim()
  if (!raw) return { id: null, name: null }
  const r = await getFurnitureProjects()
  if (r.state !== 'ok') return 'The furniture app cannot be read right now, so the project link cannot be checked. Save without it, or try again.'
  const p = r.data.find((x) => x.id === raw)
  return p ? { id: p.id, name: p.name } : 'That furniture project does not exist (any more).'
}

async function activityFields(f: FormData): Promise<ActivityInput | string> {
  const title = str(f, 'title', 140)
  if (!title) return 'Give the activity a title.'
  const kind = z.enum(KINDS).safeParse(f.get('kind'))
  if (!kind.success) return 'Pick the kind of activity.'
  const area = String(f.get('area') ?? '')
  const rawMap = str(f, 'mapUrl', 500)
  const mapUrl = httpsUrl(rawMap)
  if (rawMap && !mapUrl) return 'The map link must be an https:// address.'
  const photoLines = String(f.get('photoUrls') ?? '').split(/\s+/).filter(Boolean)
  const photoUrls = photoLines.map(httpsUrl)
  if (photoUrls.some((u) => !u)) return 'Each photo link must be a full https:// address (one per line).'
  if (photoUrls.length > 6) return 'Up to 6 photos per activity.'
  const closes = Number(f.get('signupClosesHours') ?? 0)
  if (!Number.isInteger(closes) || closes < 0 || closes > 168) return 'Sign-up closes between 0 and 168 hours before the shift.'
  const project = await projectOf(f)
  if (typeof project === 'string') return project
  const rawPhone = str(f, 'contactPhone', 40)
  const contactPhone = rawPhone ? israeliMobile(rawPhone) ?? rawPhone.replace(/[^\d+\-\s]/g, '').slice(0, 20) : null
  return {
    title,
    kind: kind.data,
    summary: str(f, 'summary', 300),
    description: str(f, 'description', 4000),
    furnitureProjectId: project.id,
    furnitureProjectName: project.name,
    locationName: str(f, 'locationName', 140),
    address: str(f, 'address', 200),
    area: (AREAS as readonly string[]).includes(area) ? (area as Area) : null,
    mapUrl,
    arrivalInfo: str(f, 'arrivalInfo', 1000),
    requirements: str(f, 'requirements', 1000),
    equipment: str(f, 'equipment', 1000),
    instructions: str(f, 'instructions', 2000),
    adultsOnly: f.get('adultsOnly') === 'on',
    requiredSkills: pickSkills(f.getAll('requiredSkills')),
    coordinatorName: str(f, 'coordinatorName', 80),
    contactPhone,
    photoUrls: photoUrls as string[],
    signupClosesHours: closes,
  }
}

/** Date + start/end (Israel wall time). An end earlier than the start runs past midnight. */
function shiftFields(f: FormData): ShiftInput | string {
  const day = String(f.get('date') ?? '')
  const startsAt = israelToUtc(day, String(f.get('start') ?? ''))
  let endsAt = israelToUtc(day, String(f.get('end') ?? ''))
  if (!startsAt || !endsAt) return 'Give the shift a valid date, start and end time.'
  if (endsAt <= startsAt) endsAt = shiftByDays(endsAt, 1)
  const s: ShiftInput = {
    label: str(f, 'label', 60),
    role: str(f, 'role', 60),
    startsAt,
    endsAt,
    capacity: Number(f.get('capacity')),
    minVolunteers: Number(f.get('minVolunteers') || 0),
  }
  return shiftProblem(s) ?? s
}

const weeks = (f: FormData) => Math.min(26, Math.max(0, Math.floor(Number(f.get('repeatWeeks') || 0)) || 0))

async function namesFor(ids: string[]) {
  return ids.length ? getVolunteerStore().listVolunteers({ ids }) : []
}

// ── Activities ─────────────────────────────────────────────────────────────

/** Create an activity with its first shift, repeated weekly at the same Israel time (DST-safe). */
export async function createActivityAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const input = await activityFields(f)
  if (typeof input === 'string') return { ok: false, message: input }
  const shift = shiftFields(f)
  if (typeof shift === 'string') return { ok: false, message: shift }
  const n = weeks(f)
  const publish = f.get('publish') === 'on'
  let goTo = ''
  const res = await runAct('volunteers', ['volunteers:write'], 'volunteers.activity_create', 'activity:new', { title: input.title, kind: input.kind, project: input.furnitureProjectId, shifts: n + 1, publish }, async (u) => {
    const store = getVolunteerStore()
    const a = await store.createActivity({ ...input, status: 'draft', seriesId: n ? randomUUID() : null }, actor(u.email))
    for (let i = 0; i <= n; i++) {
      await store.saveShift(a.id, null, null, { ...shift, startsAt: shiftByDays(shift.startsAt, 7 * i), endsAt: shiftByDays(shift.endsAt, 7 * i) }, actor(u.email))
    }
    goTo = a.id
    let warning: string | undefined
    if (publish) warning = (await publishAndAnnounce(a.id, 'draft')).warning
    return { ok: true, message: `Created "${a.title}" with ${n + 1} shift${n ? 's' : ''}${publish ? ' and published it' : ' as a draft'}.`, warning }
  }, PATHS)
  if (res.ok && goTo) redirect(`/volunteers/activities/${goTo}`)
  return res
}

export async function updateActivityAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const aid = id.safeParse(f.get('id'))
  const version = Number(f.get('version'))
  if (!aid.success || !Number.isInteger(version)) return { ok: false, message: 'Unknown activity.' }
  const input = await activityFields(f)
  if (typeof input === 'string') return { ok: false, message: input }
  return runAct('volunteers', ['volunteers:write'], 'volunteers.activity_update', `activity:${aid.data}`, { version }, async () => {
    const store = getVolunteerStore()
    const before = await store.getActivity(aid.data)
    if (!before) return { ok: false, message: 'This activity no longer exists.' }
    const a = await store.updateActivity(aid.data, version, input)
    // Volunteers already on a shift hear about a change to where, or what to bring.
    const moved = (['locationName', 'address', 'arrivalInfo', 'equipment', 'instructions'] as const).filter((k) => (before[k] ?? null) !== (a[k] ?? null))
    let warning: string | undefined
    if (moved.length && a.status === 'published') {
      const what = moved.includes('address') || moved.includes('locationName') ? 'המיקום עודכן' : 'פרטי ההגעה וההכנה עודכנו'
      warning = (await tellConfirmed(a, null, (v, s, sh) => changeMessage(v, s, sh, a, what, volunteerContext()))).warning
    }
    return { ok: true, message: moved.length && a.status === 'published' ? 'Saved. Volunteers on upcoming shifts were told what changed.' : 'Saved.', warning }
  }, [...PATHS, `/volunteers/activities/${aid.data}`])
}

/** Publish announces the activity to volunteers who opted in to opportunities in its area (once per 3 days each). */
async function publishAndAnnounce(activityId: string, from: Activity['status']) {
  const store = getVolunteerStore()
  const a = await store.setActivityStatus(activityId, from, 'published')
  const [shifts, people, recent] = await Promise.all([
    store.listShifts({ activityIds: [a.id], status: 'open' }),
    store.listVolunteers({ statuses: ['active'], limit: 5000 }),
    store.listOutbox({ since: new Date(Date.now() - 4 * 86_400_000).toISOString(), limit: 20_000 }),
  ])
  const rows = opportunityRows(a, shifts, people, recent, volunteerContext())
  const r = await notifyVolunteers(rows)
  return { a, announced: rows.length, warning: r.warning }
}

export async function activityStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const aid = id.safeParse(f.get('id'))
  const from = z.enum(['draft', 'published', 'completed', 'cancelled']).safeParse(f.get('from'))
  const to = z.enum(['draft', 'published', 'completed']).safeParse(f.get('to'))
  if (!aid.success || !from.success || !to.success) return { ok: false, message: 'Unknown change.' }
  return runAct('volunteers', ['volunteers:write'], `volunteers.activity_${to.data === 'published' ? 'publish' : to.data === 'draft' ? 'unpublish' : 'complete'}`, `activity:${aid.data}`, { from: from.data }, async () => {
    if (to.data === 'published') {
      const r = await publishAndAnnounce(aid.data, from.data)
      return { ok: true, message: `Published. ${r.announced ? `${r.announced} volunteer(s) who asked for new opportunities in this area will get an email.` : 'Nobody had asked to hear about new activities in this area.'}`, warning: r.warning }
    }
    await getVolunteerStore().setActivityStatus(aid.data, from.data, to.data)
    return { ok: true, message: to.data === 'draft' ? 'Back to draft: hidden from volunteers. Existing sign-ups are kept.' : 'Marked completed.' }
  }, [...PATHS, `/volunteers/activities/${aid.data}`])
}

/** Cancel a whole activity or one shift. Everyone affected is told, with the reason. */
export async function cancelAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const aid = id.safeParse(f.get('activityId'))
  const sid = f.get('shiftId') ? id.safeParse(f.get('shiftId')) : null
  const reason = str(f, 'reason', 300)
  if (!aid.success || (sid && !sid.success)) return { ok: false, message: 'Unknown activity.' }
  if (!reason) return { ok: false, message: 'Give a reason: it goes to the volunteers in the cancellation email.' }
  const shiftId = sid?.success ? sid.data : null
  return runAct('volunteers', ['volunteers:write'], shiftId ? 'volunteers.shift_cancel' : 'volunteers.activity_cancel', shiftId ? `shift:${shiftId}` : `activity:${aid.data}`, { reason }, async (u) => {
    const store = getVolunteerStore()
    const cancelled = await store.cancel(aid.data, shiftId, reason, actor(u.email))
    const a = (await store.getActivity(aid.data))!
    const shifts = cancelled.length ? await store.listShifts({ ids: [...new Set(cancelled.map((s) => s.shiftId))] }) : []
    const people = await namesFor([...new Set(cancelled.map((s) => s.volunteerId))])
    const r = await notifyVolunteers(cancelled.map((s) => {
      const v = people.find((p) => p.id === s.volunteerId)
      const sh = shifts.find((x) => x.id === s.shiftId)
      return v && sh ? signupMessage('cancelled_by_team', v, s, sh, a, volunteerContext(), reason) : null
    }))
    return { ok: true, message: `${shiftId ? 'Shift' : 'Activity'} cancelled. ${cancelled.length} volunteer(s) were signed up and are being told.`, warning: r.warning }
  }, [...PATHS, `/volunteers/activities/${aid.data}`])
}

/** Copy an activity (as a draft) with all its shifts moved to start on a new date, same times of day. */
export async function duplicateAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const aid = id.safeParse(f.get('id'))
  const date = String(f.get('date') ?? '')
  if (!aid.success) return { ok: false, message: 'Unknown activity.' }
  if (!israelToUtc(date, '12:00')) return { ok: false, message: 'Pick the date of the first shift of the copy.' }
  let goTo = ''
  const res = await runAct('volunteers', ['volunteers:write'], 'volunteers.activity_duplicate', `activity:${aid.data}`, { date }, async (u) => {
    const store = getVolunteerStore()
    const a = await store.getActivity(aid.data)
    if (!a) return { ok: false, message: 'This activity no longer exists.' }
    const shifts = (await store.listShifts({ activityIds: [a.id] })).filter((s) => s.status === 'open').sort((x, y) => x.startsAt.localeCompare(y.startsAt))
    if (!shifts.length) return { ok: false, message: 'This activity has no open shifts to copy.' }
    const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${israelDay(shifts[0]!.startsAt)}T12:00:00Z`)) / 86_400_000)
    const { id: _id, status: _s, version: _v, createdAt: _c, updatedAt: _up, createdBy: _b, cancelReason: _r, cancelledAt: _ca, ...rest } = a
    const copy = await store.createActivity({ ...rest, status: 'draft', seriesId: null }, actor(u.email))
    for (const s of shifts) await store.saveShift(copy.id, null, null, { label: s.label, role: s.role, startsAt: shiftByDays(s.startsAt, days), endsAt: shiftByDays(s.endsAt, days), capacity: s.capacity, minVolunteers: s.minVolunteers }, actor(u.email))
    goTo = copy.id
    return { ok: true, message: `Copied as a draft with ${shifts.length} shift(s).` }
  }, PATHS)
  if (res.ok && goTo) redirect(`/volunteers/activities/${goTo}`)
  return res
}

// ── Shifts ─────────────────────────────────────────────────────────────────

/** Add shifts (optionally weekly), or edit one. A capacity raise promotes the waitlist; a time change tells everyone on it. */
export async function saveShiftAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const aid = id.safeParse(f.get('activityId'))
  const sid = f.get('id') ? id.safeParse(f.get('id')) : null
  if (!aid.success || (sid && !sid.success)) return { ok: false, message: 'Unknown shift.' }
  const input = shiftFields(f)
  if (typeof input === 'string') return { ok: false, message: input }
  const editId = sid?.success ? sid.data : null
  const version = editId ? Number(f.get('version')) : null
  const n = editId ? 0 : weeks(f)
  return runAct('volunteers', ['volunteers:write'], editId ? 'volunteers.shift_update' : 'volunteers.shift_create', editId ? `shift:${editId}` : `activity:${aid.data}`, { startsAt: input.startsAt, capacity: input.capacity, repeatWeeks: n }, async (u) => {
    const store = getVolunteerStore()
    const before = editId ? await store.getShift(editId) : null
    const promoted: import('@/lib/volunteers/model').Signup[] = []
    let last: Shift | null = null
    for (let i = 0; i <= n; i++) {
      const r = await store.saveShift(aid.data, editId, version, { ...input, startsAt: shiftByDays(input.startsAt, 7 * i), endsAt: shiftByDays(input.endsAt, 7 * i) }, actor(u.email))
      promoted.push(...r.promoted)
      last = r.shift
    }
    const a = (await store.getActivity(aid.data))!
    const warnings: (string | undefined)[] = []
    if (promoted.length && last) {
      const people = await namesFor(promoted.map((p) => p.volunteerId))
      warnings.push((await notifyVolunteers(promoted.map((p) => { const v = people.find((x) => x.id === p.volunteerId); return v ? signupMessage('promoted', v, p, last!, a, volunteerContext()) : null }))).warning)
    }
    if (before && last && (before.startsAt !== last.startsAt || before.endsAt !== last.endsAt) && a.status === 'published') {
      warnings.push((await tellConfirmed(a, last, (v, s, sh) => changeMessage(v, s, sh, a, `השעה עודכנה ל-${israelTime(sh.startsAt)}–${israelTime(sh.endsAt)}`, volunteerContext()))).warning)
    }
    const msg = editId ? 'Shift saved.' : `Added ${n + 1} shift${n ? 's' : ''}.`
    return { ok: true, message: `${msg}${promoted.length ? ` ${promoted.length} waitlisted volunteer(s) moved up and are being told.` : ''}`, warning: warn(...warnings) }
  }, [...PATHS, `/volunteers/activities/${aid.data}`, ...(editId ? [`/volunteers/shifts/${editId}`] : [])])
}

/** Send one message to every confirmed volunteer of an activity (shift null) or of one shift. */
async function tellConfirmed(a: Activity, shift: Shift | null, build: (v: import('@/lib/volunteers/model').Volunteer, s: import('@/lib/volunteers/model').Signup, sh: Shift) => ReturnType<typeof changeMessage>) {
  const store = getVolunteerStore()
  const shifts = shift ? [shift] : (await store.listShifts({ activityIds: [a.id], status: 'open', from: new Date().toISOString() }))
  if (!shifts.length) return { queued: 0 }
  const signups = await store.listSignups({ shiftIds: shifts.map((s) => s.id), statuses: ['confirmed'] })
  const people = await namesFor([...new Set(signups.map((s) => s.volunteerId))])
  return notifyVolunteers(signups.map((s) => {
    const v = people.find((p) => p.id === s.volunteerId)
    const sh = shifts.find((x) => x.id === s.shiftId)
    return v && sh ? build(v, s, sh) : null
  }))
}

// ── People on shifts ───────────────────────────────────────────────────────

async function shiftAndActivity(shiftId: string) {
  const store = getVolunteerStore()
  const sh = await store.getShift(shiftId)
  const a = sh ? await store.getActivity(sh.activityId) : null
  return sh && a ? { sh, a } : null
}

/** Invite: the volunteer is asked and decides. Nobody is put on a shift by a recommendation. */
export async function inviteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sid = id.safeParse(f.get('shiftId'))
  const vid = id.safeParse(f.get('volunteerId'))
  if (!sid.success || !vid.success) return { ok: false, message: 'Unknown shift or volunteer.' }
  return runAct('volunteers', ['volunteers:operate'], 'volunteers.invite', `shift:${sid.data}`, { volunteer: vid.data }, async (u) => {
    const store = getVolunteerStore()
    const x = await shiftAndActivity(sid.data)
    const v = await store.getVolunteer(vid.data)
    if (!x || !v) return { ok: false, message: 'The shift or the volunteer no longer exists.' }
    const s = await store.invite(sid.data, vid.data, actor(u.email))
    const r = s.status === 'invited' ? await notifyVolunteers([signupMessage('invited', v, s, x.sh, x.a, volunteerContext())]) : { warning: undefined }
    return { ok: true, message: s.status === 'invited' ? `Invited ${v.fullName}. They decide in the app or from the email.` : `${v.fullName} is already ${s.status} on this shift.`, warning: r.warning }
  }, [...PATHS, `/volunteers/shifts/${sid.data}`])
}

/**
 * Put a volunteer on a shift directly (they agreed by phone, or turned up).
 * The same rules as a self sign-up apply except capacity for a walk-in; a
 * full shift refuses rather than waitlisting someone staff meant to place.
 */
export async function assignAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sid = id.safeParse(f.get('shiftId'))
  const vid = id.safeParse(f.get('volunteerId'))
  const walkIn = f.get('walkIn') === 'on'
  if (!sid.success || !vid.success) return { ok: false, message: 'Pick a volunteer.' }
  return runAct('volunteers', ['volunteers:operate'], walkIn ? 'volunteers.walk_in' : 'volunteers.assign', `shift:${sid.data}`, { volunteer: vid.data }, async (u) => {
    const store = getVolunteerStore()
    const x = await shiftAndActivity(sid.data)
    const v = await store.getVolunteer(vid.data)
    if (!x || !v) return { ok: false, message: 'The shift or the volunteer no longer exists.' }
    if (!walkIn && Date.parse(x.sh.startsAt) <= Date.now()) return { ok: false, message: 'This shift has already started. To add someone who is here, tick "Walk-in".' }
    const s = await store.join(sid.data, vid.data, walkIn ? 'walk_in' : 'staff', actor(u.email))
    const r = walkIn ? { warning: undefined } : await notifyVolunteers([signupMessage('joined', v, s, x.sh, x.a, volunteerContext())])
    return { ok: true, message: walkIn ? `${v.fullName} added as a walk-in.` : `${v.fullName} is on the shift and gets a confirmation email.`, warning: r.warning }
  }, [...PATHS, `/volunteers/shifts/${sid.data}`])
}

/** Remove someone from a shift (or withdraw an invitation). The freed place goes to the waitlist, in order. */
export async function removeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sgid = id.safeParse(f.get('signupId'))
  const reason = str(f, 'reason', 300)
  const silent = f.get('silent') === 'on'
  if (!sgid.success) return { ok: false, message: 'Unknown sign-up.' }
  return runAct('volunteers', ['volunteers:operate'], 'volunteers.remove', `signup:${sgid.data}`, { reason, silent }, async (u) => {
    const store = getVolunteerStore()
    const { signup, promoted } = await store.leave(sgid.data, 'removed', reason, actor(u.email), null)
    const x = (await shiftAndActivity(signup.shiftId))!
    const people = await namesFor([signup.volunteerId, ...promoted.map((p) => p.volunteerId)])
    const v = people.find((p) => p.id === signup.volunteerId)
    const r = await notifyVolunteers([
      v && !silent ? signupMessage('removed', v, signup, x.sh, x.a, volunteerContext(), reason) : null,
      ...promoted.map((p) => { const pv = people.find((y) => y.id === p.volunteerId); return pv ? signupMessage('promoted', pv, p, x.sh, x.a, volunteerContext()) : null }),
    ])
    return { ok: true, message: `Removed.${promoted.length ? ` The place went to the next on the waitlist.` : ''}`, warning: r.warning }
  }, [...PATHS, `/volunteers/shifts/${signupShiftPath(f)}`])
}

const signupShiftPath = (f: FormData) => String(f.get('shiftId') ?? '')

const OPS = ['check_in', 'check_out', 'full_shift', 'absent', 'excused', 'correct', 'reset'] as const

/** Attendance. Hours come only from here: a sign-up alone is never counted as hours. */
export async function attendanceAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sgid = id.safeParse(f.get('signupId'))
  const op = z.enum(OPS).safeParse(f.get('op'))
  const version = f.get('version') ? Number(f.get('version')) : null
  if (!sgid.success || !op.success) return { ok: false, message: 'Unknown attendance change.' }
  const note = str(f, 'note', 300)
  let at: { in?: string | null; out?: string | null } = {}
  if (op.data === 'correct') {
    const day = String(f.get('date') ?? '')
    const i = israelToUtc(day, String(f.get('in') ?? ''))
    let o = israelToUtc(day, String(f.get('out') ?? ''))
    if (!i || !o) return { ok: false, message: 'Give the arrival and leaving times.' }
    if (o <= i) o = shiftByDays(o, 1)
    if (!note) return { ok: false, message: 'A correction needs a note saying why.' }
    if (Date.parse(o) > Date.now() + 10 * 60_000) return { ok: false, message: 'The leaving time is in the future. Record it once they have left.' }
    at = { in: i, out: o }
  }
  return runAct('volunteers', ['volunteers:operate'], `volunteers.attendance_${op.data}`, `signup:${sgid.data}`, { ...at, note }, async (u) => {
    const s = await getVolunteerStore().attendance(sgid.data, op.data as AttendanceOp, at, note, actor(u.email), version)
    return { ok: true, message: s.minutes != null ? `Recorded: ${Math.floor(s.minutes / 60)}h ${String(s.minutes % 60).padStart(2, '0')}m.` : 'Recorded.' }
  }, [...PATHS, `/volunteers/shifts/${signupShiftPath(f)}`])
}

/** A coordinator's email to everyone confirmed on a shift. One request id per page load: a double submit sends once. */
export async function messageShiftAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sid = id.safeParse(f.get('shiftId'))
  const requestId = id.safeParse(f.get('requestId'))
  const text = str(f, 'text', 2000)
  if (!sid.success || !requestId.success) return { ok: false, message: 'Unknown shift.' }
  if (!text || text.length < 5) return { ok: false, message: 'Write the message first.' }
  return runAct('volunteers', ['volunteers:operate'], 'volunteers.message', `shift:${sid.data}`, { requestId: requestId.data, length: text.length }, async () => {
    const x = await shiftAndActivity(sid.data)
    if (!x) return { ok: false, message: 'This shift no longer exists.' }
    const r = await tellConfirmed(x.a, x.sh, (v, s, sh) => coordinatorMessage(v, s, sh, x.a, text, requestId.data, volunteerContext()))
    return { ok: true, message: r.queued ? `Queued for ${r.queued} volunteer(s).` : 'Nobody new to send to (already sent with this form, or nobody is confirmed).', warning: r.warning }
  }, [`/volunteers/shifts/${sid.data}`])
}

// ── Volunteers ─────────────────────────────────────────────────────────────

/**
 * Register someone who signed up by phone, on paper or at the store. They can
 * sign in to the app later with the same email. Only messages about their own
 * shifts are sent: reminders and opportunity emails need their own opt-in.
 */
export async function addVolunteerAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const fullName = String(f.get('fullName') ?? '').trim()
  const email = normalizeEmail(String(f.get('email') ?? ''))
  const phone = israeliMobile(String(f.get('phone') ?? ''))
  if (!isFullName(fullName)) return { ok: false, message: 'Write a first and last name.' }
  if (!email) return { ok: false, message: 'An email address is required: it is how they sign in and hear about their shifts.' }
  if (!phone) return { ok: false, message: 'Give an Israeli mobile number, e.g. 050-123-4567.' }
  if (f.get('agreed') !== 'on') return { ok: false, message: 'Confirm the person agreed to be registered and is 16 or older.' }
  let goTo = ''
  const res = await runAct('volunteers', ['volunteers:write'], 'volunteers.register', 'volunteer:new', { source: 'staff' }, async (u) => {
    const v = await getVolunteerStore().register({
      fullName, email, phone, adult: f.get('adult') === 'on', areas: [], availability: [], skills: [], transport: 'none', about: str(f, 'about', 500),
      notifyReminders: false, notifyOpportunities: false, consentWhatsapp: false, source: 'staff', actor: actor(u.email),
    })
    goTo = v.id
    return { ok: true, message: `Registered ${v.fullName}.` }
  }, PATHS)
  if (res.ok && goTo) redirect(`/volunteers/people/${goTo}`)
  return res
}

export async function volunteerStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const vid = id.safeParse(f.get('id'))
  const status = z.enum(['active', 'paused', 'blocked']).safeParse(f.get('status'))
  const reason = str(f, 'reason', 300)
  if (!vid.success || !status.success) return { ok: false, message: 'Unknown change.' }
  if (status.data === 'blocked' && !reason) return { ok: false, message: 'Blocking needs a reason (kept in the audit log and the notes).' }
  return runAct('volunteers', ['volunteers:write'], `volunteers.status_${status.data}`, `volunteer:${vid.data}`, { reason }, async (u) => {
    const store = getVolunteerStore()
    await store.setVolunteerStatus(vid.data, status.data, actor(u.email))
    if (reason) await store.addNote(vid.data, `${status.data === 'blocked' ? 'Blocked' : status.data === 'paused' ? 'Paused' : 'Reactivated'}: ${reason}`, u.email)
    return { ok: true, message: status.data === 'active' ? 'Active again.' : `${status.data === 'blocked' ? 'Blocked' : 'Paused'}: signed out of the app, cannot sign up, and gets no emails.` }
  }, [...PATHS, `/volunteers/people/${vid.data}`])
}

export async function addNoteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const vid = id.safeParse(f.get('id'))
  const body = str(f, 'body', 2000)
  if (!vid.success || !body) return { ok: false, message: 'Write the note first.' }
  return runAct('volunteers', ['volunteers:operate'], 'volunteers.note', `volunteer:${vid.data}`, { length: body.length }, async (u) => {
    await getVolunteerStore().addNote(vid.data, body, u.email)
    return { ok: true, message: 'Note added. Volunteers never see notes.' }
  }, [`/volunteers/people/${vid.data}`])
}

/** Erase a volunteer's personal data on request. Their recorded hours stay as anonymous numbers. */
export async function forgetVolunteerAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const vid = id.safeParse(f.get('id'))
  if (!vid.success) return { ok: false, message: 'Unknown volunteer.' }
  if (String(f.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') return { ok: false, message: 'Type DELETE to confirm.' }
  const res = await runAct('volunteers', ['volunteers:write', 'volunteers:read_pii'], 'volunteers.forget', `volunteer:${vid.data}`, {}, async (u) => {
    await getVolunteerStore().forget(vid.data, actor(u.email))
    return { ok: true, message: 'Personal data erased and future sign-ups cancelled.' }
  }, PATHS)
  if (res.ok) redirect('/volunteers/people')
  return res
}
