import { describe, expect, it } from 'vitest'
import { afterQuietHours, inQuietHours, israelDay, israelTime, israelToUtc, reminderAt, shiftByDays, slotOf } from '@/lib/volunteers/time'

describe('volunteer time (Israel, DST)', () => {
  it('converts Israel wall time to UTC on both sides of the October 2026 DST change', () => {
    // Israel leaves DST on Sunday 25 Oct 2026 at 02:00 (UTC+3 → UTC+2).
    expect(israelToUtc('2026-10-24', '08:00')).toBe('2026-10-24T05:00:00.000Z')
    expect(israelToUtc('2026-10-26', '08:00')).toBe('2026-10-26T06:00:00.000Z')
    // Spring forward: Friday 27 Mar 2026 (UTC+2 → UTC+3).
    expect(israelToUtc('2026-03-26', '09:30')).toBe('2026-03-26T07:30:00.000Z')
    expect(israelToUtc('2026-03-28', '09:30')).toBe('2026-03-28T06:30:00.000Z')
  })

  it('round-trips and rejects malformed input', () => {
    const t = israelToUtc('2026-07-01', '16:45')!
    expect(israelDay(t)).toBe('2026-07-01')
    expect(israelTime(t)).toBe('16:45')
    expect(israelToUtc('2026-02-30', '10:00')).toBeNull()
    expect(israelToUtc('2026-01-01', '25:00')).toBeNull()
    expect(israelToUtc('tomorrow', '10:00')).toBeNull()
  })

  it('repeats a weekly shift at the same wall-clock time across DST', () => {
    const before = israelToUtc('2026-10-20', '08:00')!
    const after = shiftByDays(before, 7)
    expect(israelTime(after)).toBe('08:00')
    expect(israelDay(after)).toBe('2026-10-27')
    expect(Date.parse(after) - Date.parse(before)).toBe(7 * 86_400_000 + 3_600_000)
  })

  it('maps a shift to its availability slot by Israel time', () => {
    expect(slotOf(israelToUtc('2026-10-25', '08:00')!)).toBe('sun_morning')
    expect(slotOf(israelToUtc('2026-10-30', '13:00')!)).toBe('fri_afternoon')
    expect(slotOf(israelToUtc('2026-10-28', '18:00')!)).toBe('wed_evening')
  })

  it('keeps quiet hours 21:00–08:00 and moves reminders out of them', () => {
    expect(inQuietHours(Date.parse(israelToUtc('2026-10-27', '22:00')!))).toBe(true)
    expect(inQuietHours(Date.parse(israelToUtc('2026-10-27', '07:59')!))).toBe(true)
    expect(inQuietHours(Date.parse(israelToUtc('2026-10-27', '08:00')!))).toBe(false)
    expect(new Date(afterQuietHours(Date.parse(israelToUtc('2026-10-27', '23:10')!))).toISOString()).toBe(israelToUtc('2026-10-28', '08:00'))
    // Monday 07:00 shift → reminded Sunday 20:00; Monday 10:00 shift → Sunday 10:00.
    expect(new Date(reminderAt(israelToUtc('2026-11-02', '07:00')!)).toISOString()).toBe(israelToUtc('2026-11-01', '20:00'))
    expect(new Date(reminderAt(israelToUtc('2026-11-02', '10:00')!)).toISOString()).toBe(israelToUtc('2026-11-01', '10:00'))
    expect(new Date(reminderAt(israelToUtc('2026-11-02', '22:00')!)).toISOString()).toBe(israelToUtc('2026-11-01', '20:00'))
  })
})
