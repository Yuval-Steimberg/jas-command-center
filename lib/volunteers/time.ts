/**
 * Israel wall-clock time for shifts. Shifts are stored as UTC instants
 * (timestamptz); people type and read them as Israel local time, which moves
 * between UTC+2 and UTC+3 twice a year. Every conversion goes through here so a
 * 08:00 shift is 08:00 on both sides of a DST change.
 */
import type { Day, DayPart, Slot } from './model'
import { DAYS, PART_HOURS } from './model'

export const TZ = 'Asia/Jerusalem'

const parts = (at: Date) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(at)) o[p.type] = p.value
  return o
}

/** Israel's offset from UTC at that instant, in ms (2h or 3h). */
export function israelOffsetMs(at: Date): number {
  const o = parts(at)
  const wall = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour), Number(o.minute), Number(o.second))
  return wall - Math.floor(at.getTime() / 1000) * 1000
}

/**
 * 'YYYY-MM-DD' + 'HH:MM' in Israel → ISO instant. Null for malformed input.
 * A time that does not exist (the hour skipped in spring) resolves forward, like a wall clock.
 */
export function israelToUtc(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [y, m, dd, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])]
  if (m < 1 || m > 12 || dd < 1 || dd > 31 || h > 23 || mi > 59) return null
  const guess = Date.UTC(y, m - 1, dd, h, mi)
  if (new Date(guess).getUTCDate() !== dd) return null
  let at = guess - israelOffsetMs(new Date(guess))
  const second = guess - israelOffsetMs(new Date(at))
  if (second !== at) at = second
  return new Date(at).toISOString()
}

/** The Israel calendar day of an instant, 'YYYY-MM-DD'. */
export function israelDay(at: string | number | Date = Date.now()): string {
  const o = parts(new Date(at))
  return `${o.year}-${o.month}-${o.day}`
}

/** 'HH:MM' in Israel. */
export function israelTime(at: string | number | Date): string {
  const o = parts(new Date(at))
  return `${o.hour}:${o.minute}`
}

export function israelHour(at: string | number | Date): number {
  return Number(parts(new Date(at)).hour)
}

const WEEKDAY: Record<string, Day> = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' }
export function israelWeekday(at: string | number | Date): Day {
  return WEEKDAY[parts(new Date(at)).weekday!] ?? 'sun'
}

/** Which availability slot a shift falls in (by its start, Israel time). */
export function slotOf(startsAt: string): Slot {
  const h = israelHour(startsAt)
  const part: DayPart = h < PART_HOURS.afternoon[0] ? 'morning' : h < PART_HOURS.evening[0] ? 'afternoon' : 'evening'
  return `${israelWeekday(startsAt)}_${part}`
}

export function addDays(day: string, n: number): string {
  const t = new Date(`${day}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** The same Israel wall-clock time `days` later (so a weekly 08:00 shift stays 08:00 across DST). */
export function shiftByDays(iso: string, days: number): string {
  return israelToUtc(addDays(israelDay(iso), days), israelTime(iso))!
}

export const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000)

/** "ראשון 26.10" style label in Hebrew, and the English equivalent. */
export function dayLabelHe(at: string): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' }).format(new Date(at))
}
export function dayLabelEn(at: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at))
}
export const timeRange = (a: string, b: string) => `${israelTime(a)}–${israelTime(b)}`

// ── Quiet hours ────────────────────────────────────────────────────────────

/** No message is sent 21:00–08:00 Israel time, except an urgent one (a cancellation or change within a day). */
export const QUIET_FROM = 21
export const QUIET_TO = 8

export function inQuietHours(at: number): boolean {
  const h = israelHour(at)
  return h >= QUIET_FROM || h < QUIET_TO
}

/** The first moment at or after `at` outside quiet hours. */
export function afterQuietHours(at: number): number {
  if (!inQuietHours(at)) return at
  const h = israelHour(at)
  const day = israelDay(at)
  const next = h >= QUIET_FROM ? addDays(day, 1) : day
  return Date.parse(israelToUtc(next, `${String(QUIET_TO).padStart(2, '0')}:00`)!)
}

/**
 * When to send the day-before reminder: 24h before the start, or 20:00 that
 * same evening when 24h-before lands in quiet hours. A Monday 07:00 shift is
 * reminded at 20:00 on Sunday; a Monday 22:00 shift at 20:00 on Sunday too.
 */
export function reminderAt(startsAt: string): number {
  const t = Date.parse(startsAt) - 24 * 3_600_000
  return inQuietHours(t) ? Date.parse(israelToUtc(israelDay(t), '20:00')!) : t
}

export { DAYS }
