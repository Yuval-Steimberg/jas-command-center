/**
 * Persistence for volunteer scheduling (migration 0011). One interface, two
 * implementations with the same rules:
 *
 * - Supabase: every write is a plpgsql function that checks WHO is calling.
 *   Built over the signed-in admin's client (RLS + auth.uid()) in the Command
 *   Center, or over the service role in the volunteer app, where the only
 *   writes the database accepts are a volunteer's own absence and taking it back.
 * - Memory: local development and tests. The same checks, with no await
 *   between a check and its write, so concurrent calls serialise like a lock.
 *
 * Shared by the Command Center and the volunteer app: relative imports only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ConflictError } from '../ops/store'
import { OpsSetupError } from '../ops/store'
import { israelDay } from './time'
import type { AssignmentStatus, SchedAbsence, SchedAssignment, SchedClosure, SchedLocation, SchedRegular, SchedSlot, SchedVolunteer, ScheduleData } from './schedule'
import { regularOn, weekdayOf } from './schedule'

export { ConflictError }

/** The caller is not allowed to make this change (not an admin of the location, or not the volunteer app). */
export class ScheduleForbiddenError extends Error {
  readonly forbidden = true
}

export const scheduleSetup = () => new OpsSetupError('0011_volunteer_schedule.sql', 'The volunteer schedule tables')

export interface SlotPatch {
  required?: number | null
  startsAt?: string | null
  endsAt?: string | null
}

export interface ScheduleStore {
  readonly kind: 'memory' | 'supabase'
  /** The locations the caller schedules (admin). Empty = not a scheduler. */
  myLocations(): Promise<SchedLocation[]>
  /** A location's schedule for [from, to] and every volunteer a scheduler may see (admin). */
  load(locationId: string, from: string, to: string): Promise<ScheduleData>
  /** One volunteer's own rows for [from, to] (volunteer app, service role). */
  loadForVolunteer(volunteerId: string, from: string, to: string): Promise<ScheduleData>

  updateSlot(slotId: string, expectVersion: number | null, patch: SlotPatch): Promise<SchedSlot>
  addRegular(slotId: string, volunteerId: string, from: string): Promise<SchedRegular>
  endRegular(regularId: string, lastDate: string): Promise<SchedRegular>
  absence(slotId: string, volunteerId: string, date: string, reason: string | null, source: 'volunteer' | 'admin'): Promise<SchedAbsence>
  withdrawAbsence(absenceId: string, source: 'volunteer' | 'admin', volunteerId: string | null): Promise<SchedAbsence>
  assign(slotId: string, volunteerId: string, date: string, status: AssignmentStatus, replaces: string | null, note: string | null): Promise<SchedAssignment>
  replace(slotId: string, date: string, outId: string, inId: string, status: AssignmentStatus, reason: string | null): Promise<SchedAssignment>
  setAssignmentStatus(assignmentId: string, status: AssignmentStatus): Promise<SchedAssignment>
  cancelAssignment(assignmentId: string, reason: string | null): Promise<SchedAssignment>
  setClosure(slotId: string, date: string, closed: boolean, reason: string | null): Promise<boolean>
}

// ── Supabase ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
type PgError = { code?: string; message?: string } | null
const PAGE = 1000
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const fromRow = <T>(r: Row): T => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])) as T

