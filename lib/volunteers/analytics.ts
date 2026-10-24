/**
 * Volunteer figures, defined once. The Command Center dashboard, the reports
 * page and its CSV, the assistant and the project-report endpoint all read
 * `volunteerStats`, so no two screens can count differently.
 *
 * Three numbers are never mixed:
 *   signed up  — confirmed sign-ups (expected participants);
 *   waitlisted — waiting for a place;
 *   attended   — attendance recorded as present (actual participants).
 * Hours are attended minutes only. A shift whose attendance nobody recorded is
 * counted as "not recorded", never as attended or absent.
 */
import type { Activity, Shift, Signup, Volunteer } from './model'
import { addDays, israelDay } from './time'

export interface Range {
  /** Israel days, inclusive. */
  from: string
  to: string
}

export interface ProjectLine {
  projectId: string | null
  projectName: string | null
  activities: number
  shifts: number
  signedUp: number
  attended: number
  volunteers: number
  minutes: number
}

export interface VolunteerStats {
  range: Range
  registered: number
  newRegistrations: number
  /** Distinct volunteers with a recorded attendance in the last 90 days (as of now). */
  active90: number
  attendees: number
  firstTime: number
  returning: number
  /** Of the volunteers who attended in the previous, equally long period, how many attended again in this one. */
  retention: { base: number; kept: number; rate: number | null }
  shifts: number
  capacity: number
  signedUp: number
  waitlisted: number
  attended: number
  absent: number
  excused: number
  /** Confirmed for a shift that ended with no attendance recorded. */
  unrecorded: number
  attendanceRate: number | null
  cancellations: number
  cancellationRate: number | null
  minutes: number
  utilization: number | null
  /** Places still free on shifts in the range that have not started. */
  unfilled: number
  activitiesCompleted: number
  byProject: ProjectLine[]
  daily: { day: string; signedUp: number; attended: number; minutes: number }[]
}

const rate = (a: number, b: number) => (b > 0 ? a / b : null)

export function previousRange(r: Range): Range {
  const days = Math.round((Date.parse(`${r.to}T12:00:00Z`) - Date.parse(`${r.from}T12:00:00Z`)) / 86_400_000) + 1
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) }
}

