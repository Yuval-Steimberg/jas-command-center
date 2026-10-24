import { describe, expect, it } from 'vitest'
import { personRecords } from '@/lib/volunteers/admin'
import { peopleCsv, projectsCsv } from '@/lib/volunteers/csv'
import type { Shift, Signup } from '@/lib/volunteers/model'

const shift = (id: string, startsAt: string, endsAt: string, status: Shift['status'] = 'open'): Shift =>
  ({ id, activityId: 'a', label: null, role: null, startsAt, endsAt, capacity: 5, minVolunteers: 0, status, checkinCode: 'c', version: 1, createdAt: startsAt, updatedAt: startsAt })
const signup = (id: string, shiftId: string, volunteerId: string, status: Signup['status'], attendance: Signup['attendance'] = 'unknown', minutes: number | null = null): Signup =>
  ({ id, shiftId, volunteerId, status, source: 'self', queuedAt: null, invitedBy: null, cancelledAt: null, cancelReason: null, attendance, checkInAt: null, checkOutAt: null, minutes, attendanceMethod: null, attendanceBy: null, attendanceNote: null, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' })

describe('volunteer records and exports', () => {
  it('counts hours from attendance only, and upcoming from live shifts only', () => {
    const now = Date.parse('2026-06-15T12:00:00Z')
    const shifts = [shift('past', '2026-06-01T08:00:00Z', '2026-06-01T12:00:00Z'), shift('next', '2026-06-20T08:00:00Z', '2026-06-20T12:00:00Z'), shift('gone', '2026-06-21T08:00:00Z', '2026-06-21T12:00:00Z', 'cancelled')]
    const r = personRecords([
      signup('1', 'past', 'v', 'confirmed', 'present', 240),
      signup('2', 'past', 'w', 'confirmed', 'absent'),
      signup('3', 'past', 'x', 'confirmed'),
      signup('4', 'next', 'v', 'confirmed'),
      signup('5', 'gone', 'v', 'confirmed'),
      signup('6', 'next', 'x', 'cancelled'),
    ], shifts, now)
    expect(r.get('v')).toEqual({ attended: 1, minutes: 240, noShows: 0, upcoming: 1, lastAttendedAt: '2026-06-01T08:00:00Z' })
    expect(r.get('w')!.noShows).toBe(1)
    // Signed up for a finished shift with nothing recorded: no hours, no attendance.
    expect(r.get('x')).toEqual({ attended: 0, minutes: 0, noShows: 0, upcoming: 0, lastAttendedAt: null })
  })

  it('escapes CSV cells, including spreadsheet formulas', () => {
    const out = peopleCsv([{ name: '=HYPERLINK("x")', email: 'a,b@x.com', record: { attended: 1, minutes: 90, noShows: 0, upcoming: 0, lastAttendedAt: null } }])
    const line = out.split('\r\n')[1]!
    expect(line.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true)
    expect(line).toContain('"a,b@x.com"')
    expect(line).toContain('1.50')
    expect(projectsCsv({ byProject: [{ projectId: null, projectName: null, activities: 1, shifts: 2, signedUp: 3, attended: 2, volunteers: 2, minutes: 60 }] } as never)).toContain('(no project),1,2,3,2,2,1.00')
  })
})
