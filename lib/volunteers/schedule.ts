/**
 * Volunteer SCHEDULING (migration 0011): recurring weekly days at a location,
 * one-date absences and one-date assignments. Pure: the ONE definition of who
 * is coming on a date and how many are missing. The admin's weekly overview,
 * the day screen, the assistant and the volunteer's own list all read it, so
 * no two screens can disagree about a number.
 *
 * Shared by the Command Center and the volunteer app: relative imports only.
 */
import type { DayPart, Slot as AvailabilitySlot, VolunteerStatus } from './model'
import { DAYS, PART_HOURS } from './model'

// ── Rows (camelCase mirrors of the 0011 tables) ────────────────────────────

export interface SchedLocation {
  id: string
  slug: string
  name: string
  active: boolean
}

export interface SchedSlot {
  id: string
  locationId: string
  activity: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** 'HH:MM[:SS]' Israel wall clock, or null when not set. */
  startsAt: string | null
  endsAt: string | null
  /** Null = not set yet. Never treated as zero. */
  required: number | null
  active: boolean
  version: number
}

export interface SchedRegular {
  id: string
  slotId: string
  volunteerId: string
  startsOn: string
  /** The last date included, or null = open-ended. */
  endsOn: string | null
}

export interface SchedAbsence {
  id: string
  slotId: string
  volunteerId: string
  onDate: string
  source: 'volunteer' | 'admin'
  reason: string | null
  reportedBy: string
  createdAt: string
  withdrawnAt: string | null
}

export type AssignmentStatus = 'confirmed' | 'tentative'
export interface SchedAssignment {
  id: string
  slotId: string
  volunteerId: string
  onDate: string
  status: AssignmentStatus
  replacesVolunteerId: string | null
  note: string | null
  createdAt: string
  cancelledAt: string | null
}

export interface SchedClosure {
  slotId: string
  onDate: string
  reason: string | null
}

/** What a scheduler may see of a volunteer (the columns 0011 grants). */
export interface SchedVolunteer {
  id: string
  fullName: string
  phone: string | null
  availability: AvailabilitySlot[]
  status: VolunteerStatus
}

export interface ScheduleData {
  locations: SchedLocation[]
  slots: SchedSlot[]
  regulars: SchedRegular[]
  absences: SchedAbsence[]
  assignments: SchedAssignment[]
  closures: SchedClosure[]
  volunteers: SchedVolunteer[]
}

export const emptySchedule = (): ScheduleData => ({ locations: [], slots: [], regulars: [], absences: [], assignments: [], closures: [], volunteers: [] })

// ── Calendar dates (plain 'YYYY-MM-DD'; no time zone involved) ─────────────

