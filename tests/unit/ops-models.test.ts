import { describe, expect, it } from 'vitest'
import { can, draftProduct, formatSku, skuCandidates, reservationExpired, skuSlug, websiteCategoryFor, WEBSITE_CONDITION } from '@/lib/inventory/model'
import { CC_SLUG } from '@/lib/sync/products'
import { driveFileId } from '@/lib/inventory/drive'
import { mergeContact, normalizeEmail, normalizePhone, whatsappLink, daysWithoutContact } from '@/lib/crm/model'
import { planOrderSync } from '@/lib/sync/plan'
import { summarise } from '@/lib/ops/summary'
import { deriveAlerts } from '@/lib/alerts'
import type { Item } from '@/lib/ops/types'
import type { WebsiteOrder } from '@/lib/integrations/website/manage'

const T = '2026-10-23T10:00:00.000Z'
function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1', sku: 'JAS-000001', title: 'שולחן אוכל', description: null, category: 'Tables', kind: 'unique', quantity: 1, condition: 'good', status: 'in_storage', locationId: null,
    priceMinor: 45000, photoUrl: 'https://img.example/t.jpg', dimensions: null, material: null, weightKg: null, source: 'furniture', furnitureItemId: 'f1', furnitureProjectId: 'p1',
    furnitureProjectName: 'הרצל 5', furnitureApartment: 'כניסה א׳ · דירה 3', websiteProductId: null, reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null,
    soldChannel: null, soldAt: null, soldPriceMinor: null, buyerContactId: null, websiteOrderId: null, websiteOrderNumber: null, dispositionNote: null, version: 1, createdBy: 'a@x', createdAt: T, updatedAt: T,
    ...over,
  }
}
function order(over: Partial<WebsiteOrder> = {}): WebsiteOrder {
  return { id: 10, order_number: 'JAS-1001', customer_name: 'Dana Levi', customer_email: 'dana@x.com', customer_phone: '050-1234567', items: [{ product_id: 77, name_he: 'שולחן', price: 450, quantity: 1 }], subtotal: 450, shipping: 0, total: 450, status: 'paid', notes: null, paid_at: T, created_at: T, updated_at: T, ...over }
}

describe('inventory model', () => {
  it('allows each operation only from the statuses that make sense', () => {
    expect(can('list', 'in_storage')).toBe(true)
    expect(can('list', 'listed')).toBe(false)
    expect(can('reserve', 'listed')).toBe(true)
    expect(can('reserve', 'sold')).toBe(false)
    expect(can('sell_in_store', 'reserved')).toBe(true)
    expect(can('deliver', 'listed')).toBe(false)
    expect(can('donate', 'sold')).toBe(false)
  })

  it('formats typed and scanned codes to one SKU form, and a SKU to a stable slug', () => {
    expect(formatSku('123')).toBe('JAS-000123')
    expect(formatSku('jas-42')).toBe('JAS-000042')
    expect(skuSlug('JAS-000123')).toBe('jas-000123')
  })

  it('also tries the 4-digit serials imported from jas-inventory, typed or inside a scanned link', () => {
    expect(skuCandidates('JAS-0042')).toEqual(['JAS-0042', 'JAS-000042'])
    expect(skuCandidates('42')).toEqual(['42', 'JAS-000042', 'JAS-0042'])
    expect(skuCandidates('https://jas-inventory.vercel.app/item/JAS-0042')).toContain('JAS-0042')
    expect(skuCandidates('JAS-000123')).toEqual(['JAS-000123'])
    expect(skuCandidates('')).toEqual([])
  })

  it('drafts an unpublished product only with a price and an https photo', () => {
    expect(draftProduct(item({ priceMinor: null }))).toMatchObject({ ok: false })
    expect(draftProduct(item({ photoUrl: 'http://img/x.jpg' }))).toMatchObject({ ok: false })
    const d = draftProduct(item())
    expect(d.ok && d.product).toMatchObject({ slug: 'jas-000001', price: 450, published: false, quantity: 1 })
    expect(WEBSITE_CONDITION.needs_repair).toBe('fair')
    const live = draftProduct(item(), { published: true })
    expect(live.ok && live.product.published).toBe(true)
  })

  it('puts an item in the website category of the same Hebrew name, or none', () => {
    const cats = [{ id: 3, name_he: 'שולחן סלון' }, { id: 7, name_he: ' כיסא ' }]
    expect(websiteCategoryFor('שולחן סלון', cats)).toBe(3)
    expect(websiteCategoryFor('כיסא', cats)).toBe(7)
    expect(websiteCategoryFor('שולחן', cats)).toBeNull()
    expect(websiteCategoryFor(null, cats)).toBeNull()
  })

  it('recognises a Google Drive photo link, and only that', () => {
    expect(driveFileId('https://drive.google.com/thumbnail?id=1MBTfiZOF1U5vtA0KczwZym_aK5CuoNBs&sz=w1000')).toBe('1MBTfiZOF1U5vtA0KczwZym_aK5CuoNBs')
    expect(driveFileId('https://drive.google.com/file/d/1MBTfiZOF1U5vtA0KczwZym_aK5CuoNBs/view?usp=drivesdk')).toBe('1MBTfiZOF1U5vtA0KczwZym_aK5CuoNBs')
    expect(driveFileId('https://xyz.supabase.co/storage/v1/object/public/inventory-photos/a.jpg')).toBeNull()
    expect(driveFileId('https://evil.example/thumbnail?id=1MBTfiZOF1U5vtA0KczwZym')).toBeNull()
    expect(driveFileId(null)).toBeNull()
  })

  it('never adopts a listing the command center made, including the kept jas-inventory serials', () => {
    expect(CC_SLUG.test(skuSlug('JAS-000001'))).toBe(true)
    expect(CC_SLUG.test(skuSlug('JAS-0042'))).toBe(true)
    expect(CC_SLUG.test('jas-12345')).toBe(false)
    expect(CC_SLUG.test('oak-table')).toBe(false)
  })

  it('a reservation expires at its date, not before', () => {
    expect(reservationExpired(item({ status: 'reserved', reservedUntil: '2026-10-23T09:00:00Z' }), Date.parse(T))).toBe(true)
    expect(reservationExpired(item({ status: 'reserved', reservedUntil: '2026-10-24T09:00:00Z' }), Date.parse(T))).toBe(false)
  })
})

