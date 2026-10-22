import type { Series } from '@/lib/analytics/model'
import { formatValue } from '@/lib/analytics/format'

const W = 600
const H = 140
const PAD_TOP = 6

/**
 * One series over the selected period: bars for this period, a dashed line for
 * the same day-offset in the previous period. Server-rendered SVG; each day has
 * a full-height hover target with a native tooltip. A day with no data (null)
 * draws nothing — it is not a zero.
 */
export function TrendChart({ series }: { series: Series }) {
  const pts = series.points
  const n = pts.length
  if (!n) return null
  const max = Math.max(0, ...pts.flatMap((p) => [p.value ?? 0, p.previous ?? 0]))
  const scale = (v: number) => (max > 0 ? H - (v / max) * (H - PAD_TOP) : H)
  const slot = W / n
  const gap = n > 45 ? 1 : 2
  const barW = Math.max(1, slot - gap)
  const hasPrev = pts.some((p) => p.previous != null)
  const line = pts
    .map((p, i) => (p.previous == null ? null : `${(i * slot + slot / 2).toFixed(1)},${scale(p.previous).toFixed(1)}`))
    .reduce<string[][]>((runs, xy) => {
      if (xy == null) runs.push([])
      else runs[runs.length - 1]!.push(xy)
      return runs
    }, [[]])
    .filter((r) => r.length > 1)
  const total = pts.reduce((s, p) => s + (p.value ?? 0), 0)
  const prevTotal = pts.reduce((s, p) => s + (p.previous ?? 0), 0)
  const summable = series.unit !== 'ratio'
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className="font-medium text-ink">{series.label}</span>
        <span className="flex items-center gap-3 text-meta text-muted">
          <span className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-forest/80" />This period{summable ? ` · ${formatValue(total, series.unit)}` : ''}</span>
          {hasPrev ? (
            <span className="flex items-center gap-1"><span aria-hidden className="inline-block w-3 border-t-2 border-dashed border-faint" />Previous{summable ? ` · ${formatValue(prevTotal, series.unit)}` : ''}</span>
          ) : null}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-32 w-full" role="img" aria-label={`${series.label}, daily, this period against the previous period`}>
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) =>
          p.value != null && p.value > 0 ? (
            <rect key={p.date} x={i * slot + gap / 2} y={scale(p.value)} width={barW} height={H - scale(p.value)} rx={Math.min(2, barW / 2)} className="fill-forest/80" />
          ) : null,
        )}
        {line.map((run, i) => (
          <polyline key={i} points={run.join(' ')} fill="none" className="stroke-faint" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        ))}
        {pts.map((p, i) => (
          <rect key={`hit-${p.date}`} x={i * slot} y={0} width={slot} height={H} fill="transparent" className="hover:fill-ink/5">
            <title>
              {`${p.date}: ${formatValue(p.value, series.unit)}${p.previousDate ? `\n${p.previousDate} (previous): ${formatValue(p.previous, series.unit)}` : ''}`}
            </title>
          </rect>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-meta text-faint">
        <span className="num">{pts[0]!.date}</span>
        <span className="num">max {formatValue(max, series.unit)}</span>
        <span className="num">{pts[n - 1]!.date}</span>
      </div>
    </figure>
  )
}
