/**
 * Business-day arithmetic in Israel time (the business is in Tel Aviv; the
 * website's analytics bucket by Israel day too). Pure, unit-tested.
 */
export type LocalDate = string // YYYY-MM-DD
export interface DateRange {
  from: LocalDate
  to: LocalDate // inclusive
}
export const TZ = 'Asia/Jerusalem'

export function israelDate(at: Date = new Date()): LocalDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(`${d}T12:00:00Z`) // noon UTC never crosses a date boundary on DST change
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

export const PRESETS = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  mtd: 'Month to date',
  '90d': 'Last 90 days',
} as const
export type Preset = keyof typeof PRESETS

export function isPreset(v: unknown): v is Preset {
  return typeof v === 'string' && v in PRESETS
}

export function rangeFor(preset: Preset, now: Date = new Date()): DateRange {
  const today = israelDate(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case 'mtd':
      return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

/** The equally long period immediately before `r`. */
export function previousPeriod(r: DateRange): DateRange {
  const len = daysBetween(r.from, r.to) + 1
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) }
}