describe('contact identity', () => {
  it('recognises the same Israeli phone in every common shape', () => {
    for (const p of ['050-123-4567', '+972 50 123 4567', '972501234567', '0501234567', '00972501234567']) expect(normalizePhone(p)).toBe('0501234567')
    expect(normalizePhone('123')).toBeNull()
    expect(normalizeEmail('  Dana@X.COM ')).toBe('dana@x.com')
    expect(normalizeEmail('not an email')).toBeNull()
    expect(whatsappLink('050-123-4567')).toBe('https://wa.me/972501234567')
    expect(whatsappLink('03-1234567')).toBeNull()
  })

  it('a source naming someone again only fills blanks and adds a role', () => {
    const c = { fullName: 'דנה', email: 'dana@x.com', phone: null, roles: ['lead' as const] }
    expect(mergeContact(c, { name: 'Someone Else', email: 'other@x.com', phone: '0501234567', role: 'customer' })).toEqual({ phone: '0501234567', roles: ['lead', 'customer'] })
    expect(mergeContact({ ...c, phone: '0501234567', roles: ['customer'] }, { email: null, phone: null, role: 'customer' })).toEqual({})
    expect(daysWithoutContact({ lastContactedAt: null, createdAt: '2026-10-20T10:00:00Z' }, Date.parse(T))).toBe(3)
  })
})

describe('website order sync plan', () => {
  const listed = item({ id: 'i1', status: 'listed', websiteProductId: 77 })

  it('a paid order for a listed item: a customer, then a sale with nothing left', () => {
    const { steps, cursor } = planOrderSync([order()], new Map([[77, listed]]))
    expect(steps.map((s) => s.kind)).toEqual(['customer', 'sell'])
    expect(steps[1]).toMatchObject({ itemId: 'i1', units: 1, remaining: 0, lineTotalMinor: 45000 })
    expect(cursor).toBe(T)
  })

  it('a batch sells down across orders in one run', () => {
    const batch = item({ id: 'b', status: 'listed', websiteProductId: 77, quantity: 3, kind: 'batch' })
    const { steps } = planOrderSync([order({ id: 1, items: [{ product_id: 77, price: 10, quantity: 2 }] }), order({ id: 2, order_number: 'JAS-1002', items: [{ product_id: 77, price: 10, quantity: 1 }] })], new Map([[77, batch]]))
    expect(steps.filter((s) => s.kind === 'sell').map((s) => (s.kind === 'sell' ? s.remaining : -1))).toEqual([1, 0])
  })

  it('seeing the same order again only advances delivery', () => {
    const sold = item({ status: 'sold', websiteProductId: 77, websiteOrderId: 10 })
    expect(planOrderSync([order()], new Map([[77, sold]])).steps.map((s) => s.kind)).toEqual(['customer'])
    expect(planOrderSync([order({ status: 'delivered' })], new Map([[77, sold]])).steps.map((s) => s.kind)).toEqual(['customer', 'deliver'])
  })

  it('a paid order for an item that is gone here is a conflict, never a second sale', () => {
    const { steps } = planOrderSync([order()], new Map([[77, item({ status: 'sold', websiteProductId: 77, websiteOrderId: 99, soldChannel: 'in_store' })]]))
    expect(steps.map((s) => s.kind)).toEqual(['customer', 'conflict'])
    expect(planOrderSync([order()], new Map([[77, item({ status: 'reserved', websiteProductId: 77 })]])).steps.map((s) => s.kind)).toEqual(['customer', 'conflict', 'sell'])
  })

  it('unpaid orders create nobody and sell nothing; products not from inventory are ignored', () => {
    expect(planOrderSync([order({ status: 'pending' })], new Map([[77, listed]])).steps).toEqual([])
    expect(planOrderSync([order()], new Map()).steps.map((s) => s.kind)).toEqual(['customer'])
  })
})

