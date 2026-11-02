import { describe, expect, it } from 'vitest'
import { breakdownTotals, groupOf, mainColour, priceBand, priceBands, soldUnits, stockAndSales, NO_COLOUR, NO_LEVEL, NO_PRICE, PRICE_BAND_LABELS } from '@/lib/inventory/breakdown'
import type { Item, Movement } from '@/lib/ops/types'

const T = '2026-10-20T10:00:00.000Z'
function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1', sku: 'JAS-000001', title: 'כורסה', description: null, category: 'כורסה', kind: 'unique', quantity: 1, condition: 'good', status: 'in_storage', locationId: null,
    priceMinor: 45000, photoUrl: null, dimensions: null, material: null, weightKg: null, source: 'manual', furnitureItemId: null, furnitureProjectId: null,
    furnitureProjectName: null, furnitureApartment: null, websiteProductId: null, reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null,
    soldChannel: null, soldAt: null, soldPriceMinor: null, buyerContactId: null, websiteOrderId: null, websiteOrderNumber: null, dispositionNote: null, version: 1, createdBy: 'a@x', createdAt: T, updatedAt: T,
    ...over,
  }
}
let n = 0
function move(itemId: string, type: Movement['type'], detail: Record<string, unknown>, at = T): Movement {
  return { id: `m${++n}`, itemId, at, type, fromStatus: null, toStatus: null, fromLocation: null, toLocation: null, quantityDelta: 0, refKind: null, refId: null, note: null, actorEmail: 'a@x', detail }
}

describe('mainColour', () => {
  it('merges spellings, genders, English and shades into one Hebrew colour', () => {
    expect(mainColour('שחורה')).toBe('שחור')
    expect(mainColour('Black, white')).toBe('שחור')
    expect(mainColour('חום כהה, לבן')).toBe('חום')
    expect(mainColour('light grey')).toBe('אפור')
    expect(mainColour('ירוק זית')).toBe('ירוק')
    expect(mainColour('בז׳')).toBe('בז')
    expect(mainColour('חום ולבן')).toBe('חום')
  })
  it('keeps an unknown colour as written and blank as null', () => {
    expect(mainColour('  פוקסיה  ')).toBe('פוקסיה')
    expect(mainColour('')).toBeNull()
    expect(mainColour(null)).toBeNull()
  })
})

describe('groupOf', () => {
  it('normalises categories and labels renewal levels', () => {
    expect(groupOf(item({ category: 'כורסא' }), 'category')).toBe('כורסה')
    expect(groupOf(item({ renewalLevel: 2 }), 'renewal')).toBe('2 · שיפוץ קל')
    expect(groupOf(item({ renewalLevel: null }), 'renewal')).toBe(NO_LEVEL)
    expect(groupOf(item({ colors: null }), 'colour')).toBe(NO_COLOUR)
  })
})

describe('stockAndSales', () => {
  const items = [
    item({ id: 'a', category: 'כורסה', renewalLevel: 3, colors: 'ירוק', locationId: 'shop' }),
    item({ id: 'b', category: 'כורסא', renewalLevel: 3, colors: 'green', status: 'listed', locationId: 'store-room' }),
    item({ id: 'c', category: 'כיסא', kind: 'batch', quantity: 4, renewalLevel: 0, colors: 'עץ טבעי', locationId: 'shop' }),
    item({ id: 'd', category: 'כורסה', renewalLevel: 3, colors: 'ירוק', status: 'sold' }),
    item({ id: 'e', category: 'שידה', renewalLevel: 1, status: 'reserved' }),
  ]
  const period = { from: '2026-10-01', to: '2026-10-31' }
  const moves = [
    move('d', 'sell', { channel: 'in_store', priceMinor: 90000, units: 1 }),
    move('c', 'sell', { channel: 'in_store', priceMinor: 20000, units: 2 }),
    move('c', 'return', { channel: 'in_store', priceMinor: 10000, units: 1 }),
    move('b', 'sell', { channel: 'website', units: 1, lineTotalMinor: 80000 }),
    move('a', 'sell', { channel: 'in_store', priceMinor: 70000, units: 1 }, '2026-09-15T10:00:00.000Z'),
  ]

  it('counts available units, the shop part, net shop sales and online units per category', () => {
    const rows = stockAndSales(items, moves, 'category', period, new Set(['shop']))
    expect(rows.map((r) => r.group)).toEqual(['כיסא', 'כורסה'])
    expect(rows.find((r) => r.group === 'כורסה')).toEqual({ group: 'כורסה', stock: 2, inShop: 1, soldInShop: 1, shopValueMinor: 90000, soldOnline: 1 })
    expect(rows.find((r) => r.group === 'כיסא')).toEqual({ group: 'כיסא', stock: 4, inShop: 4, soldInShop: 1, shopValueMinor: 10000, soldOnline: 0 })
  })

  it('never values an online sale and leaves reserved items out of stock', () => {
    const t = breakdownTotals(stockAndSales(items, moves, 'renewal', period))
    expect(t).toEqual({ stock: 6, inShop: 0, soldInShop: 2, shopValueMinor: 100000, soldOnline: 1 })
  })

  it('orders renewal levels 0→4 and puts "none" last; colours merge across languages', () => {
    expect(stockAndSales(items, moves, 'renewal', period).map((r) => r.group)).toEqual(['0 · גראז׳', '3 · חידוש משמעותי'])
    expect(stockAndSales([...items, item({ id: 'f', renewalLevel: null })], [], 'renewal', null).at(-1)!.group).toBe(NO_LEVEL)
    const colours = stockAndSales(items, moves, 'colour', period)
    expect(colours.find((r) => r.group === 'ירוק')).toMatchObject({ stock: 2, soldInShop: 1, soldOnline: 1 })
  })

  it('takes every movement when there is no period', () => {
    expect(breakdownTotals(stockAndSales(items, moves, 'category', null)).shopValueMinor).toBe(170000)
  })

  it('takes off an item sent back to stock from the item page, in the shop and on the website (a cancelled order)', () => {
    const back = [
      ...moves,
      move('d', 'return', { soldChannel: 'in_store', soldPriceMinor: 90000 }),
      move('b', 'return', { soldChannel: 'website', soldPriceMinor: 80000, websiteOrderNumber: 'W-1' }),
    ]
    const r = stockAndSales(items, back, 'category', period).find((x) => x.group === 'כורסה')!
    expect(r).toMatchObject({ soldInShop: 0, shopValueMinor: 0, soldOnline: 0 })
    expect(soldUnits(r)).toBe(0)
  })

  it('soldUnits adds shop and website units, net of returns', () => {
    const rows = stockAndSales(items, moves, 'category', period)
    expect(rows.map((r) => [r.group, soldUnits(r)])).toEqual([['כיסא', 1], ['כורסה', 2]])
  })
})

