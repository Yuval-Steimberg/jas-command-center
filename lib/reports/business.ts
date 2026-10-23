/**
 * The business report: daily / weekly / monthly summary built ONLY from what
 * the analytics workspace and the live alerts already hold. Pure, so the page,
 * the Markdown export and the tests read one model.
 *
 * It states facts and their sources. "Improved" / "declined" are comparisons
 * against the previous equal period; recommended actions are the open alerts'
 * own links plus the sources that could not be read. Nothing here estimates,
 * forecasts or invents an opportunity.
 */
import type { Alert } from '@/lib/alerts'
import type { HealthStatus } from '@/lib/integrations/types'
import { change, type AnalyticsReport, type Metric, type Section } from '@/lib/analytics/model'
import { formatMetricChange, formatValue } from '@/lib/analytics/format'

export const REPORT_KINDS = {
  daily: { label: 'Daily overview', preset: 'today' },
  weekly: { label: 'Weekly summary', preset: '7d' },
  monthly: { label: 'Monthly performance', preset: '30d' },
} as const
export type ReportKind = keyof typeof REPORT_KINDS
export const isReportKind = (v: unknown): v is ReportKind => typeof v === 'string' && Object.hasOwn(REPORT_KINDS, v)

export interface ReportLine {
  section: string
  label: string
  value: string
  change: string | null
  /** Shown next to the value: the metric is partial, estimated, or a "now" snapshot. */
  qualifier: string | null
}

export interface ReportAction {
  title: string
  detail: string
  href: string
  severity: Alert['severity'] | 'gap'
}

export interface BusinessReport {
  kind: ReportKind
  title: string
  period: string
  previous: string
  generatedAt: string
  sections: { title: string; lines: ReportLine[]; notes: string[] }[]
  improved: ReportLine[]
  declined: ReportLine[]
  problems: Alert[]
  actions: ReportAction[]
  gaps: { section: string; source: string; detail: string }[]
  health: SystemLine[]
}

export interface SystemLine {
  name: string
  status: HealthStatus
  detail: string | null
}

function line(s: Section, m: Metric): ReportLine {
  return {
    section: s.title,
    label: m.label,
    value: formatValue(m.value, m.unit),
    change: m.basis === 'period' ? formatMetricChange(m) : null,
    qualifier: m.quality === 'partial' ? 'partial data' : m.basis === 'now' ? 'current' : null,
  }
}

/** Movement worth a sentence: complete data on both sides, and at least 10% (or 2 pp for a ratio). */
function movement(m: Metric): number | null {
  if (m.basis !== 'period' || m.quality !== 'ok') return null
  const c = change(m)
  if (!c || c.delta === 0) return null
  const size = m.unit === 'ratio' ? Math.abs(c.delta) / 0.02 : c.relative == null ? null : Math.abs(c.relative) / 0.1
  if (size == null || size < 1) return null
  return (c.delta > 0) !== Boolean(m.lowerIsBetter) ? size : -size
}

export function buildBusinessReport(kind: ReportKind, analytics: AnalyticsReport, alerts: readonly Alert[], health: SystemLine[] = []): BusinessReport {
  const moves = analytics.sections.flatMap((s) => s.metrics.map((m) => ({ s, m, score: movement(m) }))).filter((x) => x.score != null)
  const gaps = analytics.sections.flatMap((s) => s.sources.filter((x) => x.state !== 'ok').map((x) => ({ section: s.title, source: x.label, detail: x.detail ?? x.state })))
  return {
    kind,
    title: REPORT_KINDS[kind].label,
    period: `${analytics.range.from} – ${analytics.range.to}`,
    previous: `${analytics.previous.from} – ${analytics.previous.to}`,
    generatedAt: analytics.generatedAt,
    sections: analytics.sections.map((s) => ({ title: s.title, lines: s.metrics.filter((m) => m.quality !== 'unavailable').map((m) => line(s, m)), notes: s.notes })),
    improved: moves.filter((x) => x.score! > 0).sort((a, b) => b.score! - a.score!).slice(0, 6).map((x) => line(x.s, x.m)),
    declined: moves.filter((x) => x.score! < 0).sort((a, b) => a.score! - b.score!).slice(0, 6).map((x) => line(x.s, x.m)),
    problems: [...alerts],
    actions: [
      ...alerts.filter((a) => a.severity !== 'info').map((a) => ({ title: a.title, detail: a.detail, href: a.href, severity: a.severity })),
      ...gaps.map((g) => ({ title: `Reconnect ${g.source}`, detail: `${g.section}: ${g.detail}. Numbers from it are missing from this report.`, href: '/integrations', severity: 'gap' as const })),
    ],
    gaps,
    health,
  }
}

const esc = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The same report as Markdown: pasteable into an email or a doc, with every gap stated. */
export function reportMarkdown(r: BusinessReport, baseUrl = ''): string {
  const out: string[] = [`# ${r.title}: ${r.period}`, '', `Compared with ${r.previous}. Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC by the JAS Command Center.`, '']
  const list = (title: string, lines: ReportLine[]) => {
    if (!lines.length) return
    out.push(`## ${title}`, '')
    for (const l of lines) out.push(`- ${l.section}: ${l.label} ${l.value}${l.change ? ` (${l.change})` : ''}`)
    out.push('')
  }
  list('Improved', r.improved)
  list('Declined', r.declined)
  if (r.problems.length) {
    out.push('## Problems', '')
    for (const p of r.problems) out.push(`- **${p.severity}** ${esc(p.title)}. ${esc(p.detail)}`)
    out.push('')
  }
  if (r.actions.length) {
    out.push('## Recommended next actions', '')
    for (const a of r.actions) out.push(`- ${esc(a.title)}: ${baseUrl}${a.href}`)
    out.push('')
  }
  if (r.health.length) {
    out.push('## System health', '')
    for (const h of r.health) out.push(`- ${h.name}: ${h.status}${h.detail ? `. ${esc(h.detail)}` : ''}`)
    out.push('')
  }
  for (const s of r.sections) {
    out.push(`## ${s.title}`, '')
    if (!s.lines.length) out.push('No data could be read for this period.', '')
    else {
      out.push('| Metric | Value | Change |', '| --- | --- | --- |')
      for (const l of s.lines) out.push(`| ${esc(l.label)}${l.qualifier ? ` (${l.qualifier})` : ''} | ${l.value} | ${l.change ?? ''} |`)
      out.push('')
    }
    for (const n of s.notes) out.push(`> ${esc(n)}`, '')
  }
  if (r.gaps.length) {
    out.push('## Not included', '')
    for (const g of r.gaps) out.push(`- ${g.section}, ${g.source}: ${esc(g.detail)}`)
    out.push('')
  }
  return out.join('\n')
}
