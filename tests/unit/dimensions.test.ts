import { describe, expect, it } from 'vitest'
import { EMPTY_DIMENSIONS, formatDimensions, parseDimensions } from '@/lib/inventory/dimensions'
import { parsePhotoFields } from '@/lib/inventory/ai-fields'

describe('item dimensions', () => {
  it('writes one line and reads the same four numbers back', () => {
    const text = formatDimensions({ length: '120', width: '60,5', height: '75', diameter: '', note: '' })
    expect(text).toBe('אורך 120 · רוחב 60.5 · גובה 75 ס״מ')
    expect(parseDimensions(text)).toEqual({ length: '120', width: '60.5', height: '75', diameter: '', note: '' })
  })
  it('keeps an old free-text value exactly as written', () => {
    expect(parseDimensions('120x60x75 ס״מ')).toEqual({ ...EMPTY_DIMENSIONS, note: '120x60x75 ס״מ' })
    expect(formatDimensions(parseDimensions('120x60x75 ס״מ'))).toBe('120x60x75 ס״מ')
  })
  it('keeps what it cannot place next to what it can', () => {
    const d = parseDimensions('קוטר 90 ס״מ · גובה מושב 45')
    expect(d).toMatchObject({ diameter: '90', note: 'גובה מושב 45' })
    expect(parseDimensions(formatDimensions(d))).toEqual(d)
  })
  it('drops non-numbers and is empty for nothing', () => {
    expect(formatDimensions({ ...EMPTY_DIMENSIONS, length: 'abc', height: '0' })).toBe('')
    expect(parseDimensions(null)).toEqual(EMPTY_DIMENSIONS)
  })
})

describe('photo AI measurements', () => {
  it('reads estimated cm and tolerates an answer without them', () => {
    const f = parsePhotoFields('{"title":"שולחן","category":"שולחן","colors":[],"material":"עץ","description":"","length_cm":160.4,"width_cm":80,"height_cm":-3,"diameter_cm":null,"suggested_price_ils":500}')
    expect(f?.dimensionsCm).toEqual({ length: 160, width: 80, height: null, diameter: null })
    expect(parsePhotoFields('{"title":"x","category":"y","colors":[],"material":"","description":"","suggested_price_ils":null}')?.dimensionsCm).toEqual({ length: null, width: null, height: null, diameter: null })
  })
})

describe('renewal level and place', () => {
  it('parses the five levels only and derives condition from them', async () => {
    const { parseRenewalLevel, CONDITION_OF_RENEWAL, renewalLabel } = await import('@/lib/inventory/renewal')
    expect(['0', '4', '', 'x', '5', '1.5'].map(parseRenewalLevel)).toEqual([0, 4, null, null, null, null])
    expect(CONDITION_OF_RENEWAL[3]).toBe('as_new')
    expect(renewalLabel(2, 'he')).toBe('2 · שיפוץ קל')
    expect(renewalLabel(null, 'he')).toBeNull()
  })
  it('reuses an existing location by name and never invents one for unknown', async () => {
    const { matchPlace } = await import('@/lib/inventory/places')
    const locs = [
      { id: 'a', name: 'מחסן יפו', kind: 'warehouse' },
      { id: 'b', name: 'מחסן', kind: 'warehouse' },
      { id: 'c', name: 'חנות', kind: 'shop' },
      { id: 'd', name: 'כספת ישנה', kind: 'zone', active: false },
    ]
    expect(matchPlace('warehouse', locs)?.id).toBe('b')
    expect(matchPlace('gallery', locs)?.id).toBe('c')
    expect(matchPlace('safe', locs)).toBeNull()
    expect(matchPlace('unknown', locs)).toBeNull()
  })
})
