import { describe, expect, it } from 'vitest'
import { change, designAgentSection, furnitureSection, giftCardsSection, websiteSection, type AnalyticsReport } from '@/lib/analytics/model'
import { csvCell, dailyCsv, metricsCsv, tablesCsv } from '@/lib/analytics/csv'
import { analyticsRange } from '@/lib/analytics/range'
import { formatMetricChange } from '@/lib/analytics/format'
import { METRIC_BY_ID, METRICS } from '@/lib/metrics-catalog'
import { agentActivityFixture, giftSalesFixture, giftSummaryFixture, websiteSnapshotFixture } from '../fixtures/sources'
import { metricsSnapshot, type MetricsSnapshot } from '@/lib/integrations/website/contract'
import { giftCardSales, giftCardSummary } from '@/lib/integrations/gift-cards/contract'
import type { SourceResult } from '@/lib/integrations/types'
import type { FurnitureProject } from '@/lib/integrations/furniture/adapter'

const at = '2026-10-22T10:00:00Z'
const ok = <T>(data: T): SourceResult<T> => ({ state: 'ok', data, checkedAt: at, latencyMs: 5, source: 'test' })
const down: SourceResult<never> = { state: 'error', error: 'HTTP 500', checkedAt: at, latencyMs: 9 }
const unset: SourceResult<never> = { state: 'not_configured', missing: ['X'] }
const range = { from: '2026-10-21', to: '2026-10-22' }
const previous = { from: '2026-10-19', to: '2026-10-20' }

const web = (over: Partial<MetricsSnapshot> = {}) => ok(metricsSnapshot.parse({ ...websiteSnapshotFixture, ...over }))
const sales = ok(giftCardSales.parse(giftSalesFixture))
const summary = ok(giftCardSummary.parse(giftSummaryFixture))
const project = (over: Partial<FurnitureProject>): FurnitureProject => ({ id: 'p', name: 'רחוב הרצל', city: 'חולון', developer_name: null, start_date: null, archived: false, created_at: '2026-10-21T08:00:00Z', apartments: 10, apartmentsCompleted: 4, items: 50, itemsToCollect: 20, itemsCollected: 5, ...over })

function report(): AnalyticsReport {
  return {
    range,
    previous,
    generatedAt: at,
    sections: [
      websiteSection(web({ daily: [{ date: '2026-10-21', visitors: 3, sessions: 4, pageviews: 9, productViews: 1, addToCarts: 0, orders: 1, revenue: 249.9 }], dailyPrevious: [] } as Partial<MetricsSnapshot>)),
      giftCardsSection(sales, summary),
      furnitureSection(ok([project({}), project({ id: 'q', archived: true, created_at: '2026-10-19T08:00:00Z' })]), range, previous),
      designAgentSection(ok(agentActivityFixture('2026-10-21', '2026-10-22', 3)), ok(agentActivityFixture('2026-10-19', '2026-10-20', 1)), unset),
    ],
  }
}

describe('analytics model', () => {
  it('every metric and series it produces is in the catalogue', () => {
    const r = report()
    for (const s of r.sections) {
      for (const m of s.metrics) {
        expect(METRIC_BY_ID.get(m.id), m.id).toBeDefined()
        expect(METRIC_BY_ID.get(m.id)!.basis, m.id).toBe(m.basis)
        expect(METRIC_BY_ID.get(m.id)!.product).toBe(s.product)
      }
      for (const se of s.series) expect(METRIC_BY_ID.get(se.id), se.id).toBeDefined()
    }
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length)
  })

  it('a source that failed gives null and "unavailable", never zero', () => {
    for (const s of [websiteSection(down), giftCardsSection(down, down), furnitureSection(unset, range, previous), designAgentSection(down, down, down)]) {
      expect(s.metrics.length).toBeGreaterThan(0)
      for (const m of s.metrics) {
        expect(m.value, m.id).toBeNull()
        expect(m.quality, m.id).toBe('unavailable')
      }
      expect(s.sources.some((x) => x.state !== 'ok')).toBe(true)
    }
  })

  it('website ₪ becomes integer agorot and keeps the website availability label', () => {
    const s = websiteSection(web())
    expect(s.metrics.find((m) => m.id === 'web.revenue')).toMatchObject({ value: 49980, previous: 49980, quality: 'ok' })
    const partial = websiteSection(web({ kpis: { ...websiteSnapshotFixture.kpis, visitors: { value: 5, previous: 2, change: 1.5, delta: 3, status: 'ok', previousStatus: 'partial' } } } as Partial<MetricsSnapshot>))
    expect(partial.metrics.find((m) => m.id === 'web.visitors')).toMatchObject({ quality: 'partial', note: 'previous period tracking: partial' })
    const gone = websiteSection(web({ kpis: { ...websiteSnapshotFixture.kpis, sessions: { value: 0, previous: null, change: null, delta: null, status: 'unavailable', previousStatus: 'unavailable' } } } as Partial<MetricsSnapshot>))
    expect(gone.metrics.find((m) => m.id === 'web.sessions')).toMatchObject({ value: null, quality: 'unavailable' })
  })

  it('an older website deployment without daily data says so instead of drawing an empty chart', () => {
    const s = websiteSection(web({ daily: undefined, dailyPrevious: undefined } as Partial<MetricsSnapshot>))
    expect(s.series).toEqual([])
    expect(s.notes.join(' ')).toMatch(/daily breakdown/)
  })

  it('gift cards: period figures from the sales endpoint, liability from the summary, never mixed with the website', () => {
    const s = giftCardsSection(sales, summary)
    expect(s.metrics.find((m) => m.id === 'gift.faceValue')).toMatchObject({ value: 75000, previous: 0, basis: 'period' })
    expect(s.metrics.find((m) => m.id === 'gift.liability')).toMatchObject({ value: 45000, previous: null, basis: 'now' })
    expect(s.metrics.find((m) => m.id === 'gift.redemptionRate')!.value).toBeCloseTo(0.4)
    expect(s.series[0]!.points).toEqual([
      { date: '2026-10-21', value: 20000, previousDate: '2026-10-19', previous: 0 },
      { date: '2026-10-22', value: 55000, previousDate: '2026-10-20', previous: 0 },
    ])
    // The summary alone still gives the "now" numbers when the sales endpoint is not deployed yet.
    const half = giftCardsSection(down, summary)
    expect(half.metrics.find((m) => m.id === 'gift.liability')!.value).toBe(45000)
    expect(half.metrics.find((m) => m.id === 'gift.sold')!.quality).toBe('unavailable')
  })

  it('furniture: progress over active projects only; projects started counted by Israel day', () => {
    const s = furnitureSection(ok([project({}), project({ id: 'q', archived: true, created_at: '2026-10-19T22:30:00Z' })]), range, previous)
    expect(s.metrics.find((m) => m.id === 'furn.activeProjects')!.value).toBe(1)
    expect(s.metrics.find((m) => m.id === 'furn.collectionRate')!.value).toBe(0.25)
    // 22:30 UTC on 19 Oct is 20 Oct in Israel: previous period.
    expect(s.metrics.find((m) => m.id === 'furn.newProjects')).toMatchObject({ value: 1, previous: 1 })
  })

  it('design agent: a missing previous period is "partial", not a fake zero', () => {
    const s = designAgentSection(ok(agentActivityFixture('2026-10-21', '2026-10-22', 3)), down, unset)
    expect(s.metrics.find((m) => m.id === 'agent.versions')).toMatchObject({ value: 6, previous: null, quality: 'partial' })
    expect(s.series[0]!.points[0]!.previous).toBeNull()
  })
})

