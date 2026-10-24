/**
 * JAS Volunteers persistence. One interface, two implementations with the same
 * semantics: Supabase (production; every rule in the 0005 SQL functions) and
 * memory (local development and tests; the same rules, with no await between
 * a check and its write, so concurrent callers serialise like a row lock).
 *
 * Shared by the Command Center and the volunteer app: relative imports only.
 */
import { ConflictError, OpsSetupError } from '../ops/store'
import type {
  Activity, ActivityInput, ActivityStatus, OutboxRow, ProfilePatch, RegistrationInput, Shift, ShiftInput, Signup, SignupStatus, VolEvent, VolNote, Volunteer, VolunteerStatus,
} from './model'
import { LIVE } from './model'
import { overlaps } from './rules'

export { ConflictError, OpsSetupError }

/** Migration 0005 has not been run. */
export const volunteersSetup = () => new OpsSetupError('0005_volunteers.sql', 'The volunteer tables')

export type AttendanceOp = 'check_in' | 'check_out' | 'full_shift' | 'absent' | 'excused' | 'correct' | 'reset'
export type JoinSource = Signup['source']

export interface VolunteerFilter {
  q?: string
  statuses?: readonly VolunteerStatus[]
  ids?: readonly string[]
  contactIds?: readonly string[]
  limit?: number
}
export interface ActivityFilter {
  statuses?: readonly ActivityStatus[]
  ids?: readonly string[]
  projectId?: string
  limit?: number
}
export interface ShiftFilter {
  activityIds?: readonly string[]
  ids?: readonly string[]
  /** Shifts that end after `from` and start before `to` (ISO instants). */
  from?: string
  to?: string
  status?: Shift['status']
  limit?: number
}
export interface SignupFilter {
  shiftIds?: readonly string[]
  volunteerId?: string
  volunteerIds?: readonly string[]
  ids?: readonly string[]
  statuses?: readonly SignupStatus[]
  limit?: number
}
export type NewOutbox = Pick<OutboxRow, 'volunteerId' | 'toEmail' | 'kind' | 'dedupeKey' | 'subject' | 'body'> & { notBefore?: string }

export interface VolunteerStore {
  readonly kind: 'memory' | 'supabase'

  register(input: RegistrationInput): Promise<Volunteer>
  getVolunteer(id: string): Promise<Volunteer | null>
  getVolunteerByEmail(email: string): Promise<Volunteer | null>
  listVolunteers(f?: VolunteerFilter): Promise<Volunteer[]>
  updateVolunteer(id: string, patch: ProfilePatch): Promise<Volunteer>
  /** Blocking or pausing also signs the volunteer out everywhere. */
  setVolunteerStatus(id: string, status: Exclude<VolunteerStatus, 'deleted'>, actor: string): Promise<Volunteer>
  /** Delete personal data: anonymise, cancel future sign-ups, unlink the contact. */
  forget(id: string, actor: string): Promise<Volunteer>
  touch(id: string): Promise<void>
  listNotes(volunteerId: string): Promise<VolNote[]>
  addNote(volunteerId: string, body: string, authorEmail: string): Promise<VolNote>

  listActivities(f?: ActivityFilter): Promise<Activity[]>
  getActivity(id: string): Promise<Activity | null>
  createActivity(input: ActivityInput, actor: string): Promise<Activity>
  /** Conditional on the version; a stale edit is a ConflictError. */
  updateActivity(id: string, expectVersion: number, patch: Partial<ActivityInput>): Promise<Activity>
  /** draft ⇄ published, published → completed. Conditional on `from`. */
  setActivityStatus(id: string, from: ActivityStatus, to: 'draft' | 'published' | 'completed'): Promise<Activity>
  /** Cancel one shift, or (shiftId null) the whole activity. Returns the sign-ups that were cancelled. */
  cancel(activityId: string, shiftId: string | null, reason: string | null, actor: string): Promise<Signup[]>

  listShifts(f?: ShiftFilter): Promise<Shift[]>
  getShift(id: string): Promise<Shift | null>
  saveShift(activityId: string, id: string | null, expectVersion: number | null, input: ShiftInput, actor: string): Promise<{ shift: Shift; promoted: Signup[] }>

