import { describe, expect, it } from 'vitest'
import { addDays, israelDate, previousPeriod, rangeFor } from '@/lib/time'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'

describe('Israel business days', () => {
  it('uses Israel time, not UTC, at the day boundary', () => {
    // 22:30 UTC on 1 Jan is 00:30 on 2 Jan in Israel (UTC+2).
    expect(israelDate(new Date('2026-01-01T22:30:00Z'))).toBe('2026-01-02')
    // Summer: UTC+3.
    expect(israelDate(new Date('2026-07-01T21:30:00Z'))).toBe('2026-07-02')
  })
  it('crosses DST without losing or doubling a day', () => {
    expect(addDays('2026-03-26', 2)).toBe('2026-03-28')
    expect(addDays('2026-10-24', 3)).toBe('2026-10-27')
  })
  it('builds inclusive ranges and the equally long previous period', () => {
    const now = new Date('2026-10-22T10:00:00Z')
    expect(rangeFor('7d', now)).toEqual({ from: '2026-10-16', to: '2026-10-22' })
    expect(rangeFor('mtd', now)).toEqual({ from: '2026-10-01', to: '2026-10-22' })
    expect(rangeFor('today', now)).toEqual({ from: '2026-10-22', to: '2026-10-22' })
    expect(previousPeriod({ from: '2026-10-16', to: '2026-10-22' })).toEqual({ from: '2026-10-09', to: '2026-10-15' })
  })
})

describe('money', () => {
  it('converts website shekels to integer agorot exactly', () => {
    expect(shekelsToAgorot(249.9)).toBe(24990)
    expect(shekelsToAgorot(0.1 + 0.2)).toBe(30)
    expect(shekelsToAgorot(1.005)).toBe(100) // float repr of 1.005 is 1.00499…; never more than one agora off
    expect(() => shekelsToAgorot(Number.NaN)).toThrow()
  })
  it('formats agorot as ILS', () => {
    expect(formatAgorot(24990)).toContain('249.9')
    expect(formatAgorot(24990, { whole: true })).toContain('250')
  })
})
