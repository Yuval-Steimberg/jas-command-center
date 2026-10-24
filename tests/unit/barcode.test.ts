import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, QUIET_ZONE, barcodeSvg, encode128B, isEncodable } from '@/lib/inventory/barcode'

const sum = (w: number[]) => w.reduce((a, b) => a + b, 0)

describe('Code 128-B', () => {
  it('has 106 distinct symbols of 11 modules each (a typo in the table breaks one of these)', () => {
    expect(CODE128_PATTERNS).toHaveLength(106)
    expect(new Set(CODE128_PATTERNS).size).toBe(106)
    for (const p of CODE128_PATTERNS) expect(sum([...p].map(Number))).toBe(11)
  })

  it('is start + data + checksum + a 13-module stop', () => {
    expect(sum(encode128B('A'))).toBe(3 * 11 + 13)
    expect(sum(encode128B('JAS-000042'))).toBe((1 + 10 + 1) * 11 + 13)
  })

  it('computes the checksum from the spec ("AB" → 102)', () => {
    // 104 + 33·1 + 34·2 = 205; 205 mod 103 = 102, whose pattern is 411131.
    expect(encode128B('AB').slice(18, 24).join('')).toBe('411131')
  })

  it('refuses what it cannot encode instead of drawing nonsense', () => {
    expect(isEncodable('JAS-000042')).toBe(true)
    expect(isEncodable('')).toBe(false)
    expect(isEncodable('כיסא')).toBe(false)
    expect(() => encode128B('כיסא')).toThrow()
  })

  it('draws crisp bars after the quiet zone on a white ground', () => {
    const svg = barcodeSvg('JAS-000042')
    const modules = sum(encode128B('JAS-000042')) + QUIET_ZONE * 2
    expect(svg).toContain(`viewBox="0 0 ${modules} `)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain(`<rect x="${QUIET_ZONE}" y="0"`)
    expect(svg).toContain('fill="#fff"')
  })
})
