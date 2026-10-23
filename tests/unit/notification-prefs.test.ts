import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, emailedTo, fromRow, shownTo } from '@/lib/notifications/prefs'
import { reportsDue } from '@/lib/notifications/schedule'

describe('notification preferences', () => {
  const muted = { ...DEFAULT_PREFS, mutedProducts: ['map' as const], minSeverity: 'warning' as const, emailAlerts: 'warning' as const }
  it('mutes products and severities, but never a critical alert', () => {
    expect(shownTo(muted, { product: 'map', severity: 'warning' })).toBe(false)
    expect(shownTo(muted, { product: 'website', severity: 'info' })).toBe(false)
    expect(shownTo(muted, { product: 'map', severity: 'critical' })).toBe(true)
  })
  it('emails only what the person opted into', () => {
    expect(emailedTo(DEFAULT_PREFS, { product: 'gift_cards', severity: 'critical' })).toBe(false)
    expect(emailedTo(muted, { product: 'gift_cards', severity: 'warning' })).toBe(true)
    expect(emailedTo(muted, { product: 'map', severity: 'warning' })).toBe(false)
    expect(emailedTo(muted, { product: 'map', severity: 'critical' })).toBe(true)
    expect(emailedTo({ ...muted, emailAlerts: 'critical' }, { product: 'website', severity: 'warning' })).toBe(false)
  })
  it('falls back to the defaults for a missing or bad row', () => {
    expect(fromRow(null)).toEqual(DEFAULT_PREFS)
    expect(fromRow({ muted_products: ['nope'], min_severity: 'info', email_alerts: 'off', email_report: 'off' })).toEqual(DEFAULT_PREFS)
  })
})

describe('report schedule (Israel calendar)', () => {
  it('daily every day, weekly on Sunday, monthly on the 1st', () => {
    expect(reportsDue(new Date('2026-10-22T18:00:00Z'))).toEqual({ day: '2026-10-22', kinds: ['daily'] }) // Thursday
    expect(reportsDue(new Date('2026-10-25T18:00:00Z')).kinds).toEqual(['daily', 'weekly']) // Sunday
    expect(reportsDue(new Date('2026-11-01T18:00:00Z')).kinds).toEqual(['daily', 'weekly', 'monthly']) // Sunday the 1st
  })
  it('uses the Israeli date, not UTC', () => {
    expect(reportsDue(new Date('2026-10-31T22:30:00Z')).day).toBe('2026-11-01')
  })
})