describe('ops snapshot and alerts', () => {
  const now = Date.parse(T)
  const snap = summarise({
    items: [item(), item({ id: 'i2', createdAt: '2026-07-01T00:00:00Z' }), item({ id: 'i3', status: 'sold' }), item({ id: 'i4', status: 'listed', priceMinor: 10000 })],
    deals: [{ id: 'd', contactId: 'c', title: 't', stage: 'new', valueMinor: null, itemId: null, source: 'website_form', sourceRef: null, nextStep: null, nextStepAt: null, ownerProfileId: null, lastContactedAt: null, closedAt: null, createdAt: '2026-10-18T00:00:00Z', updatedAt: T }],
    tasks: [{ id: 't', title: 'x', detail: null, status: 'open', dueAt: '2026-10-22T00:00:00Z', assigneeProfileId: null, entityKind: 'item', entityId: 'i3', source: 'automation:double_sale', dedupeKey: 'k', createdBy: 's', createdAt: T, completedAt: null, completedBy: null }],
    deliveries: [],
    contacts: [],
    rules: new Map(),
  }, now)

  it('counts the states the screens show', () => {
    expect(snap.items).toMatchObject({ available: 3, unlisted: 2, agingUnlisted: 1, awaitingDelivery: 1, askingValueMinor: 45000 * 2 + 10000 })
    expect(snap.crm.staleLeads).toBe(1)
    expect(snap.tasks).toMatchObject({ open: 1, overdue: 1, doubleSale: 1 })
  })

  it('a possible double sale is critical; a missing migration raises nothing', () => {
    const health = [{ product: 'website' as const, status: 'operational' as const, checks: [] }]
    const a = deriveAlerts({ health, ops: { state: 'ok', data: snap, checkedAt: T, latencyMs: 1, source: 's' } })
    expect(a[0]).toMatchObject({ id: 'ops:double-sale', severity: 'critical' })
    expect(a.map((x) => x.id)).toEqual(expect.arrayContaining(['ops:stale-leads', 'ops:overdue-tasks', 'ops:aging-stock']))
    expect(deriveAlerts({ health, ops: { state: 'not_configured', missing: ['migration 0003'] } })).toEqual([])
  })

  it('a switched-off automation silences its alert', () => {
    const health = [{ product: 'website' as const, status: 'operational' as const, checks: [] }]
    const off = { ...snap, rules: { stale_leads: false } }
    expect(deriveAlerts({ health, ops: { state: 'ok', data: off, checkedAt: T, latencyMs: 1, source: 's' } }).map((x) => x.id)).not.toContain('ops:stale-leads')
  })
})

describe('ops analytics', () => {
  it('every inventory and customer metric is in the catalog with the same basis and product', async () => {
    const { inventorySection, crmSection } = await import('@/lib/analytics/ops')
    const { METRIC_BY_ID } = await import('@/lib/metrics-catalog')
    const range = { from: '2026-10-17', to: '2026-10-23' }
    const previous = { from: '2026-10-10', to: '2026-10-16' }
    const r = { state: 'ok' as const, checkedAt: T, data: { items: [item({ soldAt: '2026-10-20T10:00:00Z', status: 'sold', soldChannel: 'in_store' as const, createdAt: '2026-10-10T10:00:00Z' })], movements: [{ id: 'm', itemId: 'i1', at: '2026-10-20T10:00:00Z', type: 'sell' as const, fromStatus: null, toStatus: null, fromLocation: null, toLocation: null, quantityDelta: -1, refKind: null, refId: null, note: null, actorEmail: 'a', detail: { channel: 'in_store', priceMinor: 30000 } }], deals: [], contacts: [], truncated: false } }
    for (const sec of [inventorySection(r, range, previous), crmSection(r, range, previous)]) {
      for (const m of sec.metrics) expect(METRIC_BY_ID.get(m.id), m.id).toMatchObject({ basis: m.basis, product: sec.product })
    }
    const inv = inventorySection(r, range, previous)
    expect(inv.metrics.find((m) => m.id === 'inv.inStoreValue')).toMatchObject({ value: 30000, previous: 0 })
    expect(inv.metrics.find((m) => m.id === 'inv.daysToSell')!.value).toBe(10)
    expect(inventorySection({ state: 'not_configured', detail: 'run 0003' }, range, previous).metrics.every((m) => m.value === null && m.quality === 'unavailable')).toBe(true)
  })
})
