/**
 * Staff-side reads over the volunteer store: the directory with each person's
 * record, and invitation recommendations. Shared by the Command Center pages
 * and the assistant, so both rank and count the same way. Relative imports only.
 */
import type { Activity, Shift, Signup, Volunteer } from './model'
import { LIVE } from './model'
import { scoreMatch, type History, type Match } from './rules'
import type { VolunteerStore } from './store'

export interface PersonRecord {
  attended: number
  minutes: number
  noShows: number
  upcoming: number
  lastAttendedAt: string | null
}

const EMPTY: PersonRecord = { attended: 0, minutes: 0, noShows: 0, upcoming: 0, lastAttendedAt: null }

/** Per-volunteer record from sign-ups and their shifts. Hours are attended minutes only. */
export function personRecords(signups: readonly Signup[], shifts: readonly Shift[], now = Date.now()): Map<string, PersonRecord> {
  const sh = new Map(shifts.map((s) => [s.id, s]))
  const out = new Map<string, PersonRecord>()
  for (const s of signups) {
    const shift = sh.get(s.shiftId)
    if (!shift) continue
    const r = { ...(out.get(s.volunteerId) ?? EMPTY) }
    if (s.status === 'confirmed' && s.attendance === 'present') {
      r.attended++
      r.minutes += s.minutes ?? 0
      if (!r.lastAttendedAt || shift.startsAt > r.lastAttendedAt) r.lastAttendedAt = shift.startsAt
    }
    if (s.status === 'confirmed' && s.attendance === 'absent') r.noShows++
    if ((s.status === 'confirmed' || s.status === 'waitlisted') && shift.status === 'open' && Date.parse(shift.endsAt) > now) r.upcoming++
    out.set(s.volunteerId, r)
  }
  return out
}

export const recordOf = (m: Map<string, PersonRecord>, id: string) => m.get(id) ?? EMPTY

export interface Recommendation extends Match {
  volunteer: Volunteer
}

/**
 * Who to INVITE to a shift, best fit first. Reads every active volunteer and
 * their sign-ups once. Recommending never assigns: an invitation still needs
 * the volunteer's own yes.
 */
export async function recommend(store: VolunteerStore, shift: Shift, activity: Activity, limit = 10): Promise<Recommendation[]> {
  const people = await store.listVolunteers({ statuses: ['active'], limit: 5000 })
  if (!people.length) return []
  const signups = await store.listSignups({ volunteerIds: people.map((p) => p.id), limit: 50_000 })
  const shifts = signups.length ? await store.listShifts({ ids: [...new Set(signups.map((s) => s.shiftId))] }) : []
  const activities = shifts.length ? await store.listActivities({ ids: [...new Set(shifts.map((s) => s.activityId))] }) : []
  const sh = new Map(shifts.map((s) => [s.id, s]))
  const act = new Map(activities.map((a) => [a.id, a]))
  const byPerson = new Map<string, { signup: Signup; shift: Shift }[]>()
  for (const s of signups) {
    const x = sh.get(s.shiftId)
    if (x) byPerson.set(s.volunteerId, [...(byPerson.get(s.volunteerId) ?? []), { signup: s, shift: x }])
  }
  const out: Recommendation[] = []
  for (const v of people) {
    const theirs = byPerson.get(v.id) ?? []
    const history: History = {
      attended: theirs.filter((t) => t.signup.status === 'confirmed' && t.signup.attendance === 'present').flatMap((t) => { const a = act.get(t.shift.activityId); return a ? [{ activity: a }] : [] }),
      noShows: theirs.filter((t) => t.signup.status === 'confirmed' && t.signup.attendance === 'absent').length,
    }
    // Someone who declined or cancelled this very shift is not asked again.
    if (theirs.some((t) => t.shift.id === shift.id && !LIVE.includes(t.signup.status))) continue
    const m = scoreMatch(v, shift, activity, theirs, history)
    if (m && m.score > 0) out.push({ ...m, volunteer: v })
  }
  return out.sort((a, b) => b.score - a.score || a.volunteer.fullName.localeCompare(b.volunteer.fullName)).slice(0, limit)
}
