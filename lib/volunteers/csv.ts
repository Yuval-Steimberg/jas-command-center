/**
 * CSV exports of the volunteer report, built from the same VolunteerStats the
 * page shows, so an export equals the screen. Relative imports only.
 */
import type { VolunteerStats } from './analytics'
import type { PersonRecord } from './admin'

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const csv = (rows: unknown[][]) => `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
const hours = (m: number) => (m / 60).toFixed(2)
const ratio = (r: number | null) => (r == null ? '' : r.toFixed(3))

export function summaryCsv(s: VolunteerStats): string {
  return csv([
    ['metric', 'value', 'from', 'to'],
    ...([
      ['registered', s.registered], ['new_registrations', s.newRegistrations], ['active_90_days', s.active90], ['attendees', s.attendees],
      ['first_time', s.firstTime], ['returning', s.returning], ['retention_base', s.retention.base], ['retained', s.retention.kept], ['retention_rate', ratio(s.retention.rate)],
      ['shifts', s.shifts], ['capacity', s.capacity], ['signed_up', s.signedUp], ['waitlisted', s.waitlisted], ['attended', s.attended], ['no_shows', s.absent],
      ['excused', s.excused], ['attendance_not_recorded', s.unrecorded], ['attendance_rate', ratio(s.attendanceRate)], ['cancellations', s.cancellations],
      ['cancellation_rate', ratio(s.cancellationRate)], ['hours', hours(s.minutes)], ['utilization', ratio(s.utilization)], ['unfilled_places', s.unfilled], ['activities_completed', s.activitiesCompleted],
    ] as [string, unknown][]).map(([k, v]) => [k, v, s.range.from, s.range.to]),
  ])
}

export function dailyCsv(s: VolunteerStats): string {
  return csv([['day', 'signed_up', 'attended', 'hours'], ...s.daily.map((d) => [d.day, d.signedUp, d.attended, hours(d.minutes)])])
}

export function projectsCsv(s: VolunteerStats): string {
  return csv([['furniture_project_id', 'project', 'activities', 'shifts', 'signed_up', 'attended', 'volunteers', 'hours'], ...s.byProject.map((p) => [p.projectId ?? '', p.projectName ?? '(no project)', p.activities, p.shifts, p.signedUp, p.attended, p.volunteers, hours(p.minutes)])])
}

/** Per-person hours (personal data: the route requires volunteers:read_pii). */
export function peopleCsv(rows: { name: string; email: string | null; record: PersonRecord }[]): string {
  return csv([['name', 'email', 'shifts_attended', 'hours', 'no_shows', 'last_attended'], ...rows.map((r) => [r.name, r.email ?? '', r.record.attended, hours(r.record.minutes), r.record.noShows, r.record.lastAttendedAt ?? ''])])
}
