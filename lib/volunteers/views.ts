/**
 * Shifts as both front ends show them: the shift, its activity, its counts and
 * what can be done with it now. Built from store reads, one query per table.
 */
import type { Activity, Shift, Signup } from './model'
import { countSignups, placesLeft, shiftPhase, type ShiftCounts, type ShiftPhase } from './rules'
import type { VolunteerStore } from './store'

export interface ShiftView {
  shift: Shift
  activity: Activity
  counts: ShiftCounts
  phase: ShiftPhase
  places: number
}

export function buildShiftViews(activities: readonly Activity[], shifts: readonly Shift[], signups: readonly Signup[], now = Date.now()): ShiftView[] {
  const act = new Map(activities.map((a) => [a.id, a]))
  const byShift = new Map<string, Signup[]>()
  for (const s of signups) byShift.set(s.shiftId, [...(byShift.get(s.shiftId) ?? []), s])
  const out: ShiftView[] = []
  for (const shift of shifts) {
    const activity = act.get(shift.activityId)
    if (!activity) continue
    const counts = countSignups(byShift.get(shift.id) ?? [])
    out.push({ shift, activity, counts, phase: shiftPhase(shift, activity, counts.confirmed, now), places: placesLeft(shift, counts.confirmed) })
  }
  return out.sort((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt))
}

/** Published activities' shifts that have not ended, within `days`. What a volunteer can browse. */
export async function loadUpcoming(store: VolunteerStore, now = Date.now(), days = 120): Promise<{ views: ShiftView[]; activities: Activity[] }> {
  const activities = await store.listActivities({ statuses: ['published'] })
  if (!activities.length) return { views: [], activities }
  const shifts = await store.listShifts({ activityIds: activities.map((a) => a.id), status: 'open', from: new Date(now).toISOString(), to: new Date(now + days * 86_400_000).toISOString() })
  const signups = shifts.length ? await store.listSignups({ shiftIds: shifts.map((s) => s.id), statuses: ['confirmed', 'waitlisted', 'invited'] }) : []
  return { views: buildShiftViews(activities, shifts, signups, now), activities }
}

/** One activity with all its shifts and sign-ups. */
export async function loadActivity(store: VolunteerStore, id: string, now = Date.now()) {
  const activity = await store.getActivity(id)
  if (!activity) return null
  const shifts = await store.listShifts({ activityIds: [id] })
  const signups = shifts.length ? await store.listSignups({ shiftIds: shifts.map((s) => s.id) }) : []
  return { activity, shifts, signups, views: buildShiftViews([activity], shifts, signups, now) }
}

/** A volunteer's own sign-ups with their shifts and activities. */
export async function loadMine(store: VolunteerStore, volunteerId: string) {
  const signups = await store.listSignups({ volunteerId })
  const shifts = signups.length ? await store.listShifts({ ids: [...new Set(signups.map((s) => s.shiftId))] }) : []
  const activities = shifts.length ? await store.listActivities({ ids: [...new Set(shifts.map((s) => s.activityId))] }) : []
  const sh = new Map(shifts.map((s) => [s.id, s]))
  const act = new Map(activities.map((a) => [a.id, a]))
  return signups
    .map((signup) => {
      const shift = sh.get(signup.shiftId)
      const activity = shift ? act.get(shift.activityId) : undefined
      return shift && activity ? { signup, shift, activity } : null
    })
    .filter((x): x is { signup: Signup; shift: Shift; activity: Activity } => x !== null)
    .sort((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt))
}