describe('price ranges', () => {
  it('bands per unit with inclusive upper bounds', () => {
    expect(priceBand(10_000)).toBe('עד 100 ₪')
    expect(priceBand(10_050)).toBe('101–500 ₪')
    expect(priceBand(50_000)).toBe('101–500 ₪')
    expect(priceBand(100_000)).toBe('501–1,000 ₪')
    expect(priceBand(100_100)).toBe('מעל 1,000 ₪')
    expect(priceBand(null)).toBe(NO_PRICE)
    expect(priceBand(0)).toBe(NO_PRICE)
  })

  const items = [
    item({ id: 'a', title: 'שרפרף', priceMinor: 8_000 }),
    item({ id: 'b', title: 'כיסא', kind: 'batch', quantity: 3, priceMinor: 25_000, status: 'listed' }),
    item({ id: 'c', title: 'ספה', priceMinor: 150_000 }),
    item({ id: 'd', title: 'שידה', priceMinor: 12_000, status: 'sold' }),
    item({ id: 'e', title: 'כורסה', priceMinor: null }),
  ]
  const period = { from: '2026-10-01', to: '2026-10-31' }

  it('stock: share of units and the items in each range, natural order, empty ranges kept', () => {
    const bands = priceBands(items, [], 'stock', null)
    expect(bands.map((b) => b.band)).toEqual([...PRICE_BAND_LABELS, NO_PRICE])
    expect(bands.map((b) => [b.units, b.percent])).toEqual([[1, 17], [3, 50], [0, 0], [1, 17], [1, 16]])
    expect(bands[1]!.items).toEqual([{ id: 'b', sku: 'JAS-000001', title: 'כיסא', units: 3, unitPriceMinor: 25_000 }])
    // Same numbers as the table's price rows.
    const rows = stockAndSales(items, [], 'price', null)
    expect(rows.map((r) => [r.group, r.stock])).toEqual([['עד 100 ₪', 1], ['101–500 ₪', 3], ['מעל 1,000 ₪', 1], [NO_PRICE, 1]])
  })

  it('sales: banded by what was paid per unit after discount, net of returns', () => {
    const moves = [
      // Listed at ₪120, sold for ₪90 after a discount: a sale "up to 100".
      move('d', 'sell', { channel: 'in_store', priceMinor: 9_000, units: 1 }),
      // 2 chairs for ₪400 = ₪200 each; one comes back.
      move('b', 'sell', { channel: 'in_store', priceMinor: 40_000, units: 2 }),
      move('b', 'return', { channel: 'in_store', priceMinor: 20_000, units: 1 }),
      // A website line of ₪1,200.
      move('c', 'sell', { channel: 'website', lineTotalMinor: 120_000, units: 1 }),
      move('a', 'sell', { channel: 'in_store', priceMinor: 8_000, units: 1 }, '2026-09-01T10:00:00.000Z'),
    ]
    const bands = priceBands(items, moves, 'sales', period)
    expect(bands.map((b) => [b.band, b.units, b.percent])).toEqual([['עד 100 ₪', 1, 34], ['101–500 ₪', 1, 33], ['501–1,000 ₪', 0, 0], ['מעל 1,000 ₪', 1, 33]])
    expect(bands[0]!.items.map((i) => [i.id, i.unitPriceMinor])).toEqual([['d', 9_000]])
    const rows = stockAndSales(items, moves, 'price', period)
    expect(rows.find((r) => r.group === 'עד 100 ₪')).toMatchObject({ soldInShop: 1, shopValueMinor: 9_000 })
    expect(rows.find((r) => r.group === '101–500 ₪')).toMatchObject({ soldInShop: 1, shopValueMinor: 20_000 })
    expect(rows.find((r) => r.group === 'מעל 1,000 ₪')).toMatchObject({ soldOnline: 1 })
  })

  it('nothing at all: every range at 0%', () => {
    expect(priceBands([], [], 'sales', period).every((b) => b.units === 0 && b.percent === 0)).toBe(true)
  })
})