export function volunteerStats(
  data: { volunteers: readonly Volunteer[]; activities: readonly Activity[]; shifts: readonly Shift[]; signups: readonly Signup[] },
  range: Range,
  now = Date.now(),
  filter: { projectId?: string | null } = {},
): VolunteerStats {
  const act = new Map(data.activities.map((a) => [a.id, a]))
  const inProject = (sh: Shift) => filter.projectId === undefined || (act.get(sh.activityId)?.furnitureProjectId ?? null) === filter.projectId
  const live = (sh: Shift) => sh.status === 'open' && act.get(sh.activityId)?.status !== 'cancelled' && act.get(sh.activityId)?.status !== 'draft'
  const dayOf = (sh: Shift) => israelDay(sh.startsAt)
  const inRange = (sh: Shift, r: Range) => dayOf(sh) >= r.from && dayOf(sh) <= r.to
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))
  const periodShifts = data.shifts.filter((s) => live(s) && inProject(s) && inRange(s, range))
  const periodIds = new Set(periodShifts.map((s) => s.id))
  const su = data.signups.filter((s) => periodIds.has(s.shiftId))
  const present = (s: Signup) => s.status === 'confirmed' && s.attendance === 'present'

  // First attendance ever, per volunteer (any project: "first-time" is about the person).
  const firstSeen = new Map<string, string>()
  for (const s of data.signups) {
    const sh = shiftById.get(s.shiftId)
    if (!sh || !present(s)) continue
    const d = dayOf(sh)
    if (!firstSeen.has(s.volunteerId) || d < firstSeen.get(s.volunteerId)!) firstSeen.set(s.volunteerId, d)
  }
  const attendees = new Set(su.filter(present).map((s) => s.volunteerId))
  const firstTime = [...attendees].filter((v) => { const f = firstSeen.get(v); return f !== undefined && f >= range.from && f <= range.to }).length

  const prev = previousRange(range)
  const prevIds = new Set(data.shifts.filter((s) => live(s) && inProject(s) && inRange(s, prev)).map((s) => s.id))
  const prevAttendees = new Set(data.signups.filter((s) => prevIds.has(s.shiftId) && present(s)).map((s) => s.volunteerId))
  const kept = [...prevAttendees].filter((v) => attendees.has(v)).length

  const since90 = israelDay(now - 90 * 86_400_000)
  const active90 = new Set(
    data.signups.filter((s) => { const sh = shiftById.get(s.shiftId); return sh && present(s) && inProject(sh) && dayOf(sh) >= since90 }).map((s) => s.volunteerId),
  ).size

  const confirmedOn = new Map<string, number>()
  for (const s of su) if (s.status === 'confirmed') confirmedOn.set(s.shiftId, (confirmedOn.get(s.shiftId) ?? 0) + 1)
  const signedUp = su.filter((s) => s.status === 'confirmed').length
  const attended = su.filter(present).length
  const absent = su.filter((s) => s.status === 'confirmed' && s.attendance === 'absent').length
  const excused = su.filter((s) => s.status === 'confirmed' && s.attendance === 'excused').length
  const unrecorded = su.filter((s) => s.status === 'confirmed' && s.attendance === 'unknown' && Date.parse(shiftById.get(s.shiftId)!.endsAt) <= now).length
  const cancellations = su.filter((s) => s.status === 'cancelled').length
  const capacity = periodShifts.reduce((n, s) => n + s.capacity, 0)
  const unfilled = periodShifts.filter((s) => Date.parse(s.startsAt) > now).reduce((n, s) => n + Math.max(0, s.capacity - (confirmedOn.get(s.id) ?? 0)), 0)
  const minutes = su.reduce((n, s) => n + (present(s) && s.minutes != null ? s.minutes : 0), 0)

  // An activity is completed in the range when its last live shift ended in it, and someone attended.
  const byActivity = new Map<string, Shift[]>()
  for (const s of data.shifts) if (live(s) && inProject(s)) byActivity.set(s.activityId, [...(byActivity.get(s.activityId) ?? []), s])
  let activitiesCompleted = 0
  for (const [, list] of byActivity) {
    const last = list.reduce((m, s) => (s.endsAt > m.endsAt ? s : m))
    const lastDay = israelDay(last.endsAt)
    if (Date.parse(last.endsAt) > now || lastDay < range.from || lastDay > range.to) continue
    const ids = new Set(list.map((s) => s.id))
    if (data.signups.some((s) => ids.has(s.shiftId) && present(s))) activitiesCompleted++
  }

  const projects = new Map<string, ProjectLine & { _v: Set<string>; _a: Set<string> }>()
  for (const sh of periodShifts) {
    const a = act.get(sh.activityId)!
    const key = a.furnitureProjectId ?? ''
    const p = projects.get(key) ?? { projectId: a.furnitureProjectId, projectName: a.furnitureProjectName, activities: 0, shifts: 0, signedUp: 0, attended: 0, volunteers: 0, minutes: 0, _v: new Set<string>(), _a: new Set<string>() }
    p.shifts++
    p._a.add(a.id)
    for (const s of su) {
      if (s.shiftId !== sh.id) continue
      if (s.status === 'confirmed') p.signedUp++
      if (present(s)) {
        p.attended++
        p.minutes += s.minutes ?? 0
        p._v.add(s.volunteerId)
      }
    }
    projects.set(key, p)
  }
  const byProject = [...projects.values()]
    .map(({ _v, _a, ...p }) => ({ ...p, volunteers: _v.size, activities: _a.size }))
    .sort((a, b) => b.minutes - a.minutes || b.signedUp - a.signedUp)

  const daily: VolunteerStats['daily'] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const ids = new Set(periodShifts.filter((s) => dayOf(s) === d).map((s) => s.id))
    const list = su.filter((s) => ids.has(s.shiftId))
    daily.push({ day: d, signedUp: list.filter((s) => s.status === 'confirmed').length, attended: list.filter(present).length, minutes: list.reduce((n, s) => n + (present(s) && s.minutes != null ? s.minutes : 0), 0) })
    if (daily.length > 400) break
  }

  const people = data.volunteers.filter((v) => v.status !== 'deleted')
  return {
    range,
    registered: people.length,
    newRegistrations: people.filter((v) => { const d = israelDay(v.createdAt); return d >= range.from && d <= range.to }).length,
    active90,
    attendees: attendees.size,
    firstTime,
    returning: attendees.size - firstTime,
    retention: { base: prevAttendees.size, kept, rate: rate(kept, prevAttendees.size) },
    shifts: periodShifts.length,
    capacity,
    signedUp,
    waitlisted: su.filter((s) => s.status === 'waitlisted').length,
    attended,
    absent,
    excused,
    unrecorded,
    attendanceRate: rate(attended, attended + absent),
    cancellations,
    cancellationRate: rate(cancellations, cancellations + signedUp),
    minutes,
    utilization: rate(signedUp, capacity),
    unfilled,
    activitiesCompleted,
    byProject,
    daily,
  }
}

export const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`)
