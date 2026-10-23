import { describe, expect, it } from 'vitest'
import { buildBusinessReport, reportMarkdown } from '@/lib/reports/business'
import type { AnalyticsReport, Metric, Section } from '@/lib/analytics/model'
import type { Alert } from '@/lib/alerts'

const m = (id: string, label: string, value: number | null, previous: number | null, extra: Partial<Metric> = {}): Metric => ({ id, label, unit: 'count', basis: 'period', value, previous, quality: 'ok', source: 's', ...extra })
const section = (over: Partial<Section>): Section => ({ product: 'website', title: 'Website & shop', sources: [{ key: 's', label: 'Website API', state: 'ok', detail: null, checkedAt: null, latencyMs: null }], metrics: [], series: [], tables: [], notes: [], ...over })
const report = (sections: Section[]): AnalyticsReport => ({ range: { from: '2026-10-16', to: '2026-10-22' }, previous: { from: '2026-10-09', to: '2026-10-15' }, generatedAt: '2026-10-23T06:00:00Z', sections })
const alert: Alert = { id: 'gift:undelivered', severity: 'critical', product: 'gift_cards', title: '2 active gift card(s) not delivered', detail: 'failed: 2', href: '/gift-cards' }

describe('business report', () => {
  it('lists real movement only: complete data, at least 10% (2 pp for rates), direction-aware', () => {
    const r = buildBusinessReport('weekly', report([section({ metrics: [
      m('a', 'Visitors', 120, 100),
      m('b', 'Sessions', 105, 100),
      m('c', 'Payment failures', 6, 2, { lowerIsBetter: true }),
      m('d', 'Conversion', 0.05, 0.02, { unit: 'ratio' }),
      m('e', 'Page views', 300, 100, { quality: 'partial' }),
      m('f', 'Liability', 5000, null, { basis: 'now', unit: 'agorot' }),
    ] })]), [])
    expect(r.improved.map((l) => l.label)).toEqual(['Visitors', 'Conversion']) // +20% outranks +3 pp (1.5× the 2 pp floor)
    expect(r.declined.map((l) => l.label)).toEqual(['Payment failures'])
    expect(r.sections[0]!.lines.find((l) => l.label === 'Page views')!.qualifier).toBe('partial data')
    expect(r.sections[0]!.lines.find((l) => l.label === 'Liability')!).toMatchObject({ change: null, qualifier: 'current' })
  })

  it('turns open problems and unreadable sources into actions, and never shows a missing source as zero', () => {
    const down = section({ product: 'gift_cards', title: 'Gift cards', sources: [{ key: 's', label: 'Gift card API', state: 'not_configured', detail: 'needs GIFT_CARDS_URL', checkedAt: null, latencyMs: null }], metrics: [m('g', 'Cards sold', null, null, { quality: 'unavailable' })] })
    const r = buildBusinessReport('daily', report([down]), [alert, { ...alert, id: 'x', severity: 'info', title: 'fyi' }])
    expect(r.actions.map((a) => a.title)).toEqual(['2 active gift card(s) not delivered', 'Reconnect Gift card API'])
    expect(r.sections[0]!.lines).toEqual([])
    const md = reportMarkdown(r, 'https://cc.example')
    expect(md).toContain('https://cc.example/gift-cards')
    expect(md).toContain('No data could be read for this period.')
    expect(md).toContain('## Not included')
    expect(md).not.toMatch(/Cards sold/)
  })
})
