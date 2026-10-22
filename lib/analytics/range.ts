import { addDays, daysBetween, israelDate, PRESETS, type DateRange } from '@/lib/time'
import { presetFrom, resolveRange } from '@/lib/range'

export const MAX_CUSTOM_DAYS = 366
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The analytics range: an explicit ?from=&to= (validated: real dates, from ≤ to,
 * not in the future, at most a year) or the shared preset. An invalid custom
 * range falls back to the preset and says why, rather than guessing.
 */
export function analyticsRange(
  sp: Record<string, string | string[] | undefined> | undefined,
  now: Date = new Date(),
): { range: DateRange; label: string; custom: boolean; error: string | null } {
  const from = typeof sp?.from === 'string' ? sp.from : null
  const to = typeof sp?.to === 'string' ? sp.to : null
  const preset = () => {
    const r = resolveRange(presetFrom(sp), now)
    return { range: { from: r.from, to: r.to }, label: PRESETS[r.preset] }
  }
  if (!from && !to) return { ...preset(), custom: false, error: null }
  const today = israelDate(now)
  const valid = (d: string | null): d is string => !!d && DAY.test(d) && addDays(d, 0) === d
  let error: string | null = null
  if (!valid(from) || !valid(to)) error = 'Dates must be YYYY-MM-DD.'
  else if (daysBetween(from, to) < 0) error = 'The start date is after the end date.'
  else if (to > today) error = 'The end date is in the future.'
  else if (daysBetween(from, to) + 1 > MAX_CUSTOM_DAYS) error = `A range can be at most ${MAX_CUSTOM_DAYS} days.`
  if (error) return { ...preset(), custom: false, error }
  return { range: { from: from!, to: to! }, label: `${from} – ${to}`, custom: true, error: null }
}