export function scheduleFail(error: PgError): never {
  const msg = error?.message ?? 'Unknown database error'
  if (error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202' || /relation .* does not exist|Could not find the (table|function)/i.test(msg)) throw scheduleSetup()
  const f = /cc_forbidden:\s*(.*)/.exec(msg)
  if (f) throw new ScheduleForbiddenError(f[1]!)
  if (error?.code === '42501') throw new ScheduleForbiddenError('permission denied')
  const m = /cc_conflict:\s*(.*)/.exec(msg)
  if (m) throw new ConflictError(m[1]!)
  if (error?.code === '23505') throw new ConflictError('That is already scheduled.')
  throw new Error(msg)
}

const VOL_COLS = 'id, full_name, phone, availability, status'

export function supabaseScheduleStore(db: SupabaseClient): ScheduleStore {
  async function rows<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const { data, error } = await p
    if (error) scheduleFail(error)
    return ((Array.isArray(data) ? data : data == null ? [] : [data]) as Row[]).map((r) => fromRow<T>(r))
  }
  async function paged<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const out: T[] = []
    for (let i = 0; ; i += PAGE) {
      const page = await rows<T>(make(i, i + PAGE - 1))
      out.push(...page)
      if (page.length < PAGE) return out
    }
  }
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await rows<T>(db.rpc(fn, args))
    if (!r[0]) throw new ConflictError('nothing changed')
    return r[0]
  }
  const fixSlot = (s: SchedSlot): SchedSlot => ({ ...s, startsAt: s.startsAt ?? null, endsAt: s.endsAt ?? null })

  async function bySlots(slotIds: string[], from: string, to: string, volunteerId?: string) {
    if (!slotIds.length) return { regulars: [], absences: [], assignments: [], closures: [] }
    const v = (q: any) => (volunteerId ? q.eq('volunteer_id', volunteerId) : q)
    const [regulars, absences, assignments, closures] = await Promise.all([
      paged<SchedRegular>((a, b) => v(db.from('cc_vol_regulars').select('id, slot_id, volunteer_id, starts_on, ends_on').in('slot_id', slotIds).lte('starts_on', to).or(`ends_on.is.null,ends_on.gte.${from}`)).order('id').range(a, b)),
      paged<SchedAbsence>((a, b) => v(db.from('cc_vol_absences').select('id, slot_id, volunteer_id, on_date, source, reason, reported_by, created_at, withdrawn_at').in('slot_id', slotIds).gte('on_date', from).lte('on_date', to).is('withdrawn_at', null)).order('id').range(a, b)),
      paged<SchedAssignment>((a, b) => v(db.from('cc_vol_assignments').select('id, slot_id, volunteer_id, on_date, status, replaces_volunteer_id, note, created_at, cancelled_at').in('slot_id', slotIds).gte('on_date', from).lte('on_date', to).is('cancelled_at', null)).order('id').range(a, b)),
      paged<SchedClosure>((a, b) => db.from('cc_vol_closures').select('slot_id, on_date, reason').in('slot_id', slotIds).gte('on_date', from).lte('on_date', to).order('on_date').range(a, b)),
    ])
    return { regulars, absences, assignments, closures }
  }

  return {
    kind: 'supabase',

    async myLocations() {
      // RLS returns only the locations the signed-in person administers.
      return rows<SchedLocation>(db.from('cc_vol_locations').select('id, slug, name, active').eq('active', true).order('name'))
    },

    async load(locationId, from, to) {
      const [locations, slots] = await Promise.all([
        rows<SchedLocation>(db.from('cc_vol_locations').select('id, slug, name, active').eq('id', locationId)),
        rows<SchedSlot>(db.from('cc_vol_slots').select('id, location_id, activity, weekday, starts_at, ends_at, required, active, version').eq('location_id', locationId).order('weekday')),
      ])
      if (!locations.length) throw new ScheduleForbiddenError('you do not schedule this location')
      const [rest, volunteers] = await Promise.all([
        bySlots(slots.map((s) => s.id), from, to),
        paged<SchedVolunteer>((a, b) => db.from('cc_volunteers').select(VOL_COLS).neq('status', 'deleted').order('id').range(a, b)),
      ])
      return { locations, slots: slots.map(fixSlot), volunteers: volunteers.map((v) => ({ ...v, availability: v.availability ?? [] })), ...rest }
    },

    async loadForVolunteer(volunteerId, from, to) {
      const [reg, asg] = await Promise.all([
        rows<{ slotId: string }>(db.from('cc_vol_regulars').select('slot_id').eq('volunteer_id', volunteerId).or(`ends_on.is.null,ends_on.gte.${from}`)),
        rows<{ slotId: string }>(db.from('cc_vol_assignments').select('slot_id').eq('volunteer_id', volunteerId).gte('on_date', from).is('cancelled_at', null)),
      ])
      const slotIds = [...new Set([...reg, ...asg].map((r) => r.slotId))]
      if (!slotIds.length) return { locations: [], slots: [], regulars: [], absences: [], assignments: [], closures: [], volunteers: [] }
      const slots = (await rows<SchedSlot>(db.from('cc_vol_slots').select('id, location_id, activity, weekday, starts_at, ends_at, required, active, version').in('id', slotIds))).map(fixSlot)
      const [locations, rest] = await Promise.all([
        rows<SchedLocation>(db.from('cc_vol_locations').select('id, slug, name, active').in('id', [...new Set(slots.map((s) => s.locationId))])),
        bySlots(slotIds, from, to, volunteerId),
      ])
      return { locations, slots, volunteers: [], ...rest }
    },

    updateSlot: async (slotId, expectVersion, patch) => {
      const p: Record<string, unknown> = {}
      if (patch.required !== undefined) p.required = patch.required === null ? '' : String(patch.required)
      if (patch.startsAt !== undefined) p.starts_at = patch.startsAt ?? ''
      if (patch.endsAt !== undefined) p.ends_at = patch.endsAt ?? ''
      return fixSlot(await rpc<SchedSlot>('cc_vol_sched_update_slot', { p_slot: slotId, p_expect_version: expectVersion, p }))
    },
    addRegular: (slotId, volunteerId, from) => rpc('cc_vol_sched_add_regular', { p_slot: slotId, p_volunteer: volunteerId, p_from: from }),
    endRegular: (regularId, last) => rpc('cc_vol_sched_end_regular', { p_regular: regularId, p_last: last }),
    absence: (slotId, volunteerId, date, reason, source) => rpc('cc_vol_sched_absence', { p_slot: slotId, p_volunteer: volunteerId, p_date: date, p_reason: reason, p_source: source }),
    withdrawAbsence: (absenceId, source, volunteerId) => rpc('cc_vol_sched_withdraw_absence', { p_absence: absenceId, p_source: source, p_volunteer: volunteerId }),
    assign: (slotId, volunteerId, date, status, replaces, note) => rpc('cc_vol_sched_assign', { p_slot: slotId, p_volunteer: volunteerId, p_date: date, p_status: status, p_replaces: replaces, p_note: note }),
    replace: (slotId, date, outId, inId, status, reason) => rpc('cc_vol_sched_replace', { p_slot: slotId, p_date: date, p_out: outId, p_in: inId, p_status: status, p_reason: reason }),
    setAssignmentStatus: (id, status) => rpc('cc_vol_sched_assignment_status', { p_assignment: id, p_status: status }),
    cancelAssignment: (id, reason) => rpc('cc_vol_sched_cancel_assignment', { p_assignment: id, p_reason: reason }),
    async setClosure(slotId, date, closed, reason) {
      const { data, error } = await db.rpc('cc_vol_sched_closure', { p_slot: slotId, p_date: date, p_closed: closed, p_reason: reason })
      if (error) scheduleFail(error)
      return Boolean(data)
    },
  }
}

