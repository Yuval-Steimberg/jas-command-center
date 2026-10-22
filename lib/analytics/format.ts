import { formatAgorot } from '@/lib/money'
import { formatCount, formatPct } from '@/lib/format'
import { change, type Cell, type Metric, type Unit } from './model'

export function formatValue(v: number | null | undefined, unit: Unit | undefined): string {
  if (v == null) return '—'
  if (unit === 'agorot') return formatAgorot(v, { whole: Math.abs(v) >= 100_000 })
  if (unit === 'ratio') return formatPct(v)
  if (unit === 'count') return formatCount(v)
  return String(v)
}

export const formatCell = (v: Cell, unit?: Unit) => (typeof v === 'number' || v == null ? formatValue(v, unit) : v)

/** "+12.5%" for amounts and counts, "+1.2 pp" for ratios, "new" when the previous period was zero. */
export function formatMetricChange(m: Pick<Metric, 'value' | 'previous' | 'unit'>): string | null {
  const c = change(m)
  if (!c) return null
  if (m.unit === 'ratio') {
    const pp = Math.round(c.delta * 1000) / 10
    return `${pp > 0 ? '+' : ''}${pp} pp`
  }
  if (c.relative == null) return c.delta === 0 ? '0%' : 'new'
  const pct = Math.round(c.relative * 1000) / 10
  return `${pct > 0 ? '+' : ''}${pct}%`
}