  listSignups(f?: SignupFilter): Promise<Signup[]>
  getSignup(id: string): Promise<Signup | null>
  join(shiftId: string, volunteerId: string, source: JoinSource, actor: string): Promise<Signup>
  invite(shiftId: string, volunteerId: string, actor: string): Promise<Signup>
  /** The changed sign-up, and whoever the freed place went to. `volunteerId` = the volunteer acting on their own sign-up. */
  leave(signupId: string, status: 'cancelled' | 'declined' | 'removed', reason: string | null, actor: string, volunteerId: string | null): Promise<{ signup: Signup; promoted: Signup[] }>
  attendance(signupId: string, op: AttendanceOp, at: { in?: string | null; out?: string | null }, note: string | null, actor: string, expectVersion: number | null): Promise<Signup>
  selfCheckin(shiftId: string, volunteerId: string, code: string): Promise<Signup>

  listEvents(f: { volunteerId?: string; signupIds?: readonly string[]; shiftIds?: readonly string[]; since?: string; limit?: number }): Promise<VolEvent[]>

  /** Rows whose dedupeKey already exists are skipped. Returns the rows actually added. */
  enqueue(rows: NewOutbox[]): Promise<OutboxRow[]>
  claimOutbox(limit: number): Promise<OutboxRow[]>
  markOutbox(id: string, status: 'sent' | 'failed' | 'skipped', error?: string | null): Promise<void>
  listOutbox(f: { volunteerId?: string; statuses?: readonly OutboxRow['status'][]; since?: string; limit?: number }): Promise<OutboxRow[]>

  addLoginCode(email: string, codeHash: string, expiresAt: string): Promise<void>
  countLoginCodes(email: string, since: string): Promise<number>
  latestLoginCode(email: string): Promise<{ id: string; codeHash: string; expiresAt: string; attempts: number; consumedAt: string | null } | null>
  /** Counts a wrong guess. */
  failLoginCode(id: string): Promise<void>
  /** True once: a code can be used a single time. */
  consumeLoginCode(id: string): Promise<boolean>
}

// ── Memory ─────────────────────────────────────────────────────────────────

export interface MemoryVolData {
  volunteers: Volunteer[]
  notes: VolNote[]
  activities: Activity[]
  shifts: Shift[]
  signups: Signup[]
  events: VolEvent[]
  outbox: OutboxRow[]
  codes: { id: string; email: string; codeHash: string; expiresAt: string; attempts: number; consumedAt: string | null; createdAt: string }[]
  /** CRM contacts the memory store links to (role 'volunteer'), mirrored minimally. */
  contacts: { id: string; email: string | null; phone: string | null; fullName: string; roles: string[] }[]
}

export const emptyVolData = (): MemoryVolData => ({ volunteers: [], notes: [], activities: [], shifts: [], signups: [], events: [], outbox: [], codes: [], contacts: [] })

const uid = () => crypto.randomUUID()
const copy = <T>(x: T): T => structuredClone(x)
const H = 3_600_000