// ── Memory ─────────────────────────────────────────────────────────────────

export interface MemorySchedData {
  locations: SchedLocation[]
  slots: SchedSlot[]
  regulars: (SchedRegular & { createdBy: string })[]
  absences: SchedAbsence[]
  assignments: (SchedAssignment & { createdBy: string; cancelledBy?: string | null; cancelReason?: string | null })[]
  closures: (SchedClosure & { createdBy: string })[]
  /** location id → admin emails. */
  admins: { locationId: string; email: string }[]
  events: { at: string; volunteerId: string | null; kind: string; actor: string; detail: Record<string, unknown> }[]
}

/** The same phase-1 rows the migration seeds: Sharon's Workshop, Monday–Wednesday, required not set. */
export function seedSchedule(): MemorySchedData {
  const loc: SchedLocation = { id: '00000000-0000-4000-8000-00000000a001', slug: 'sharon_workshop', name: 'הסדנה של שרון', active: true }
  const slot = (weekday: number): SchedSlot => ({ id: `00000000-0000-4000-8000-00000000b00${weekday}`, locationId: loc.id, activity: 'workshop', weekday, startsAt: null, endsAt: null, required: null, active: true, version: 1 })
  return { locations: [loc], slots: [slot(1), slot(2), slot(3)], regulars: [], absences: [], assignments: [], closures: [], admins: [], events: [] }
}

