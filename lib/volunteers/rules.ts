/**
 * JAS Volunteers — the rules both front ends show, pure and unit-tested. The
 * rules that must hold under concurrency (capacity, overlap, waitlist order)
 * are enforced in SQL (0005); these functions only describe state, so a
 * screen never disagrees with what the database will accept.
 */
import type { Activity, Signup, Shift, Skill, Slot, Volunteer } from './model'
import { LIVE } from './model'
import { minutesBetween, slotOf } from './time'

// ── Shift state ────────────────────────────────────────────────────────────

export interface ShiftCounts {
  confirmed: number
  waitlisted: number
  invited: number
  present: number
  absent: number
  unrecorded: number
}

export function countSignups(signups: readonly Signup[]): ShiftCounts {
  const c: ShiftCounts = { confirmed: 0, waitlisted: 0, invited: 0, present: 0, absent: 0, unrecorded: 0 }
  for (const s of signups) {
    if (s.status === 'confirmed') {
      c.confirmed++
      if (s.attendance === 'present') c.present++
      else if (s.attendance === 'absent') c.absent++
      else if (s.attendance === 'unknown') c.unrecorded++
    } else if (s.status === 'waitlisted') c.waitlisted++
    else if (s.status === 'invited') c.invited++
  }
  return c
}

export type ShiftPhase = 'cancelled' | 'closed' | 'full' | 'open' | 'underway' | 'finished'

/** What a volunteer can do with this shift right now. */
export function shiftPhase(shift: Pick<Shift, 'status' | 'startsAt' | 'endsAt' | 'capacity'>, activity: Pick<Activity, 'status' | 'signupClosesHours'>, confirmed: number, now = Date.now()): ShiftPhase {
  if (shift.status === 'cancelled' || activity.status === 'cancelled') return 'cancelled'
  const start = Date.parse(shift.startsAt)
  if (now >= Date.parse(shift.endsAt)) return 'finished'
  if (now >= start) return 'underway'
  if (activity.status !== 'published' || now > start - activity.signupClosesHours * 3_600_000) return 'closed'
  return confirmed >= shift.capacity ? 'full' : 'open'
}

export const placesLeft = (shift: Pick<Shift, 'capacity'>, confirmed: number) => Math.max(0, shift.capacity - confirmed)

/** Two shifts overlap when each starts before the other ends (touching end-to-start is fine). */
export const overlaps = (a: Pick<Shift, 'startsAt' | 'endsAt'>, b: Pick<Shift, 'startsAt' | 'endsAt'>) => Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)

export const shiftMinutes = (s: Pick<Shift, 'startsAt' | 'endsAt'>) => minutesBetween(s.startsAt, s.endsAt)

// ── Eligibility ────────────────────────────────────────────────────────────

export type Ineligible = 'inactive' | 'adults_only' | 'missing_skills' | 'overlap' | 'already'

/**
 * Why this volunteer cannot be on this shift (the SQL refuses the same things;
 * missing skills is advisory for staff and a filter for recommendations).
 */
export function ineligible(
  v: Pick<Volunteer, 'id' | 'status' | 'adult' | 'skills'>,
  shift: Shift,
  activity: Pick<Activity, 'adultsOnly' | 'requiredSkills'>,
  theirs: readonly { signup: Signup; shift: Shift }[],
): Ineligible[] {
  const out: Ineligible[] = []
  if (v.status !== 'active') out.push('inactive')
  if (activity.adultsOnly && !v.adult) out.push('adults_only')
  if (missingSkills(v.skills, activity.requiredSkills).length) out.push('missing_skills')
  if (theirs.some((t) => t.shift.id === shift.id && LIVE.includes(t.signup.status))) out.push('already')
  if (theirs.some((t) => t.shift.id !== shift.id && t.shift.status === 'open' && (t.signup.status === 'confirmed' || t.signup.status === 'waitlisted') && overlaps(t.shift, shift))) out.push('overlap')
  return out
}

export const missingSkills = (have: readonly Skill[], need: readonly Skill[]) => need.filter((s) => !have.includes(s))

// ── Recommendations ────────────────────────────────────────────────────────

export interface MatchReason {
  key: 'availability' | 'area' | 'skills' | 'experience_kind' | 'experience_project' | 'reliable' | 'new' | 'no_shows' | 'transport'
  weight: number
}

export interface Match {
  volunteerId: string
  score: number
  reasons: MatchReason[]
}

export interface History {
  /** Shifts this volunteer attended (present), with their activity. */
  attended: { activity: Pick<Activity, 'kind' | 'furnitureProjectId'> }[]
  noShows: number
}

