import { volunteerStats, type VolunteerStats } from '@/lib/volunteers/analytics'
import type { Activity, Shift, Signup, Volunteer } from '@/lib/volunteers/model'
import type { DateRange } from '@/lib/time'
import type { Basis, Metric, Section, SourceInfo, Unit } from './model'

/**
 * Volunteers in the analytics workspace. Pure, like the other sections, and a
 * thin view over `volunteerStats` — the same function behind /volunteers/reports
 * — so the two screens cannot disagree. Signed up (expected), attended (actual)
 * and registered are separate metrics and are never added together.
 */
export interface VolunteerData {
  volunteers: Volunteer[]
  activities: Activity[]
  shifts: Shift[]
  signups: Signup[]
}

export type VolunteerRead = { state: 'ok'; data: VolunteerData; checkedAt: string } | { state: 'not_configured' | 'error'; detail: string }

function source(r: VolunteerRead): SourceInfo {
  return r.state === 'ok'
    ? { key: 'volunteers', label: 'Volunteer records', state: 'ok', detail: 'cc_volunteers, cc_vol_shifts, cc_vol_signups (migration 0005)', checkedAt: r.checkedAt, latencyMs: null }
    : { key: 'volunteers', label: 'Volunteer records', state: r.state, detail: r.detail, checkedAt: null, latencyMs: null }
}

const hours = (minutes: number) => Math.round(minutes / 6) / 10

export function volunteersSection(r: VolunteerRead, range: DateRange, previous: DateRange, now = Date.now()): Section {
  const sec: Section = { product: 'volunteers', title: 'Volunteers', sources: [source(r)], metrics: [], series: [], tables: [], notes: [] }
  const cur: VolunteerStats | null = r.state === 'ok' ? volunteerStats(r.data, range, now) : null
  const prev: VolunteerStats | null = r.state === 'ok' ? volunteerStats(r.data, previous, now) : null
  const q = cur ? 'ok' : 'unavailable'
  const m = (id: string, label: string, unit: Unit, basis: Basis, pick: (s: VolunteerStats) => number | null, extra: Partial<Metric> = {}): Metric => ({
    id, label, unit, basis, value: cur ? pick(cur) : null, previous: basis === 'now' || !prev ? null : pick(prev), quality: q, source: 'volunteers', ...extra,
  })
  sec.metrics.push(
    m('vol.signedUp', 'Signed up (expected)', 'count', 'period', (s) => s.signedUp, { note: 'Confirmed places on shifts in the period. Expected, not attended.' }),
    m('vol.attended', 'Attended (actual)', 'count', 'period', (s) => s.attended),
    m('vol.hours', 'Volunteer hours', 'count', 'period', (s) => hours(s.minutes), { note: 'Recorded attendance only.' }),
    m('vol.attendees', 'Volunteers who came', 'count', 'period', (s) => s.attendees),
    m('vol.firstTime', 'First-time volunteers', 'count', 'period', (s) => s.firstTime),
    m('vol.attendanceRate', 'Showed up', 'ratio', 'period', (s) => s.attendanceRate, { note: 'Attended ÷ (attended + absent). Excused and not-recorded are left out.' }),
    m('vol.cancellations', 'Cancellations', 'count', 'period', (s) => s.cancellations, { lowerIsBetter: true }),
    m('vol.newRegistrations', 'New registrations', 'count', 'period', (s) => s.newRegistrations),
    m('vol.unrecorded', 'Attendance not recorded', 'count', 'period', (s) => s.unrecorded, { lowerIsBetter: true, note: 'Confirmed on a shift that ended with nothing recorded: neither attended nor absent.' }),
    m('vol.registered', 'Registered volunteers', 'count', 'now', (s) => s.registered),
    m('vol.active90', 'Active in the last 90 days', 'count', 'now', (s) => s.active90),
  )
  if (cur && prev) {
    sec.series.push({
      id: 'vol.daily',
      label: 'Attended per day',
      unit: 'count',
      points: cur.daily.map((d, i) => ({ date: d.day, value: d.attended, previousDate: prev.daily[i]?.day ?? null, previous: prev.daily[i]?.attended ?? null })),
    })
    sec.tables.push({
      id: 'vol.projects',
      title: 'By furniture project (period)',
      columns: [
        { key: 'project', label: 'Project' },
        { key: 'shifts', label: 'Shifts', unit: 'count' },
        { key: 'signedUp', label: 'Signed up', unit: 'count' },
        { key: 'attended', label: 'Attended', unit: 'count' },
        { key: 'volunteers', label: 'Volunteers', unit: 'count' },
        { key: 'hours', label: 'Hours', unit: 'count' },
      ],
      rows: cur.byProject.map((p) => ({ project: p.projectName ?? (p.projectId ? 'Unnamed project' : 'Not linked to a project'), shifts: p.shifts, signedUp: p.signedUp, attended: p.attended, volunteers: p.volunteers, hours: hours(p.minutes) })),
    })
  }
  sec.notes.push('Hours and "attended" come only from recorded attendance. A sign-up is an expectation, never an hour.')
  return sec
}
