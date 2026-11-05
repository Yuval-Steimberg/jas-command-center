import { describe, expect, it } from 'vitest'
import { findDuplicates, stems, type DuplicateCandidate } from '@/lib/inventory/duplicates'
import { differenceHash } from '@/lib/inventory/photo-hash'

const item = (id: string, over: Partial<DuplicateCandidate>): DuplicateCandidate => ({
  id, sku: `JAS-${id.padStart(4, '0')}`, title: '', category: null, colors: null, material: null, description: null,
  photoUrl: null, photoHash: null, status: 'in_storage', locationId: null, ...over,
})

const stock = [
  item('1', { title: 'כורסת עור חומה', category: 'כורסה', colors: 'חום', material: 'עור' }),
  item('2', { title: 'כיסא עץ', category: 'כיסא', colors: 'חום', material: 'עץ' }),
  item('3', { title: 'כיסא עץ', category: 'כיסא', colors: 'לבן', material: 'עץ' }),
  item('4', { title: 'שידת מגירות וינטג׳', category: 'שידה', colors: 'ירוק', material: 'עץ אלון' }),
  item('5', { title: 'כורסת עור חומה', category: 'כורסה', colors: 'חום', material: 'עור', status: 'sold' }),
]

describe('stems', () => {
  it('folds construct forms, final letters, niqqud and geresh', () => {
    expect([...stems('כורסת')]).toEqual([...stems('כורסה')])
    expect(stems('כּוּרְסָא').has('כורס')).toBe(true)
    expect(stems('שולחן').has('שולחנ')).toBe(true)
    expect(stems('וינטג׳').has('וינטג')).toBe(true)
  })
})

describe('duplicate warning', () => {
  it('finds an imported item (no photo hash) by name and details', () => {
    const found = findDuplicates({ title: 'כורסה מעור חום', category: 'כורסה', colors: 'חום', material: 'עור' }, stock)
    // Worded differently (כורסה / כורסת, חום / חומה): two shared words plus category, colour and material agreeing.
    expect(found.map((f) => f.item.id)).toEqual(['1'])
    const exact = findDuplicates({ title: 'כורסת עור חומה', category: 'כורסה', colors: 'חום', material: 'עור' }, stock)
    expect(exact.map((f) => f.item.id)).toEqual(['1'])
    expect(exact[0]!.reasons).toEqual(['details'])
  })

  it('does not flag every chair: a shared word with a different colour is a different piece', () => {
    const found = findDuplicates({ title: 'כיסא עץ', category: 'כיסא', colors: 'חום', material: 'עץ' }, stock)
    expect(found.map((f) => f.item.id)).toEqual(['2'])
  })

  it('needs a second detail to agree, not the name alone', () => {
    expect(findDuplicates({ title: 'כיסא עץ' }, stock)).toEqual([])
  })

  it('rules out another category', () => {
    expect(findDuplicates({ title: 'שידת מגירות', category: 'מזנון', colors: 'ירוק' }, stock)).toEqual([])
    expect(findDuplicates({ title: 'שידת מגירות', category: 'שידה', colors: 'ירוק' }, stock).map((f) => f.item.id)).toEqual(['4'])
  })

  it('ignores sold items for a details match but not for the same photo', () => {
    const ramp = (f: (x: number, y: number) => number) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)))
    const hash = differenceHash(ramp((x, y) => (x * 37 + y * 11) % 255))
    const withPhoto = stock.map((s) => (s.id === '5' ? { ...s, photoHash: hash } : s))
    const found = findDuplicates({ photoHash: hash, title: 'כורסת עור חומה', category: 'כורסה', colors: 'חום', material: 'עור' }, withPhoto)
    expect(found.map((f) => [f.item.id, f.reasons])).toEqual([['5', ['photo']], ['1', ['details']]])
  })

  it('never lists the item being edited, and nothing for an empty form', () => {
    expect(findDuplicates({ title: 'כיסא עץ', category: 'כיסא', colors: 'חום' }, stock, '2')).toEqual([])
    expect(findDuplicates({}, stock)).toEqual([])
  })
})
