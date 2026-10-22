/**
 * CSV for the analytics workspace. Built from the same AnalyticsReport the page
 * renders, so an export never disagrees with the screen. Money is exported in
 * agorot (integers) with the unit in its own column: a spreadsheet must not
 * re-parse a formatted "₪1,234".
 */
import { change, type AnalyticsReport } from './model'

/** RFC 4180 quoting, plus a guard against formula injection (a cell starting with = + - @ runs in Excel). */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  // BOM so Excel opens Hebrew project names as UTF-8.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function metricsCsv(r: AnalyticsReport): string {
  const rows = r.sections.flatMap((s) =>
    s.metrics.map((m) => {
      const c = change(m)
      const src = s.sources.find((x) => x.key === m.source)
      return [
        s.title,
        m.id,
        m.label,
        m.basis,
        m.basis === 'period' ? r.range.from : null,
        m.basis === 'period' ? r.range.to : null,
        m.value,
        m.basis === 'period' ? m.previous : null,
        c?.delta ?? null,
        c?.relative ?? null,
        m.unit,
        m.quality,
        m.note ?? null,
        src?.label ?? m.source,
        src?.state ?? null,
        src?.checkedAt ?? null,
      ]
    }),
  )
  return toCsv(['section', 'metric_id', 'metric', 'basis', 'from', 'to', 'value', 'previous', 'change', 'change_ratio', 'unit', 'quality', 'note', 'source', 'source_state', 'source_checked_at'], rows)
}

export function dailyCsv(r: AnalyticsReport): string {
  const rows = r.sections.flatMap((s) => s.series.flatMap((se) => se.points.map((p) => [s.title, se.id, se.label, p.date, p.value, p.previousDate, p.previous, se.unit])))
  return toCsv(['section', 'series_id', 'series', 'date', 'value', 'previous_date', 'previous', 'unit'], rows)
}

export function tablesCsv(r: AnalyticsReport): string {
  const rows = r.sections.flatMap((s) => s.tables.flatMap((t) => t.rows.flatMap((row) => t.columns.slice(1).map((c) => [s.title, t.title, String(row[t.columns[0]!.key] ?? ''), c.label, row[c.key] ?? null, c.unit ?? null]))))
  return toCsv(['section', 'table', 'row', 'column', 'value', 'unit'], rows)
}
