import { describe, expect, it } from 'vitest'
import { DUPLICATE_THRESHOLD, differenceHash, hammingDistance, isPhotoHash, similarPhotos } from '@/lib/inventory/photo-hash'
import { parsePhotoFields } from '@/lib/inventory/ai-fields'
import { basketProblem, saleMoney } from '@/lib/sales/model'
import { describeChanges } from '@/lib/inventory/model'
import { can } from '@/lib/auth/rbac'
import { shekelsToMinor } from '@/components/sales/copy'

const ramp = (f: (x: number, y: number) => number) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)))

describe('photo difference hash', () => {
  it('is 16 hex characters and stable under brightness changes', () => {
    const img = ramp((x, y) => (x * 37 + y * 11) % 255)
    const brighter = img.map((v) => v + 20)
    expect(isPhotoHash(differenceHash(img))).toBe(true)
    expect(differenceHash(brighter)).toBe(differenceHash(img))
  })
  it('flags a near-identical photo and not a different one', () => {
    const a = differenceHash(ramp((x, y) => (x * 37 + y * 11) % 255))
    const noisy = differenceHash(ramp((x, y) => ((x * 37 + y * 11) % 255) + (x === 3 && y === 2 ? 60 : 0)))
    const other = differenceHash(ramp((x, y) => (255 - x * 29 + y * 53) % 255))
    expect(hammingDistance(a, noisy)).toBeLessThanOrEqual(DUPLICATE_THRESHOLD)
    expect(hammingDistance(a, other)).toBeGreaterThan(DUPLICATE_THRESHOLD)
    const found = similarPhotos(a, [{ id: '1', sku: 'JAS-1', title: 't', photoUrl: null, status: 'in_storage', photoHash: noisy }, { id: '2', sku: 'JAS-2', title: 'u', photoUrl: null, status: 'in_storage', photoHash: other }])
    expect(found.map((f) => f.id)).toEqual(['1'])
  })
})

describe('photo AI answer', () => {
  it('reads the JSON even with text around it, clips colours and rejects silly prices', () => {
    const f = parsePhotoFields('Here: {"title":"כורסת עור","category":"כורסא","colors":["חום","שחור","לבן","אדום"],"material":"עור","description":"כורסה נוחה.","suggested_price_ils":0}')
    expect(f).toMatchObject({ title: 'כורסת עור', colors: ['חום', 'שחור', 'לבן'], suggestedPriceIls: null })
    expect(parsePhotoFields('{"title":"x","category":"y","colors":[],"material":"","description":"","suggested_price_ils":349.6}')?.suggestedPriceIls).toBe(350)
  })
  it('returns null for anything it cannot read', () => {
    expect(parsePhotoFields('sorry')).toBeNull()
    expect(parsePhotoFields('{"title": 3}')).toBeNull()
  })
})

describe('sale money', () => {
  it('a return lowers what is due, not the total; a refund is a negative payment', () => {
    const m = saleMoney({ totalMinor: 10000 }, [{ returnedQty: 1, quantity: 1, unitPriceMinor: 4000 }], [{ amountMinor: 10000 }, { amountMinor: -4000 }])
    expect(m).toEqual({ totalMinor: 10000, discountMinor: 0, returnedMinor: 4000, dueMinor: 6000, paidMinor: 6000, balanceMinor: 0, state: 'paid' })
    expect(saleMoney({ totalMinor: 10000 }, [], []).state).toBe('unpaid')
    expect(saleMoney({ totalMinor: 10000 }, [], [{ amountMinor: 3000 }]).state).toBe('deposit')
  })
  it('a basket needs an address for a delivery and no item twice', () => {
    const l = { itemId: 'a', quantity: 1, unitPriceMinor: 100, fulfilment: 'delivery' as const }
    expect(basketProblem({ contactId: null, note: null, lines: [l] })).toMatch(/address/)
    expect(basketProblem({ contactId: null, note: null, lines: [{ ...l, fulfilment: 'pickup' }, { ...l, fulfilment: 'pickup' }] })).toMatch(/twice/)
  })
  it('shekels typed at the counter become agorot', () => {
    expect(shekelsToMinor('1,250')).toBe(125000)
    expect(shekelsToMinor('99.9')).toBe(9990)
    expect(shekelsToMinor('abc')).toBeNull()
  })
})

describe('item history', () => {
  it('shows money changes and hides cost from roles without money', () => {
    const detail = { changes: { priceMinor: { from: 10000, to: 12000 }, unitCostMinor: { from: null, to: 5000 }, photoUrl: { from: 'a', to: 'b' } } }
    expect(describeChanges(detail, { money: true })).toEqual(['price: ₪100 → ₪120', 'cost: — → ₪50', 'photo changed'])
    expect(describeChanges(detail, { money: false })).toEqual(['price: ₪100 → ₪120', 'photo changed'])
  })
})

describe('seller role', () => {
  it('can sell, add items and customers, but not touch the website, settings or gift cards', () => {
    for (const p of ['inventory:read', 'inventory:operate', 'inventory:write', 'inventory:financial', 'crm:read', 'crm:write'] as const) expect(can('seller', p)).toBe(true)
    for (const p of ['website:write', 'gift_cards:read', 'settings:write', 'audit:read'] as const) expect(can('seller', p as never)).toBe(false)
  })
})
