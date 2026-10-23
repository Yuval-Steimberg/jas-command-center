import type { ReportKind } from '@/lib/reports/business'

/**
 * Which scheduled reports are due on a run, by the business's calendar
 * (Asia/Jerusalem): daily every day, weekly on Sunday (the Israeli week
 * starts then), monthly on the 1st. `day` is the de-duplication key: a cron
 * that fires twice on one day sends once.
 */
export function reportsDue(now: Date): { day: string; kinds: ReportKind[] } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const day = `${parts.year}-${parts.month}-${parts.day}`
  const kinds: ReportKind[] = ['daily']
  if (parts.weekday === 'Sun') kinds.push('weekly')
  if (parts.day === '01') kinds.push('monthly')
  return { day, kinds }
}