/** Who is calling the memory store: an admin (by email) or the volunteer app's server. */
export type MemoryCaller = { kind: 'admin'; email: string } | { kind: 'service' }

export function memoryScheduleStore(d: MemorySchedData, caller: MemoryCaller, volunteers: () => SchedVolunteer[], clock: () => number = Date.now): ScheduleStore {
  const uid = () => crypto.randomUUID()
  const iso = () => new Date(clock()).toISOString()
  const today = () => israelDay(clock())
  const copy = <T>(x: T): T => structuredClone(x)
  const conflict = (m: string): never => {
    throw new ConflictError(m)
  }
  const event = (volunteerId: string | null, kind: string, actor: string, detail: Record<string, unknown>) => d.events.push({ at: iso(), volunteerId, kind, actor, detail })

  const admin = (locationId: string) => {
    if (caller.kind !== 'admin' || !d.admins.some((a) => a.locationId === locationId && a.email === caller.email)) {
      throw new ScheduleForbiddenError("only this location's scheduling administrator can change its schedule")
    }
    return caller.email
  }
  const volunteerCaller = () => {
    if (caller.kind !== 'service') throw new ScheduleForbiddenError('volunteers report absences through the volunteer app')
  }
  const vol = (id: string) => volunteers().find((v) => v.id === id) ?? conflict('volunteer not found')
  const activeVol = (id: string) => (vol(id).status === 'active' ? vol(id) : conflict("this volunteer's account is not active"))
  const slotOn = (id: string, date: string | null) => {
    const s = d.slots.find((x) => x.id === id) ?? conflict('that day of the schedule does not exist')
    if (!s.active || !d.locations.find((l) => l.id === s.locationId)?.active) conflict('that day is not part of the schedule any more')
    if (date !== null && weekdayOf(date) !== s.weekday) conflict(`${date} is not a day of this schedule`)
    return s
  }
  const scheduled = (slotId: string, volunteerId: string, date: string): 'regular' | 'assigned' | null =>
    d.regulars.some((r) => r.slotId === slotId && r.volunteerId === volunteerId && regularOn(r, date)) ? 'regular'
      : d.assignments.some((a) => a.slotId === slotId && a.volunteerId === volunteerId && a.onDate === date && !a.cancelledAt) ? 'assigned' : null
  const liveAbsence = (slotId: string, volunteerId: string, date: string) => d.absences.find((a) => a.slotId === slotId && a.volunteerId === volunteerId && a.onDate === date && !a.withdrawnAt)
  const closed = (slotId: string, date: string) => d.closures.some((c) => c.slotId === slotId && c.onDate === date)
  const overlap = (a: SchedSlot, b: SchedSlot) => !a.startsAt || !a.endsAt || !b.startsAt || !b.endsAt || (a.startsAt < b.endsAt && b.startsAt < a.endsAt)

  function assignInner(s: SchedSlot, volunteerId: string, date: string, status: AssignmentStatus, replaces: string | null, note: string | null, actor: string) {
    if (date < today()) conflict('that day has passed')
    if (closed(s.id, date)) conflict('the workshop is closed that day')
    if (liveAbsence(s.id, volunteerId, date)) conflict('this volunteer reported they will not come that day; take the absence back instead')
    if (scheduled(s.id, volunteerId, date) === 'regular') conflict('this volunteer already comes that day as a regular')
    const existing = d.assignments.find((a) => a.slotId === s.id && a.volunteerId === volunteerId && a.onDate === date && !a.cancelledAt)
    if (existing) {
      if (existing.status !== status) Object.assign(existing, { status })
      return copy(existing)
    }
    const other = d.slots.find((s2) => s2.id !== s.id && s2.active && s2.weekday === s.weekday && overlap(s, s2) && scheduled(s2.id, volunteerId, date) && !liveAbsence(s2.id, volunteerId, date))
    if (other) conflict(`this volunteer is already scheduled at ${d.locations.find((l) => l.id === other.locationId)?.name} at that time`)
    if (replaces !== null && (replaces === volunteerId || !scheduled(s.id, replaces, date))) conflict('the person being replaced is not scheduled that day')
    const a = { id: uid(), slotId: s.id, volunteerId, onDate: date, status, replacesVolunteerId: replaces, note: note?.trim().slice(0, 300) || null, createdAt: iso(), cancelledAt: null, createdBy: actor }
    d.assignments.push(a)
    event(volunteerId, 'schedule.assigned', actor, { slot: s.id, date, status, replaces })
    return copy(a)
  }

  return {
    kind: 'memory',

    async myLocations() {
      if (caller.kind !== 'admin') return []
      return copy(d.locations.filter((l) => l.active && d.admins.some((a) => a.locationId === l.id && a.email === caller.email)))
    },

    async load(locationId, from, to) {
      if (caller.kind !== 'admin' || !d.admins.some((a) => a.locationId === locationId && a.email === caller.email)) throw new ScheduleForbiddenError('you do not schedule this location')
      const slots = d.slots.filter((s) => s.locationId === locationId)
      const ids = new Set(slots.map((s) => s.id))
      return copy({
        locations: d.locations.filter((l) => l.id === locationId),
        slots,
        regulars: d.regulars.filter((r) => ids.has(r.slotId) && r.startsOn <= to && (r.endsOn === null || r.endsOn >= from)),
        absences: d.absences.filter((a) => ids.has(a.slotId) && a.onDate >= from && a.onDate <= to && !a.withdrawnAt),
        assignments: d.assignments.filter((a) => ids.has(a.slotId) && a.onDate >= from && a.onDate <= to && !a.cancelledAt),
        closures: d.closures.filter((c) => ids.has(c.slotId) && c.onDate >= from && c.onDate <= to),
        volunteers: volunteers().filter((v) => v.status !== 'deleted'),
      })
    },

    async loadForVolunteer(volunteerId, from, to) {
      const slotIds = new Set([
        ...d.regulars.filter((r) => r.volunteerId === volunteerId && (r.endsOn === null || r.endsOn >= from)).map((r) => r.slotId),
        ...d.assignments.filter((a) => a.volunteerId === volunteerId && a.onDate >= from && !a.cancelledAt).map((a) => a.slotId),
      ])
      const slots = d.slots.filter((s) => slotIds.has(s.id))
      return copy({
        locations: d.locations.filter((l) => slots.some((s) => s.locationId === l.id)),
        slots,
        regulars: d.regulars.filter((r) => r.volunteerId === volunteerId && slotIds.has(r.slotId) && r.startsOn <= to && (r.endsOn === null || r.endsOn >= from)),
        absences: d.absences.filter((a) => a.volunteerId === volunteerId && slotIds.has(a.slotId) && a.onDate >= from && a.onDate <= to && !a.withdrawnAt),
        assignments: d.assignments.filter((a) => a.volunteerId === volunteerId && slotIds.has(a.slotId) && a.onDate >= from && a.onDate <= to && !a.cancelledAt),
        closures: d.closures.filter((c) => slotIds.has(c.slotId) && c.onDate >= from && c.onDate <= to),
        volunteers: [],
      })
    },

    async updateSlot(slotId, expectVersion, patch) {
      const s = slotOn(slotId, null)
      const actor = admin(s.locationId)
      if (expectVersion !== null && s.version !== expectVersion) conflict('someone changed this day in the meantime; reload and try again')
      if (patch.required !== undefined && patch.required !== null && (!Number.isInteger(patch.required) || patch.required < 0 || patch.required > 200)) conflict('the required number must be 0–200')
      const next = { ...s, ...patch }
      if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) conflict('the day must end after it starts')
      Object.assign(s, patch, { version: s.version + 1 })
      event(null, 'schedule.slot_updated', actor, { slot: slotId, change: patch })
      return copy(s)
    },

    async addRegular(slotId, volunteerId, from) {
      activeVol(volunteerId)
      const s = slotOn(slotId, null)
      const actor = admin(s.locationId)
      if (from < today()) conflict('a regular day starts today or later')
      if (d.regulars.some((r) => r.slotId === slotId && r.volunteerId === volunteerId && (r.endsOn === null || r.endsOn >= from))) conflict('this volunteer is already a regular on this day')
      const other = d.regulars.find((r) => {
        const s2 = d.slots.find((x) => x.id === r.slotId)!
        return r.volunteerId === volunteerId && s2.id !== slotId && s2.weekday === s.weekday && s2.active && (r.endsOn === null || r.endsOn >= from) && overlap(s, s2)
      })
      if (other) conflict('this volunteer is already a regular elsewhere on that weekday')
      const r = { id: uid(), slotId, volunteerId, startsOn: from, endsOn: null, createdBy: actor }
      d.regulars.push(r)
      for (const a of d.assignments) if (a.slotId === slotId && a.volunteerId === volunteerId && a.onDate >= from && !a.cancelledAt) Object.assign(a, { cancelledAt: iso(), cancelledBy: actor, cancelReason: 'now a regular on this day' })
      event(volunteerId, 'schedule.regular_added', actor, { slot: slotId, from })
      return copy(r)
    },

    async endRegular(regularId, last) {
      const r = d.regulars.find((x) => x.id === regularId) ?? conflict('that regular day was not found')
      const s = slotOn(r.slotId, null)
      const actor = admin(s.locationId)
      if (last < addDay(today(), -1)) conflict('the last day can be yesterday at the earliest; past weeks are history')
      if (r.endsOn !== null && r.endsOn <= last) return copy(r)
      if (last < r.startsOn) d.regulars.splice(d.regulars.indexOf(r), 1)
      else r.endsOn = last
      for (const a of d.absences) {
        if (a.slotId === r.slotId && a.volunteerId === r.volunteerId && a.onDate > last && !a.withdrawnAt && !d.assignments.some((x) => x.slotId === a.slotId && x.volunteerId === a.volunteerId && x.onDate === a.onDate && !x.cancelledAt)) {
          Object.assign(a, { withdrawnAt: iso() })
        }
      }
      event(r.volunteerId, 'schedule.regular_ended', actor, { slot: r.slotId, last })
      return copy(r)
    },

    async absence(slotId, volunteerId, date, reason, source) {
      vol(volunteerId)
      const s = slotOn(slotId, date)
      let actor: string
      if (source === 'volunteer') {
        volunteerCaller()
        actor = `volunteer:${volunteerId}`
        if (date < today()) conflict('that day has passed')
      } else actor = admin(s.locationId)
      if (closed(slotId, date)) conflict('the workshop is closed that day, so nobody is expected')
      if (!scheduled(slotId, volunteerId, date)) conflict('this volunteer is not scheduled on that day')
      const existing = liveAbsence(slotId, volunteerId, date)
      if (existing) return copy(existing)
      const a: SchedAbsence = { id: uid(), slotId, volunteerId, onDate: date, source, reason: reason?.trim().slice(0, 300) || null, reportedBy: actor, createdAt: iso(), withdrawnAt: null }
      d.absences.push(a)
      event(volunteerId, 'schedule.absence', actor, { slot: slotId, date, source })
      return copy(a)
    },

    async withdrawAbsence(absenceId, source, volunteerId) {
      const a = d.absences.find((x) => x.id === absenceId) ?? conflict('that absence was not found')
      const s = slotOn(a.slotId, null)
      let actor: string
      if (source === 'volunteer') {
        volunteerCaller()
        if (volunteerId !== a.volunteerId) conflict('that absence was not found')
        if (a.onDate < today()) conflict('that day has passed')
        actor = `volunteer:${volunteerId}`
      } else actor = admin(s.locationId)
      if (a.withdrawnAt) return copy(a)
      a.withdrawnAt = iso()
      event(a.volunteerId, 'schedule.absence_withdrawn', actor, { slot: a.slotId, date: a.onDate, source })
      return copy(a)
    },

    async assign(slotId, volunteerId, date, status, replaces, note) {
      activeVol(volunteerId)
      const s = slotOn(slotId, date)
      const actor = admin(s.locationId)
      return assignInner(s, volunteerId, date, status, replaces, note, actor)
    },

    async replace(slotId, date, outId, inId, status, reason) {
      if (outId === inId) conflict('a volunteer cannot replace themselves')
      vol(outId)
      activeVol(inId)
      const s = slotOn(slotId, date)
      const actor = admin(s.locationId)
      if (!scheduled(slotId, outId, date)) conflict('the person being replaced is not scheduled that day')
      // Check everything before writing anything: the SQL version is one transaction.
      const absentAlready = Boolean(liveAbsence(slotId, outId, date))
      if (!absentAlready && date < today()) conflict('that day has passed')
      const snapshot = { absences: d.absences.length, events: d.events.length }
      if (!absentAlready) {
        d.absences.push({ id: uid(), slotId, volunteerId: outId, onDate: date, source: 'admin', reason: reason?.trim().slice(0, 300) || null, reportedBy: actor, createdAt: iso(), withdrawnAt: null })
        event(outId, 'schedule.absence', actor, { slot: slotId, date, source: 'admin' })
      }
      try {
        return assignInner(s, inId, date, status, outId, null, actor)
      } catch (e) {
        d.absences.length = snapshot.absences
        d.events.length = snapshot.events
        throw e
      }
    },

    async setAssignmentStatus(id, status) {
      const a = d.assignments.find((x) => x.id === id) ?? conflict('that assignment was not found')
      const actor = admin(slotOn(a.slotId, null).locationId)
      if (a.cancelledAt) conflict('that assignment was cancelled')
      if (a.status !== status) {
        a.status = status
        event(a.volunteerId, `schedule.assignment_${status}`, actor, { slot: a.slotId, date: a.onDate })
      }
      return copy(a)
    },

    async cancelAssignment(id, reason) {
      const a = d.assignments.find((x) => x.id === id) ?? conflict('that assignment was not found')
      const actor = admin(slotOn(a.slotId, null).locationId)
      if (a.cancelledAt) return copy(a)
      Object.assign(a, { cancelledAt: iso(), cancelledBy: actor, cancelReason: reason?.trim().slice(0, 300) || null })
      if (!scheduled(a.slotId, a.volunteerId, a.onDate)) {
        const ab = liveAbsence(a.slotId, a.volunteerId, a.onDate)
        if (ab) ab.withdrawnAt = iso()
      }
      event(a.volunteerId, 'schedule.assignment_cancelled', actor, { slot: a.slotId, date: a.onDate })
      return copy(a)
    },

    async setClosure(slotId, date, isClosed, reason) {
      const s = slotOn(slotId, date)
      const actor = admin(s.locationId)
      if (date < today()) conflict('that day has passed')
      const i = d.closures.findIndex((c) => c.slotId === slotId && c.onDate === date)
      if (isClosed) {
        if (i >= 0) d.closures[i]!.reason = reason?.trim().slice(0, 200) || null
        else d.closures.push({ slotId, onDate: date, reason: reason?.trim().slice(0, 200) || null, createdBy: actor })
      } else if (i >= 0) d.closures.splice(i, 1)
      event(null, isClosed ? 'schedule.closed' : 'schedule.reopened', actor, { slot: slotId, date })
      return isClosed
    },
  }
}

const addDay = (date: string, n: number) => {
  const t = new Date(`${date}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
