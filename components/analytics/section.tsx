import { PlugZap, TriangleAlert } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { formatCell, formatMetricChange, formatValue } from '@/lib/analytics/format'
import { change, type Metric, type Section, type Table } from '@/lib/analytics/model'
import { TrendChart } from './trend-chart'

export function AnalyticsSection({ section, previousLabel }: { section: Section; previousLabel: string }) {
  const period = section.metrics.filter((m) => m.basis === 'period')
  const now = section.metrics.filter((m) => m.basis === 'now')
  return (
    <Card>
      <span id={section.product} className="block scroll-mt-20" />
      <CardHeader title={section.title} meta={<Sources section={section} />} />
      {section.sources.some((s) => s.state !== 'ok') ? (
        <CardBody className="flex flex-col gap-2 border-b border-line/70">
          {section.sources.filter((s) => s.state !== 'ok').map((s) => (
            <div key={s.key} role={s.state === 'error' ? 'alert' : undefined} className={cn('flex gap-2 rounded-md p-2.5 text-sm', s.state === 'error' ? 'border border-bad/30 bg-bad/5' : 'border border-dashed border-line bg-sunken/60')}>
              {s.state === 'error' ? <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <PlugZap aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              <div className="min-w-0">
                <span className="font-medium text-ink">{s.label}: {s.state === 'error' ? 'could not load' : 'not connected'}</span>
                <p className="break-words text-xs text-muted">{s.detail}</p>
              </div>
            </div>
          ))}
        </CardBody>
      ) : null}
      {period.length ? (
        <CardBody>
          <h3 className="mb-2 text-xs font-medium text-muted">This period vs {previousLabel}</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">{period.map((m) => <Tile key={m.id} m={m} />)}</div>
        </CardBody>
      ) : null}
      {now.length ? (
        <CardBody className="border-t border-line/70">
          <h3 className="mb-2 text-xs font-medium text-muted">Right now</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">{now.map((m) => <Tile key={m.id} m={m} />)}</div>
        </CardBody>
      ) : null}
      {section.series.length ? (
        <CardBody className="grid gap-5 border-t border-line/70 md:grid-cols-2">
          {section.series.map((s) => <TrendChart key={s.id} series={s} />)}
        </CardBody>
      ) : null}
      {section.tables.map((t) => (
        <CardBody key={t.id} className="border-t border-line/70">
          <DataTable table={t} />
        </CardBody>
      ))}
      {section.notes.length ? (
        <CardBody className="border-t border-line/70">
          <ul className="list-disc ps-5 text-xs text-muted">{section.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </CardBody>
      ) : null}
    </Card>
  )
}

function Sources({ section }: { section: Section }) {
  return (
    <span className="flex flex-wrap gap-x-3">
      {section.sources.map((s) => (
        <span key={s.key} title={s.detail ?? undefined}>
          {s.label}: {s.state === 'ok' ? `updated ${timeAgo(s.checkedAt)}${s.latencyMs != null ? ` · ${s.latencyMs} ms` : ''}` : s.state === 'error' ? 'failed' : 'not connected'}
        </span>
      ))}
    </span>
  )
}

function Tile({ m }: { m: Metric }) {
  const ch = m.basis === 'period' ? formatMetricChange(m) : null
  const delta = m.basis === 'period' ? change(m)?.delta ?? 0 : 0
  const dir = Math.sign(delta)
  const good = dir === 0 ? null : m.lowerIsBetter ? dir < 0 : dir > 0
  return (
    <div className="min-w-0 rounded-md border border-line/70 bg-ground/40 px-3 py-2.5" title={m.note}>
      <div className="truncate text-xs text-muted">{m.label}</div>
      <div className="num mt-0.5 text-lg font-semibold leading-tight text-ink">{m.quality === 'unavailable' ? <span className="text-faint">—</span> : formatValue(m.value, m.unit)}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-muted">
        {ch ? <span className={cn('num font-medium', good === true && 'text-ok', good === false && 'text-bad')}>{ch}</span> : null}
        {m.basis === 'period' && m.previous != null ? <span className="num">was {formatValue(m.previous, m.unit)}</span> : null}
        {m.quality === 'unavailable' ? <span>unavailable</span> : m.quality === 'partial' ? <span className="text-warn">partial</span> : null}
      </div>
    </div>
  )
}

function DataTable({ table }: { table: Table }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted">{table.title}</h3>
      {table.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-xs text-muted">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c.key} className={cn('py-1 font-medium', i === 0 ? 'text-start' : 'text-end')}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {table.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line/50">
                  {table.columns.map((c, i) => (
                    <td key={c.key} className={cn('whitespace-nowrap py-1.5', i === 0 ? 'pe-3 text-start' : 'ps-3 text-end')} dir={i === 0 ? 'auto' : undefined}>
                      {formatCell(r[c.key] ?? null, c.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">Nothing in this period.</p>
      )}
    </div>
  )
}
