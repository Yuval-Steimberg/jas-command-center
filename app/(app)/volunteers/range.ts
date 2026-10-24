import { addDays, israelDay, israelToUtc } from '@/lib/volunteers/time'
import type { Range } from '@/lib/volunteers/analytics'

const ok = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && israelToUtc(d, '12:00') !== null

/** ?from=&to= (Israel days, ≤ 366 days, may reach 90 days ahead for planned shifts), else the last `days` days. */
export function reportRange(sp: Record<string, string | undefined>, now = Date.now(), days = 30): { range: Range; error?: string } {
  const today = israelDay(now)
  const fallback = { from: addDays(today, -(days - 1)), to: today }
  if (!sp.from && !sp.to) return { range: fallback }
  if (!ok(sp.from) || !ok(sp.to)) return { range: fallback, error: 'Dates must be YYYY-MM-DD.' }
  if (sp.from > sp.to) return { range: fallback, error: 'The start is after the end.' }
  const span = Math.round((Date.parse(`${sp.to}T12:00:00Z`) - Date.parse(`${sp.from}T12:00:00Z`)) / 86_400_000) + 1
  if (span > 366) return { range: fallback, error: 'At most 366 days.' }
  if (sp.to > addDays(today, 90)) return { range: fallback, error: 'The end can be at most 90 days ahead.' }
  return { range: { from: sp.from, to: sp.to } }
}