export function memoryVolunteerStore(d: MemoryVolData, clock: () => number = Date.now): VolunteerStore {
  const iso = () => new Date(clock()).toISOString()
  const event = (e: Omit<VolEvent, 'id' | 'at' | 'detail'> & { detail?: Record<string, unknown> }) => d.events.push({ id: uid(), at: iso(), detail: {}, ...e })
  const confirmedOn = (shiftId: string) => d.signups.filter((s) => s.shiftId === shiftId && s.status === 'confirmed').length
  const mustVol = (id: string) => {
    const v = d.volunteers.find((x) => x.id === id)
    if (!v) throw new ConflictError('volunteer not found')
    return v
  }
  const mustShift = (id: string) => {
    const s = d.shifts.find((x) => x.id === id)
    if (!s) throw new ConflictError('shift not found')
    return s
  }
  const activityOf = (sh: Shift) => d.activities.find((a) => a.id === sh.activityId)!
  const touchSignup = (s: Signup, patch: Partial<Signup>) => Object.assign(s, patch, { version: s.version + 1, updatedAt: iso() })

  function promote(shiftId: string, actor: string): Signup[] {
    const sh = mustShift(shiftId)
    const a = activityOf(sh)
    if (sh.status !== 'open' || a.status !== 'published' || Date.parse(sh.startsAt) <= clock()) return []
    let free = sh.capacity - confirmedOn(shiftId)
    const out: Signup[] = []
    const queue = d.signups
      .filter((s) => s.shiftId === shiftId && s.status === 'waitlisted' && d.volunteers.find((v) => v.id === s.volunteerId)?.status === 'active')
      .sort((x, y) => (x.queuedAt ?? '~').localeCompare(y.queuedAt ?? '~') || x.createdAt.localeCompare(y.createdAt))
    for (const s of queue) {
      if (free <= 0) break
      touchSignup(s, { status: 'confirmed', queuedAt: null })
      event({ signupId: s.id, shiftId, volunteerId: s.volunteerId, kind: 'promoted', actor })
      out.push(copy(s))
      free--
    }
    return out
  }

  function leave(signupId: string, status: 'cancelled' | 'declined' | 'removed', reason: string | null, actor: string, volunteerId: string | null) {
    const s = d.signups.find((x) => x.id === signupId)
    if (!s || (volunteerId && s.volunteerId !== volunteerId)) throw new ConflictError('sign-up not found')
    const sh = mustShift(s.shiftId)
    if (!LIVE.includes(s.status)) return { signup: copy(s), promoted: [] as Signup[] }
    if (status === 'declined' && s.status !== 'invited') throw new ConflictError('only an invitation can be declined')
    if (s.attendance === 'present') throw new ConflictError('attendance is already recorded for this shift')
    if (volunteerId && Date.parse(sh.startsAt) <= clock()) throw new ConflictError('the shift has started; please call the coordinator')
    const was = s.status
    touchSignup(s, { status, queuedAt: null, cancelledAt: iso(), cancelReason: reason || null })
    event({ signupId: s.id, shiftId: s.shiftId, volunteerId: s.volunteerId, kind: status, actor, detail: { was, reason: reason || null } })
    return { signup: copy(s), promoted: was === 'confirmed' ? promote(sh.id, 'system') : [] }
  }

  const store: VolunteerStore = {
    kind: 'memory',

    async register(input) {
      const email = input.email.trim().toLowerCase()
      if (!email) throw new ConflictError('an email address is required')
      if (!input.fullName.trim()) throw new ConflictError('a name is required')
      if (input.phone && d.volunteers.some((v) => v.phone === input.phone && v.email !== email)) throw new ConflictError('this phone number is already registered with another email')
      if (d.volunteers.some((v) => v.email === email)) throw new ConflictError('this email is already registered')
      let c = d.contacts.find((x) => x.email === email) ?? (input.phone ? d.contacts.find((x) => x.phone === input.phone) : undefined)
      if (!c) {
        c = { id: uid(), email, phone: input.phone && !d.contacts.some((x) => x.phone === input.phone) ? input.phone : null, fullName: input.fullName, roles: ['volunteer'] }
        d.contacts.push(c)
      } else if (!c.roles.includes('volunteer')) c.roles.push('volunteer')
      const t = iso()
      const v: Volunteer = {
        id: uid(), contactId: d.volunteers.some((x) => x.contactId === c!.id) ? null : c.id, fullName: input.fullName, email, phone: input.phone || null, adult: input.adult,
        ageConfirmedAt: t, areas: input.areas, availability: input.availability, skills: input.skills, transport: input.transport, about: input.about,
        notifyReminders: input.notifyReminders, notifyOpportunities: input.notifyOpportunities, consentWhatsapp: input.consentWhatsapp, consentAt: t,
        status: 'active', sessionVersion: 1, source: input.source ?? 'app', lastSeenAt: null, createdAt: t, updatedAt: t,
      }
      d.volunteers.push(v)
      event({ signupId: null, shiftId: null, volunteerId: v.id, kind: 'registered', actor: input.actor ?? `volunteer:${v.id}`, detail: { source: v.source } })
      return copy(v)
    },
    async getVolunteer(id) {
      return copy(d.volunteers.find((v) => v.id === id) ?? null)
    },
    async getVolunteerByEmail(email) {
      const e = email.trim().toLowerCase()
      return copy(d.volunteers.find((v) => v.email === e) ?? null)
    },
    async listVolunteers(f = {}) {
      const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      return copy(
        d.volunteers
          .filter((v) => (!f.statuses || f.statuses.includes(v.status)) && (!f.ids || f.ids.includes(v.id)) && (!f.contactIds || (v.contactId != null && f.contactIds.includes(v.contactId))))
          .filter((v) => words.every((w) => [v.fullName, v.email, v.phone].some((x) => x?.toLowerCase().includes(/^[\d-]+$/.test(w) ? w.replace(/-/g, '') : w))))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, f.limit ?? 1000),
      )
    },
    async updateVolunteer(id, patch) {
      const v = mustVol(id)
      if (v.status === 'deleted') throw new ConflictError('this account was deleted')
      if (patch.phone && d.volunteers.some((x) => x.id !== id && x.phone === patch.phone)) throw new ConflictError('this phone number is already registered with another email')
      Object.assign(v, patch, { updatedAt: iso() })
      return copy(v)
    },
    async setVolunteerStatus(id, status, actor) {
      const v = mustVol(id)
      if (v.status === 'deleted') throw new ConflictError('this account was deleted')
      const signOut = status !== 'active' && v.status === 'active'
      Object.assign(v, { status, sessionVersion: v.sessionVersion + (signOut ? 1 : 0), updatedAt: iso() })
      event({ signupId: null, shiftId: null, volunteerId: id, kind: `status_${status}`, actor })
      return copy(v)
    },
    async forget(id, actor) {
      const v = mustVol(id)
      for (const s of d.signups.filter((x) => x.volunteerId === id && LIVE.includes(x.status) && Date.parse(mustShift(x.shiftId).startsAt) > clock())) leave(s.id, 'cancelled', 'account deleted', actor, null)
      const c = v.contactId ? d.contacts.find((x) => x.id === v.contactId) : undefined
      if (c) c.roles = c.roles.filter((r) => r !== 'volunteer')
      d.notes = d.notes.filter((n) => n.volunteerId !== id)
      d.outbox = d.outbox.filter((o) => !(o.volunteerId === id && (o.status === 'pending' || o.status === 'failed')))
      Object.assign(v, {
        fullName: 'Deleted volunteer', email: null, phone: null, about: null, areas: [], availability: [], skills: [], contactId: null, status: 'deleted',
        sessionVersion: v.sessionVersion + 1, notifyReminders: false, notifyOpportunities: false, consentWhatsapp: false, updatedAt: iso(),
      })
      event({ signupId: null, shiftId: null, volunteerId: id, kind: 'forgotten', actor })
      return copy(v)
    },
    async touch(id) {
      const v = d.volunteers.find((x) => x.id === id)
      if (v) v.lastSeenAt = iso()
    },
    async listNotes(volunteerId) {
      return copy(d.notes.filter((n) => n.volunteerId === volunteerId).sort((a, b) => b.at.localeCompare(a.at)))
    },
    async addNote(volunteerId, body, authorEmail) {
      mustVol(volunteerId)
      const n: VolNote = { id: uid(), volunteerId, body, authorEmail, at: iso() }
      d.notes.push(n)
      return copy(n)
    },

    async listActivities(f = {}) {
      return copy(
        d.activities
          .filter((a) => (!f.statuses || f.statuses.includes(a.status)) && (!f.ids || f.ids.includes(a.id)) && (!f.projectId || a.furnitureProjectId === f.projectId))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, f.limit ?? 1000),
      )
    },
    async getActivity(id) {
      return copy(d.activities.find((a) => a.id === id) ?? null)
    },
    async createActivity(input, actor) {
      const t = iso()
      const a: Activity = {
        id: uid(), title: input.title, summary: null, description: null, kind: input.kind, status: 'draft', furnitureProjectId: null, furnitureProjectName: null,
        locationName: null, address: null, area: null, mapUrl: null, arrivalInfo: null, requirements: null, equipment: null, instructions: null, adultsOnly: false,
        requiredSkills: [], coordinatorProfileId: null, coordinatorName: null, contactPhone: null, photoUrls: [], signupClosesHours: 0, seriesId: null,
        cancelReason: null, cancelledAt: null, version: 1, createdBy: actor, createdAt: t, updatedAt: t, ...stripUndefined(input),
      }
      d.activities.push(a)
      return copy(a)
    },
    async updateActivity(id, expectVersion, patch) {
      const a = d.activities.find((x) => x.id === id)
      if (!a) throw new ConflictError('activity not found')
      if (a.version !== expectVersion) throw new ConflictError('the activity changed since it was loaded')
      if (a.status === 'cancelled') throw new ConflictError('the activity was cancelled')
      Object.assign(a, stripUndefined(patch), { version: a.version + 1, updatedAt: iso() })
      return copy(a)
    },
    async setActivityStatus(id, from, to) {
      const a = d.activities.find((x) => x.id === id && x.status === from)
      if (!a) throw new ConflictError(`the activity is no longer ${from}`)
      Object.assign(a, { status: to, version: a.version + 1, updatedAt: iso() })
      return copy(a)
    },
    async cancel(activityId, shiftId, reason, actor) {
      const a = d.activities.find((x) => x.id === activityId)
      if (!a) throw new ConflictError('activity not found')
      if (shiftId && !d.shifts.some((s) => s.id === shiftId && s.activityId === activityId)) throw new ConflictError('shift not found')
      if (!shiftId) {
        if (a.status !== 'draft' && a.status !== 'published') throw new ConflictError('the activity is not open')
        Object.assign(a, { status: 'cancelled', cancelReason: reason || null, cancelledAt: iso(), version: a.version + 1, updatedAt: iso() })
      }
      const out: Signup[] = []
      for (const sh of d.shifts.filter((s) => s.activityId === activityId && s.status === 'open' && Date.parse(s.endsAt) > clock() && (!shiftId || s.id === shiftId))) {
        Object.assign(sh, { status: 'cancelled', version: sh.version + 1, updatedAt: iso() })
        event({ signupId: null, shiftId: sh.id, volunteerId: null, kind: 'shift_cancelled', actor, detail: { reason: reason || null } })
        for (const s of d.signups.filter((x) => x.shiftId === sh.id && LIVE.includes(x.status) && x.attendance !== 'present')) {
          touchSignup(s, { status: 'cancelled', queuedAt: null, cancelledAt: iso(), cancelReason: reason || 'shift cancelled' })
          event({ signupId: s.id, shiftId: sh.id, volunteerId: s.volunteerId, kind: 'cancelled_by_team', actor })
          out.push(copy(s))
        }
      }
      return out
    },

    async listShifts(f = {}) {
      return copy(
        d.shifts
          .filter(
            (s) =>
              (!f.activityIds || f.activityIds.includes(s.activityId)) && (!f.ids || f.ids.includes(s.id)) && (!f.status || s.status === f.status) &&
              (!f.from || s.endsAt > f.from) && (!f.to || s.startsAt < f.to),
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, f.limit ?? 5000),
      )
    },
    async getShift(id) {
      return copy(d.shifts.find((s) => s.id === id) ?? null)
    },
    async saveShift(activityId, id, expectVersion, input, actor) {
      if (!id) {
        const a = d.activities.find((x) => x.id === activityId)
        if (!a || (a.status !== 'draft' && a.status !== 'published')) throw new ConflictError('shifts can be added only to a draft or published activity')
        const t = iso()
        const sh: Shift = { id: uid(), activityId, ...input, status: 'open', checkinCode: uid().replace(/-/g, ''), version: 1, createdAt: t, updatedAt: t }
        d.shifts.push(sh)
        event({ signupId: null, shiftId: sh.id, volunteerId: null, kind: 'shift_created', actor })
        return { shift: copy(sh), promoted: [] }
      }
      const sh = mustShift(id)
      if (expectVersion != null && sh.version !== expectVersion) throw new ConflictError('the shift changed since it was loaded')
      if (sh.status !== 'open') throw new ConflictError('the shift was cancelled')
      const confirmed = confirmedOn(id)
      if (input.capacity < confirmed) throw new ConflictError(`${confirmed} volunteers are confirmed; remove someone before lowering capacity to ${input.capacity}`)
      Object.assign(sh, input, { version: sh.version + 1, updatedAt: iso() })
      event({ signupId: null, shiftId: id, volunteerId: null, kind: 'shift_updated', actor })
      return { shift: copy(sh), promoted: promote(id, actor) }
    },

    async listSignups(f = {}) {
      return copy(
        d.signups
          .filter(
            (s) =>
              (!f.shiftIds || f.shiftIds.includes(s.shiftId)) && (!f.volunteerId || s.volunteerId === f.volunteerId) && (!f.volunteerIds || f.volunteerIds.includes(s.volunteerId)) &&
              (!f.ids || f.ids.includes(s.id)) && (!f.statuses || f.statuses.includes(s.status)),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, f.limit ?? 20000),
      )
    },
    async getSignup(id) {
      return copy(d.signups.find((s) => s.id === id) ?? null)
    },
    async join(shiftId, volunteerId, source, actor) {
      const v = mustVol(volunteerId)
      if (v.status !== 'active') throw new ConflictError(`this volunteer account is ${v.status}`)
      const sh = mustShift(shiftId)
      const a = activityOf(sh)
      const now = clock()
      const start = Date.parse(sh.startsAt)
      if (a.status !== 'published') throw new ConflictError(`this activity is ${a.status}`)
      if (sh.status !== 'open') throw new ConflictError('this shift was cancelled')
      if (source === 'walk_in') {
        if (now < start - 2 * H || now > Date.parse(sh.endsAt) + 12 * H) throw new ConflictError('a walk-in can be added only on the day of the shift')
      } else if (start <= now) throw new ConflictError('this shift has already started')
      else if (source !== 'staff' && now > start - a.signupClosesHours * H) throw new ConflictError('sign-up for this shift has closed')
      if (a.adultsOnly && !v.adult) throw new ConflictError('this activity is for volunteers aged 18 and over')
      const ex = d.signups.find((s) => s.shiftId === shiftId && s.volunteerId === volunteerId)
      if (ex && (ex.status === 'confirmed' || ex.status === 'waitlisted')) return copy(ex)
      const clash = d.signups.find((s) => {
        if (s.volunteerId !== volunteerId || s.shiftId === shiftId || (s.status !== 'confirmed' && s.status !== 'waitlisted')) return false
        const other = mustShift(s.shiftId)
        return other.status === 'open' && overlaps(other, sh)
      })
      if (clash) throw new ConflictError(`overlaps another shift you joined (${activityOf(mustShift(clash.shiftId)).title})`)
      const confirmed = confirmedOn(shiftId)
      let st: SignupStatus
      if (confirmed < sh.capacity || source === 'walk_in') st = 'confirmed'
      else if (source === 'staff') throw new ConflictError(`the shift is full (${confirmed} of ${sh.capacity}); raise its capacity first`)
      else st = 'waitlisted'
      const t = iso()
      let s: Signup
      if (!ex) {
        s = {
          id: uid(), shiftId, volunteerId, status: st, source, queuedAt: st === 'waitlisted' ? t : null, invitedBy: null, cancelledAt: null, cancelReason: null,
          attendance: 'unknown', checkInAt: null, checkOutAt: null, minutes: null, attendanceMethod: null, attendanceBy: null, attendanceNote: null, version: 1, createdAt: t, updatedAt: t,
        }
        d.signups.push(s)
      } else s = touchSignup(ex, { status: st, source: ex.status === 'invited' ? 'invite' : source, queuedAt: st === 'waitlisted' ? t : null, cancelledAt: null, cancelReason: null })
      event({ signupId: s.id, shiftId, volunteerId, kind: st === 'waitlisted' ? 'waitlisted' : 'joined', actor, detail: { source } })
      return copy(s)
    },
    async invite(shiftId, volunteerId, actor) {
      const v = d.volunteers.find((x) => x.id === volunteerId)
      if (!v || v.status !== 'active') throw new ConflictError('this volunteer cannot be invited')
      const sh = mustShift(shiftId)
      const a = activityOf(sh)
      if (a.status !== 'published' || sh.status !== 'open' || Date.parse(sh.startsAt) <= clock()) throw new ConflictError('this shift is not open')
      if (a.adultsOnly && !v.adult) throw new ConflictError('this activity is for volunteers aged 18 and over')
      const ex = d.signups.find((s) => s.shiftId === shiftId && s.volunteerId === volunteerId)
      if (ex && LIVE.includes(ex.status)) return copy(ex)
      const t = iso()
      let s: Signup
      if (ex) s = touchSignup(ex, { status: 'invited', source: 'invite', invitedBy: actor, queuedAt: null, cancelledAt: null, cancelReason: null })
      else {
        s = {
          id: uid(), shiftId, volunteerId, status: 'invited', source: 'invite', queuedAt: null, invitedBy: actor, cancelledAt: null, cancelReason: null, attendance: 'unknown',
          checkInAt: null, checkOutAt: null, minutes: null, attendanceMethod: null, attendanceBy: null, attendanceNote: null, version: 1, createdAt: t, updatedAt: t,
        }
        d.signups.push(s)
      }
      event({ signupId: s.id, shiftId, volunteerId, kind: 'invited', actor })
      return copy(s)
    },
    async leave(signupId, status, reason, actor, volunteerId) {
      return leave(signupId, status, reason, actor, volunteerId)
    },
    async attendance(signupId, op, at, note, actor, expectVersion) {
      const s = d.signups.find((x) => x.id === signupId)
      if (!s) throw new ConflictError('sign-up not found')
      if (expectVersion != null && s.version !== expectVersion) throw new ConflictError('someone else changed this attendance; reload')
      if (s.status !== 'confirmed') throw new ConflictError(`only a confirmed volunteer can have attendance (this one is ${s.status})`)
      const sh = mustShift(s.shiftId)
      const now = clock()
      if ((op === 'check_in' || op === 'check_out' || op === 'full_shift') && now < Date.parse(sh.startsAt) - 2 * H) throw new ConflictError('the shift has not started yet')
      const before = { attendance: s.attendance, in: s.checkInAt, out: s.checkOutAt, minutes: s.minutes }
      const mins = (a: string, b: string) => Math.min(1440, Math.round((Date.parse(b) - Date.parse(a)) / 60_000))
      const t = iso()
      let patch: Partial<Signup>
      if (op === 'check_in') patch = { attendance: 'present', checkInAt: at.in ?? t, checkOutAt: null, minutes: null, attendanceMethod: 'coordinator' }
      else if (op === 'check_out') {
        if (!s.checkInAt) throw new ConflictError('check the volunteer in first')
        const out = at.out ?? t
        if (out < s.checkInAt) throw new ConflictError('check-out is before check-in')
        patch = { checkOutAt: out, minutes: mins(s.checkInAt, out), attendanceMethod: s.attendanceMethod ?? 'coordinator' }
      } else if (op === 'full_shift') patch = { attendance: 'present', checkInAt: sh.startsAt, checkOutAt: sh.endsAt, minutes: mins(sh.startsAt, sh.endsAt), attendanceMethod: 'full_shift' }
      else if (op === 'absent' || op === 'excused') patch = { attendance: op, checkInAt: null, checkOutAt: null, minutes: null, attendanceMethod: 'coordinator' }
      else if (op === 'correct') {
        if (!note?.trim()) throw new ConflictError('a correction needs a note saying why')
        if (!at.in || !at.out || at.out < at.in) throw new ConflictError('give a check-in and a later check-out time')
        if (Date.parse(at.out) - Date.parse(at.in) > 24 * H) throw new ConflictError('more than 24 hours for one shift')
        patch = { attendance: 'present', checkInAt: at.in, checkOutAt: at.out, minutes: Math.round((Date.parse(at.out) - Date.parse(at.in)) / 60_000), attendanceMethod: 'correction' }
      } else if (op === 'reset') patch = { attendance: 'unknown', checkInAt: null, checkOutAt: null, minutes: null, attendanceMethod: null }
      else throw new ConflictError(`unknown attendance operation ${op}`)
      touchSignup(s, { ...patch, attendanceBy: actor, attendanceNote: note?.trim() || s.attendanceNote })
      event({ signupId: s.id, shiftId: s.shiftId, volunteerId: s.volunteerId, kind: `attendance_${op}`, actor, detail: { before, after: { attendance: s.attendance, in: s.checkInAt, out: s.checkOutAt, minutes: s.minutes }, note: note?.trim() || null } })
      return copy(s)
    },
    async selfCheckin(shiftId, volunteerId, code) {
      const sh = d.shifts.find((x) => x.id === shiftId)
      if (!sh || sh.checkinCode !== code) throw new ConflictError('this check-in code is not valid')
      if (sh.status !== 'open') throw new ConflictError('this shift was cancelled')
      const now = clock()
      if (now < Date.parse(sh.startsAt) - H || now > Date.parse(sh.endsAt) + 2 * H) throw new ConflictError('check-in is open from an hour before the shift until two hours after it')
      const s = d.signups.find((x) => x.shiftId === shiftId && x.volunteerId === volunteerId)
      if (!s || s.status !== 'confirmed') throw new ConflictError('you are not confirmed for this shift; ask the coordinator')
      if (s.checkOutAt || s.attendance === 'absent' || s.attendance === 'excused') return copy(s)
      const t = iso()
      let op: string
      if (!s.checkInAt) {
        op = 'check_in'
        touchSignup(s, { attendance: 'present', checkInAt: t, attendanceMethod: 'qr', attendanceBy: `volunteer:${volunteerId}` })
      } else if (now - Date.parse(s.checkInAt) >= 15 * 60_000) {
        op = 'check_out'
        touchSignup(s, { checkOutAt: t, minutes: Math.min(1440, Math.round((now - Date.parse(s.checkInAt)) / 60_000)), attendanceBy: `volunteer:${volunteerId}` })
      } else return copy(s)
      event({ signupId: s.id, shiftId, volunteerId, kind: `attendance_${op}`, actor: `volunteer:${volunteerId}`, detail: { method: 'qr' } })
      return copy(s)
    },

    async listEvents(f) {
      return copy(
        d.events
          .filter((e) => (!f.volunteerId || e.volunteerId === f.volunteerId) && (!f.signupIds || (e.signupId != null && f.signupIds.includes(e.signupId))) && (!f.shiftIds || (e.shiftId != null && f.shiftIds.includes(e.shiftId))) && (!f.since || e.at >= f.since))
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, f.limit ?? 500),
      )
    },

    async enqueue(rows) {
      const out: OutboxRow[] = []
      for (const r of rows) {
        if (d.outbox.some((o) => o.dedupeKey === r.dedupeKey)) continue
        const o: OutboxRow = { id: uid(), channel: 'email', status: 'pending', notBefore: r.notBefore ?? iso(), attempts: 0, lastError: null, sentAt: null, claimedAt: null, createdAt: iso(), ...r, ...(r.notBefore ? {} : { notBefore: iso() }) }
        d.outbox.push(o)
        out.push(copy(o))
      }
      return out
    },
    async claimOutbox(limit) {
      const now = clock()
      const due = d.outbox
        .filter((o) => o.attempts < 5 && (((o.status === 'pending' || o.status === 'failed') && Date.parse(o.notBefore) <= now) || (o.status === 'sending' && o.claimedAt != null && now - Date.parse(o.claimedAt) > 15 * 60_000)))
        .sort((a, b) => a.notBefore.localeCompare(b.notBefore))
        .slice(0, limit)
      for (const o of due) Object.assign(o, { status: 'sending', claimedAt: iso(), attempts: o.attempts + 1 })
      return copy(due)
    },
    async markOutbox(id, status, error) {
      const o = d.outbox.find((x) => x.id === id)
      if (o) Object.assign(o, { status, lastError: error ?? null, sentAt: status === 'sent' ? iso() : o.sentAt })
    },
    async listOutbox(f) {
      return copy(
        d.outbox
          .filter((o) => (!f.volunteerId || o.volunteerId === f.volunteerId) && (!f.statuses || f.statuses.includes(o.status)) && (!f.since || o.createdAt >= f.since))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, f.limit ?? 200),
      )
    },

    async addLoginCode(email, codeHash, expiresAt) {
      d.codes.push({ id: uid(), email, codeHash, expiresAt, attempts: 0, consumedAt: null, createdAt: iso() })
    },
    async countLoginCodes(email, since) {
      return d.codes.filter((c) => c.email === email && c.createdAt >= since).length
    },
    async latestLoginCode(email) {
      const c = d.codes.filter((x) => x.email === email).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      return c ? { id: c.id, codeHash: c.codeHash, expiresAt: c.expiresAt, attempts: c.attempts, consumedAt: c.consumedAt } : null
    },
    async failLoginCode(id) {
      const c = d.codes.find((x) => x.id === id)
      if (c) c.attempts++
    },
    async consumeLoginCode(id) {
      const c = d.codes.find((x) => x.id === id && !x.consumedAt)
      if (!c) return false
      c.consumedAt = iso()
      return true
    },
  }
  return store
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}