/**
 * Score how well a volunteer fits a shift. Hard filters first (inactive,
 * adults only, missing a required skill, an overlapping shift, already on it):
 * those return null. Then: the shift falls in a slot they said they are free
 * (+3), in an area they chose (+2), they did this kind of work (+1) or this
 * project (+1) before, they turn up (+1) or have no history yet (+0.5), and
 * every no-show costs 1. Transport work favours people with a vehicle (+2).
 *
 * This only ranks people to INVITE. Nothing here assigns anyone.
 */
export function scoreMatch(
  v: Pick<Volunteer, 'id' | 'status' | 'adult' | 'skills' | 'areas' | 'availability' | 'transport'>,
  shift: Shift,
  activity: Pick<Activity, 'adultsOnly' | 'requiredSkills' | 'area' | 'kind' | 'furnitureProjectId'>,
  theirs: readonly { signup: Signup; shift: Shift }[],
  history: History,
): Match | null {
  if (ineligible(v, shift, activity, theirs).length) return null
  const reasons: MatchReason[] = []
  if (v.availability.includes(slotOf(shift.startsAt) as Slot)) reasons.push({ key: 'availability', weight: 3 })
  if (activity.area && v.areas.includes(activity.area)) reasons.push({ key: 'area', weight: 2 })
  if (activity.requiredSkills.length) reasons.push({ key: 'skills', weight: 1 })
  if (history.attended.some((a) => a.activity.kind === activity.kind)) reasons.push({ key: 'experience_kind', weight: 1 })
  if (activity.furnitureProjectId && history.attended.some((a) => a.activity.furnitureProjectId === activity.furnitureProjectId)) reasons.push({ key: 'experience_project', weight: 1 })
  if (activity.kind === 'transport' && v.transport !== 'none') reasons.push({ key: 'transport', weight: 2 })
  if (history.attended.length >= 2 && history.noShows === 0) reasons.push({ key: 'reliable', weight: 1 })
  if (history.attended.length === 0 && history.noShows === 0) reasons.push({ key: 'new', weight: 0.5 })
  if (history.noShows > 0) reasons.push({ key: 'no_shows', weight: -history.noShows })
  return { volunteerId: v.id, score: reasons.reduce((n, r) => n + r.weight, 0), reasons }
}

export const REASON_EN: Record<MatchReason['key'], string> = {
  availability: 'free at that time',
  area: 'prefers this area',
  skills: 'has the required skills',
  experience_kind: 'has done this work',
  experience_project: 'worked on this project',
  reliable: 'reliable',
  new: 'new volunteer',
  no_shows: 'missed shifts before',
  transport: 'has a vehicle',
}
export const REASON_HE: Record<MatchReason['key'], string> = {
  availability: 'בזמן שסימנת שנוח לך',
  area: 'באזור שבחרת',
  skills: 'מתאים לכישורים שלך',
  experience_kind: 'כבר עשית התנדבות כזאת',
  experience_project: 'השתתפת בפרויקט הזה',
  reliable: '',
  new: '',
  no_shows: '',
  transport: 'דורש רכב, ויש לך',
}

// ── Hours and milestones ───────────────────────────────────────────────────

/** Recorded hours: only present sign-ups with recorded minutes. Registering earns nothing. */
export const recordedMinutes = (signups: readonly Signup[]) => signups.reduce((n, s) => n + (s.status === 'confirmed' && s.attendance === 'present' && s.minutes != null ? s.minutes : 0), 0)

export const hoursText = (minutes: number) => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}:${String(m).padStart(2, '0')}` : String(h)
}

export interface Milestone {
  id: string
  he: string
  en: string
  reached: boolean
}

/** Participation milestones, from attended shifts and recorded hours only. */
export function milestones(attendedShifts: number, minutes: number): Milestone[] {
  const h = minutes / 60
  return [
    { id: 'first', he: 'ההתנדבות הראשונה', en: 'First shift', reached: attendedShifts >= 1 },
    { id: 'five', he: '5 משמרות', en: '5 shifts', reached: attendedShifts >= 5 },
    { id: 'ten_hours', he: '10 שעות התנדבות', en: '10 hours', reached: h >= 10 },
    { id: 'twenty_five', he: '25 משמרות', en: '25 shifts', reached: attendedShifts >= 25 },
    { id: 'fifty_hours', he: '50 שעות התנדבות', en: '50 hours', reached: h >= 50 },
  ]
}