export const WEEKDAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const
export const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s)
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
export function plusDays(date: string, n: number): string {
  const t = new Date(`${date}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
/** The Sunday that starts the (Israeli) week of a date. */
export const weekStart = (date: string) => plusDays(date, -weekdayOf(date))
/** "12.11" */
export const shortDate = (date: string) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`
export const dayLabelHe = (date: string) => `יום ${WEEKDAY_HE[weekdayOf(date)]} ${shortDate(date)}`
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

/** Every date in [from, to] on which the slot runs. */
export function datesOf(slot: Pick<SchedSlot, 'weekday'>, from: string, to: string): string[] {
  const out: string[] = []
  let d = plusDays(from, (slot.weekday - weekdayOf(from) + 7) % 7)
  while (d <= to) {
    out.push(d)
    d = plusDays(d, 7)
  }
  return out
}

/**
 * The week the overview opens on: this week, unless every operating day of it
 * has already passed (Thursday onwards for Mon–Wed), then next week.
 */
export function defaultWeek(today: string, slots: Pick<SchedSlot, 'weekday' | 'active'>[]): string {
  const days = slots.filter((s) => s.active).map((s) => s.weekday)
  const last = days.length ? Math.max(...days) : 6
  const start = weekStart(today)
  return weekdayOf(today) > last ? plusDays(start, 7) : start
}

// ── Who is coming ──────────────────────────────────────────────────────────

export const regularOn = (r: Pick<SchedRegular, 'startsOn' | 'endsOn'>, date: string) => r.startsOn <= date && (r.endsOn === null || r.endsOn >= date)

export interface PersonOnDay {
  volunteer: SchedVolunteer
  /** How they are on this date. */
  basis: 'regular' | 'assigned'
  regularId: string | null
  assignment: SchedAssignment | null
  /** A live absence for this date, or null. */
  absence: SchedAbsence | null
  /** Coming and counted: not absent, active account, and (if one-date) confirmed. */
  counted: boolean
  /** Why they are not counted, when they are not. */
  why: null | 'absent' | 'tentative' | 'inactive'
}

export interface Candidate {
  volunteer: SchedVolunteer
  /**
   * 'declared' = their profile says they are free that weekday at that time.
   * Self-declared and NOT verified for this date: a scheduler confirms by
   * asking. 'unknown' = no availability on file that matches.
   */
  availability: 'declared' | 'unknown'
  /** Weekdays of this location they are already a regular on (they know the place). */
  regularWeekdays: number[]
}

export interface DayView {
  slot: SchedSlot
  date: string
  closed: { reason: string | null } | null
  required: number | null
  /** Regulars of this date, coming or not. */
  regulars: PersonOnDay[]
  /** One-date assignments (replacements, extra hands), confirmed or tentative. */
  assigned: PersonOnDay[]
  /** Everyone with a live absence on this date (regulars and assigned alike). */
  absent: PersonOnDay[]
  /** Counted as coming. Never double-counts a person. */
  coming: number
  /** Asked, not yet confirmed. Not counted. */
  tentative: number
  /** max(0, required − coming); null when required is not set or the day is closed. */
  missing: number | null
  /** coming − required when above it. */
  surplus: number
  /** Possible replacements: active, not on this date already, not absent this date. Best first. */
  candidates: Candidate[]
  /** Candidates whose profile says they are free then. */
  declaredCandidates: number
}

const PART_OF = (hour: number): DayPart => (hour < PART_HOURS.afternoon[0] ? 'morning' : hour < PART_HOURS.evening[0] ? 'afternoon' : 'evening')

/** The availability slots ('tue_morning', …) a slot's hours touch. All three parts when hours are not set. */
export function availabilityKeys(slot: Pick<SchedSlot, 'weekday' | 'startsAt' | 'endsAt'>): AvailabilitySlot[] {
  const day = DAYS[slot.weekday]!
  if (!slot.startsAt || !slot.endsAt) return (['morning', 'afternoon', 'evening'] as const).map((p) => `${day}_${p}` as AvailabilitySlot)
  const from = Number(slot.startsAt.slice(0, 2))
  const to = Number(slot.endsAt.slice(0, 2)) + (Number(slot.endsAt.slice(3, 5)) > 0 ? 1 : 0)
  const parts = new Set<DayPart>()
  for (let h = from; h < Math.max(to, from + 1); h++) parts.add(PART_OF(h))
  return [...parts].map((p) => `${day}_${p}` as AvailabilitySlot)
}

export function buildDay(data: ScheduleData, slot: SchedSlot, date: string): DayView {
  const vol = new Map(data.volunteers.map((v) => [v.id, v]))
  const absences = data.absences.filter((a) => a.slotId === slot.id && a.onDate === date && !a.withdrawnAt)
  const absenceOf = new Map(absences.map((a) => [a.volunteerId, a]))
  const closure = data.closures.find((c) => c.slotId === slot.id && c.onDate === date) ?? null
  const seen = new Set<string>()

  const person = (v: SchedVolunteer, basis: PersonOnDay['basis'], regularId: string | null, assignment: SchedAssignment | null): PersonOnDay => {
    const absence = absenceOf.get(v.id) ?? null
    const why: PersonOnDay['why'] = v.status !== 'active' ? 'inactive' : absence ? 'absent' : assignment?.status === 'tentative' ? 'tentative' : null
    return { volunteer: v, basis, regularId, assignment, absence, counted: !closure && why === null, why }
  }

  const regulars: PersonOnDay[] = []
  for (const r of data.regulars) {
    if (r.slotId !== slot.id || !regularOn(r, date) || seen.has(r.volunteerId)) continue
    const v = vol.get(r.volunteerId)
    if (!v) continue
    seen.add(v.id)
    regulars.push(person(v, 'regular', r.id, null))
  }
  const assigned: PersonOnDay[] = []
  for (const a of data.assignments) {
    if (a.slotId !== slot.id || a.onDate !== date || a.cancelledAt || seen.has(a.volunteerId)) continue
    const v = vol.get(a.volunteerId)
    if (!v) continue
    seen.add(v.id)
    assigned.push(person(v, 'assigned', null, a))
  }
  const byName = (x: PersonOnDay, y: PersonOnDay) => x.volunteer.fullName.localeCompare(y.volunteer.fullName, 'he')
  regulars.sort(byName)
  assigned.sort(byName)

  const coming = [...regulars, ...assigned].filter((p) => p.counted).length
  const tentative = closure ? 0 : assigned.filter((p) => p.why === 'tentative').length
  const required = slot.required
  const missing = closure || required === null ? null : Math.max(0, required - coming)

  // Replacements: anyone active who is not already on this date (coming, asked or absent) and not absent at this slot that day.
  const keys = new Set(availabilityKeys(slot))
  const locationSlots = data.slots.filter((s) => s.locationId === slot.locationId && s.active)
  const candidates: Candidate[] = closure
    ? []
    : data.volunteers
        .filter((v) => v.status === 'active' && !seen.has(v.id) && !absenceOf.has(v.id) && !busyElsewhere(data, slot, v.id, date))
        .map((v) => ({
          volunteer: v,
          availability: v.availability.some((k) => keys.has(k)) ? ('declared' as const) : ('unknown' as const),
          regularWeekdays: locationSlots.filter((s) => s.id !== slot.id && data.regulars.some((r) => r.slotId === s.id && r.volunteerId === v.id && regularOn(r, date))).map((s) => s.weekday),
        }))
        .sort((x, y) => rank(x) - rank(y) || x.volunteer.fullName.localeCompare(y.volunteer.fullName, 'he'))

  return {
    slot, date, closed: closure ? { reason: closure.reason } : null, required,
    regulars, assigned, absent: [...regulars, ...assigned].filter((p) => p.absence),
    coming, tentative, missing, surplus: required !== null && !closure ? Math.max(0, coming - required) : 0,
    candidates, declaredCandidates: candidates.filter((c) => c.availability === 'declared').length,
  }
}

const rank = (c: Candidate) => (c.availability === 'declared' ? 0 : 2) + (c.regularWeekdays.length ? 0 : 1)

/** Scheduled (and not absent) at another slot that runs at the same time that date. */
function busyElsewhere(data: ScheduleData, slot: SchedSlot, volunteerId: string, date: string): boolean {
  return data.slots.some((s) => {
    if (s.id === slot.id || !s.active || s.weekday !== slot.weekday || !overlap(s, slot)) return false
    if (data.absences.some((a) => a.slotId === s.id && a.volunteerId === volunteerId && a.onDate === date && !a.withdrawnAt)) return false
    return data.regulars.some((r) => r.slotId === s.id && r.volunteerId === volunteerId && regularOn(r, date)) || data.assignments.some((a) => a.slotId === s.id && a.volunteerId === volunteerId && a.onDate === date && !a.cancelledAt)
  })
}
const overlap = (a: Pick<SchedSlot, 'startsAt' | 'endsAt'>, b: Pick<SchedSlot, 'startsAt' | 'endsAt'>) =>
  !a.startsAt || !a.endsAt || !b.startsAt || !b.endsAt || (a.startsAt < b.endsAt && b.startsAt < a.endsAt)

/** The location's operating days in [from, to], in date order. */
export function buildRange(data: ScheduleData, locationId: string, from: string, to: string): DayView[] {
  const out: DayView[] = []
  for (const s of data.slots) if (s.locationId === locationId && s.active) for (const d of datesOf(s, from, to)) out.push(buildDay(data, s, d))
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.slot.activity.localeCompare(b.slot.activity))
}

// ── The volunteer's own view ───────────────────────────────────────────────

export interface MyDay {
  slot: SchedSlot
  location: SchedLocation
  date: string
  basis: 'regular' | 'assigned'
  /** The live absence they reported (or the scheduler recorded), if any. */
  absence: SchedAbsence | null
  closed: { reason: string | null } | null
}

/**
 * A volunteer's scheduled dates in [from, to]: regular days and CONFIRMED
 * one-date assignments. A tentative assignment is not shown: the scheduler is
 * still asking, and a volunteer must never read "you are on" before it is so.
 */
export function myDays(data: ScheduleData, volunteerId: string, from: string, to: string): MyDay[] {
  const out: MyDay[] = []
  const seen = new Set<string>()
  for (const slot of data.slots) {
    const location = data.locations.find((l) => l.id === slot.locationId)
    if (!slot.active || !location?.active) continue
    for (const date of datesOf(slot, from, to)) {
      const key = `${slot.id}:${date}`
      const regular = data.regulars.some((r) => r.slotId === slot.id && r.volunteerId === volunteerId && regularOn(r, date))
      const assignment = data.assignments.find((a) => a.slotId === slot.id && a.volunteerId === volunteerId && a.onDate === date && !a.cancelledAt && a.status === 'confirmed')
      if ((!regular && !assignment) || seen.has(key)) continue
      seen.add(key)
      const closure = data.closures.find((c) => c.slotId === slot.id && c.onDate === date)
      out.push({
        slot, location, date, basis: regular ? 'regular' : 'assigned',
        absence: data.absences.find((a) => a.slotId === slot.id && a.volunteerId === volunteerId && a.onDate === date && !a.withdrawnAt) ?? null,
        closed: closure ? { reason: closure.reason } : null,
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** The weekdays a volunteer is a regular on now (for "your days: Monday, Wednesday"). */
export function myRegularWeekdays(data: ScheduleData, volunteerId: string, today: string): { slot: SchedSlot; location: SchedLocation }[] {
  return data.slots
    .filter((s) => s.active && data.regulars.some((r) => r.slotId === s.id && r.volunteerId === volunteerId && (r.endsOn === null || r.endsOn >= today)))
    .map((s) => ({ slot: s, location: data.locations.find((l) => l.id === s.locationId)! }))
    .filter((x) => x.location?.active)
    .sort((a, b) => a.slot.weekday - b.slot.weekday)
}

// ── Mapping a name typed by a person to a volunteer ────────────────────────

/** Hebrew-insensitive name normalisation: niqqud, geresh/quotes, punctuation and case removed. */
export const normName = (s: string) =>
  s.normalize('NFKD').replace(/[֑-ׇ]/g, '').replace(/["'׳״`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

/** Volunteers whose name matches what was typed: every typed word starts a word of the name. */
export function matchVolunteers<T extends { fullName: string }>(list: T[], query: string): T[] {
  const words = normName(query).split(' ').filter(Boolean)
  if (!words.length) return []
  return list.filter((v) => {
    const name = normName(v.fullName).split(' ')
    return words.every((w) => name.some((n) => n.startsWith(w)))
  })
}