describe('change', () => {
  it('relative for amounts, percentage points for ratios, "new" from zero', () => {
    expect(change({ value: 150, previous: 100, unit: 'count' })).toEqual({ delta: 50, relative: 0.5 })
    expect(formatMetricChange({ value: 150, previous: 100, unit: 'count' })).toBe('+50%')
    expect(formatMetricChange({ value: 0.05, previous: 0.03, unit: 'ratio' })).toBe('+2 pp')
    expect(formatMetricChange({ value: 5, previous: 0, unit: 'count' })).toBe('new')
    expect(formatMetricChange({ value: 0, previous: 0, unit: 'count' })).toBe('0%')
    expect(formatMetricChange({ value: null, previous: 3, unit: 'count' })).toBeNull()
  })
})

describe('CSV export', () => {
  it('quotes, escapes and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(null)).toBe('')
  })

  it('exports exactly the metrics on screen, money in agorot, with source freshness', () => {
    const r = report()
    const csv = metricsCsv(r)
    expect(csv.startsWith('﻿section,metric_id,')).toBe(true)
    const lines = csv.trim().split('\r\n')
    expect(lines.length - 1).toBe(r.sections.reduce((n, s) => n + s.metrics.length, 0))
    expect(lines.find((l) => l.includes(',gift.faceValue,'))).toBe(`Gift cards,gift.faceValue,Face value sold,period,2026-10-21,2026-10-22,75000,0,75000,,agorot,ok,,Gift card daily sales,ok,${at}`)
    // A "now" metric has no previous value or period.
    expect(lines.find((l) => l.includes(',gift.liability,'))).toMatch(/^Gift cards,gift\.liability,Outstanding liability,now,,,45000,,,,agorot,/)
    // An unconfigured source exports an empty value, not 0.
    expect(lines.find((l) => l.includes(',agent.stuck,'))).toMatch(/,agent\.stuck,Stuck \(>10 min\),now,,,,,,,count,unavailable,/)
  })

  it('daily and breakdown exports', () => {
    const r = report()
    expect(dailyCsv(r)).toContain('Gift cards,gift.faceValue,Face value sold,2026-10-22,55000,2026-10-20,0,agorot')
    expect(tablesCsv(r)).toContain('Furniture collection,Active projects,רחוב הרצל,Collection,0.25,ratio')
  })
})

describe('analyticsRange', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  it('uses a valid custom range', () => {
    expect(analyticsRange({ from: '2026-09-01', to: '2026-09-30' }, now)).toMatchObject({ range: { from: '2026-09-01', to: '2026-09-30' }, custom: true, error: null })
  })
  it('refuses a bad custom range and falls back to the preset, saying why', () => {
    expect(analyticsRange({ from: '2026-09-30', to: '2026-09-01' }, now)).toMatchObject({ custom: false, error: 'The start date is after the end date.' })
    expect(analyticsRange({ from: '2026-10-01', to: '2026-10-30' }, now).error).toMatch(/future/)
    expect(analyticsRange({ from: '2024-01-01', to: '2026-10-01' }, now).error).toMatch(/at most/)
    expect(analyticsRange({ from: '2026-02-30', to: '2026-03-01' }, now).error).toMatch(/YYYY-MM-DD/)
    expect(analyticsRange({ range: '30d' }, now)).toMatchObject({ range: { from: '2026-09-23', to: '2026-10-22' }, custom: false, error: null })
  })
})
