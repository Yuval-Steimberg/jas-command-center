import { describe, expect, it } from 'vitest'
import { breakdownTotals, groupOf, mainColour, stockAndSales, NO_COLOUR, NO_LEVEL } from '@/lib/inventory/breakdown'
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
})
