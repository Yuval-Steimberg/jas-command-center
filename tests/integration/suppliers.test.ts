import { describe, expect, it } from 'vitest'
import { emptyData, memoryStore } from '@/lib/ops/memory'
import { ConflictError } from '@/lib/ops/store'
import { summarise } from '@/lib/ops/summary'
import { deriveAlerts } from '@/lib/alerts'
import { memorySupplierStore } from '@/lib/suppliers/store'
import { editable, isOverdue, lineProblem, nextStatuses, poTotals, supplierStats, type PurchaseOrder } from '@/lib/suppliers/model'
import { orderText, orderWhatsAppLink } from '@/lib/suppliers/service'

/**
 * Purchasing against the in-memory store, which mirrors cc_po_save /
 * cc_po_receive in 0004: lines frozen once goods arrive, receiving never
 * exceeds what was ordered, one item per received line, replay by request id.
 */
const actor = 'buyer@jas.test'

async function setup() {
  const d = emptyData()
  const ops = memoryStore(d)
  const sup = memorySupplierStore(d)
  const supplier = await ops.createContact({ fullName: 'נגריית הצפון', kind: 'company', phone: '0521234567', roles: ['supplier'], source: 'manual' })
  const shelf = await ops.saveLocation({ name: 'Shelf A', kind: 'shelf' })
  const po = await sup.saveOrder(
    { supplierId: supplier.id, expectedAt: '2026-10-30', note: null, lines: [{ description: 'Oak chair', quantity: 4, unitCostMinor: 12000, category: 'Chairs' }, { description: 'Lamp', quantity: 1, unitCostMinor: null }] },
    actor,
  )
  return { d, ops, sup, supplier, shelf, po }
}

describe('purchase orders', () => {
  it('creates a numbered draft and totals only costed lines', async () => {
    const { po } = await setup()
    expect(po.number).toBe('PO-00001')
    expect(po.status).toBe('draft')
    expect(poTotals(po)).toEqual({ orderedMinor: 48000, receivedMinor: 0, uncosted: 1, units: 5, unitsReceived: 0 })
    expect(nextStatuses(po)).toEqual(['ordered', 'cancelled'])
  })

  it('edits lines only with the current version and only before anything arrived', async () => {
    const { sup, po, supplier, shelf } = await setup()
    await expect(sup.saveOrder({ supplierId: supplier.id, expectedAt: null, note: null, lines: [{ description: 'Oak chair', quantity: 6 }] }, actor, po.id, po.version + 1)).rejects.toBeInstanceOf(ConflictError)
    const edited = await sup.saveOrder({ supplierId: supplier.id, expectedAt: null, note: 'x', lines: [{ description: 'Oak chair', quantity: 6, unitCostMinor: 10000 }] }, actor, po.id, po.version)
    expect(edited.lines).toHaveLength(1)
    expect(edited.version).toBe(po.version + 1)
    await sup.receive(po.id, [{ lineId: edited.lines[0]!.id, quantity: 1, locationId: shelf.id, condition: 'as_new' }], 'req-edit-1', actor)
    const now = (await sup.getOrder(po.id))!
    expect(editable(now)).toBe(false)
    await expect(sup.saveOrder({ supplierId: supplier.id, expectedAt: null, note: null, lines: [{ description: 'Oak chair', quantity: 9 }] }, actor, po.id, now.version)).rejects.toThrow(/already received/)
  })

  it('receiving creates inventory items with their supplier, then closes the order', async () => {
    const { ops, sup, po, shelf, supplier } = await setup()
    const [chairs, lamp] = po.lines
    const first = await sup.receive(po.id, [{ lineId: chairs!.id, quantity: 3, locationId: shelf.id, condition: 'good' }], 'req-1', actor)
    expect(first.replay).toBe(false)
    let now = (await sup.getOrder(po.id))!
    expect(now.status).toBe('partial')
    const item = (await ops.getItem(first.receipts[0]!.itemId))!
    expect(item).toMatchObject({ title: 'Oak chair', kind: 'batch', quantity: 3, status: 'in_storage', locationId: shelf.id, condition: 'good', source: 'purchase', supplierId: supplier.id, purchaseOrderId: po.id, unitCostMinor: 12000 })
    const mv = await ops.movements(item.id)
    expect(mv).toHaveLength(1)
    expect(mv[0]).toMatchObject({ type: 'intake', refKind: 'po_line', quantityDelta: 3, note: 'PO-00001' })

    await expect(sup.receive(po.id, [{ lineId: chairs!.id, quantity: 2, locationId: null, condition: null }], 'req-2', actor)).rejects.toThrow(/only 1 of "Oak chair"/)
    await sup.receive(po.id, [{ lineId: chairs!.id, quantity: 1, locationId: null, condition: null }, { lineId: lamp!.id, quantity: 1, locationId: shelf.id, condition: null }], 'req-3', actor)
    now = (await sup.getOrder(po.id))!
    expect(now.status).toBe('received')
    expect(now.closedAt).not.toBeNull()
    expect((await ops.getItem((await sup.listReceipts({ poId: po.id })).find((r) => r.lineId === lamp!.id)!.itemId))!.kind).toBe('unique')
    await expect(sup.receive(po.id, [{ lineId: lamp!.id, quantity: 1, locationId: null, condition: null }], 'req-4', actor)).rejects.toThrow(/received/)
  })

  it('a double click receives once (same request id)', async () => {
    const { d, sup, po } = await setup()
    const line = po.lines[0]!
    const a = await sup.receive(po.id, [{ lineId: line.id, quantity: 2, locationId: null, condition: null }], 'same', actor)
    const b = await sup.receive(po.id, [{ lineId: line.id, quantity: 2, locationId: null, condition: null }], 'same', actor)
    expect(b.replay).toBe(true)
    expect(b.receipts.map((r) => r.id)).toEqual(a.receipts.map((r) => r.id))
    expect(d.items).toHaveLength(1)
    expect((await sup.getOrder(po.id))!.lines[0]!.receivedQty).toBe(2)
  })

  it('two people receiving the same remaining units at once: one wins, nothing is counted twice', async () => {
    const { d, sup, po } = await setup()
    const line = po.lines[0]!
    const results = await Promise.allSettled([
      sup.receive(po.id, [{ lineId: line.id, quantity: 4, locationId: null, condition: null }], 'tab-1', actor),
      sup.receive(po.id, [{ lineId: line.id, quantity: 4, locationId: null, condition: null }], 'tab-2', actor),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(d.items.reduce((n, i) => n + i.quantity, 0)).toBe(4)
    expect((await sup.getOrder(po.id))!.lines[0]!.receivedQty).toBe(4)
  })

  it('status moves are conditional on status and version', async () => {
    const { sup, po } = await setup()
    expect(await sup.setStatus(po.id, 'draft', po.version + 5, 'ordered')).toBeNull()
    const ordered = (await sup.setStatus(po.id, 'draft', po.version, 'ordered'))!
    expect(ordered.status).toBe('ordered')
    expect(ordered.orderedAt).not.toBeNull()
    expect(await sup.setStatus(po.id, 'draft', ordered.version, 'cancelled')).toBeNull()
    expect(nextStatuses(ordered)).toEqual(['cancelled'])
  })

  it('refuses nonsense lines', () => {
    expect(lineProblem({ description: ' ', quantity: 1 })).toMatch(/description/)
    expect(lineProblem({ description: 'x', quantity: 0 })).toMatch(/quantity/)
    expect(lineProblem({ description: 'x', quantity: 1.5 })).toMatch(/quantity/)
    expect(lineProblem({ description: 'x', quantity: 2, unitCostMinor: -1 })).toMatch(/cost/)
    expect(lineProblem({ description: 'x', quantity: 2, unitCostMinor: 500 })).toBeNull()
  })
})

describe('supplier figures', () => {
  const base = (o: Partial<PurchaseOrder>): PurchaseOrder => ({
    id: crypto.randomUUID(), number: 'PO-1', supplierId: 's', status: 'ordered', expectedAt: null, note: null, orderedAt: null, closedAt: null, version: 1, createdBy: actor,
    createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z', lines: [{ id: 'l', poId: 'p', position: 0, description: 'x', category: null, quantity: 2, unitCostMinor: 1000, receivedQty: 0 }], ...o,
  })
  const now = Date.parse('2026-10-24T09:00:00Z')

  it('late means past the expected day in Israel and not fully received', () => {
    expect(isOverdue(base({ expectedAt: '2026-10-23' }), now)).toBe(true)
    expect(isOverdue(base({ expectedAt: '2026-10-24' }), now)).toBe(false)
    expect(isOverdue(base({ expectedAt: '2026-10-23', status: 'received' }), now)).toBe(false)
    expect(isOverdue(base({ expectedAt: '2026-10-23', status: 'draft' }), now)).toBe(false)
  })

  it('counts received value, money still on order and on-time deliveries', () => {
    const early = base({ id: 'a', status: 'received', expectedAt: '2026-10-10', lines: [{ id: 'l1', poId: 'a', position: 0, description: 'x', category: null, quantity: 2, unitCostMinor: 1000, receivedQty: 2 }] })
    const late = base({ id: 'b', status: 'received', expectedAt: '2026-10-05', lines: [{ id: 'l2', poId: 'b', position: 0, description: 'y', category: null, quantity: 1, unitCostMinor: null, receivedQty: 1 }] })
    const open = base({ id: 'c', status: 'partial', expectedAt: '2026-10-20', lines: [{ id: 'l3', poId: 'c', position: 0, description: 'z', category: null, quantity: 3, unitCostMinor: 500, receivedQty: 1 }] })
    const cancelled = base({ id: 'd', status: 'cancelled' })
    const r = (poId: string, at: string) => ({ id: poId + at, poId, lineId: 'l', supplierId: 's', quantity: 1, itemId: 'i', locationId: null, condition: null, requestId: 'q', actorEmail: actor, at })
    const st = supplierStats([early, late, open, cancelled], [r('a', '2026-10-09T10:00:00Z'), r('b', '2026-10-07T10:00:00Z'), r('c', '2026-10-15T10:00:00Z')], now)
    expect(st).toMatchObject({ orders: 3, open: 1, overdue: 1, receivedMinor: 2500, onOrderMinor: 1000, uncostedLines: 1, onTime: { early: 1, late: 1 } })
  })

  it('late orders reach the overview and raise one warning', () => {
    const snap = summarise({ items: [], deals: [], tasks: [], deliveries: [], contacts: [], rules: new Map(), orders: [base({ expectedAt: '2026-10-01' }), base({ status: 'draft' })] }, now)
    expect(snap.purchasing).toEqual({ open: 2, late: 1, drafts: 1 })
    const alerts = deriveAlerts({ health: [], ops: { state: 'ok', data: snap, checkedAt: '', latencyMs: 0, source: '' } })
    expect(alerts.filter((a) => a.id === 'ops:po-late')).toHaveLength(1)
    expect(summarise({ items: [], deals: [], tasks: [], deliveries: [], contacts: [], rules: new Map(), orders: null }, now).purchasing).toBeNull()
  })
})

describe('sending an order', () => {
  it('builds Hebrew text without prices and a WhatsApp link that only opens a draft', () => {
    const po = { number: 'PO-00007', expectedAt: '2026-11-02', note: 'לאסוף מהמחסן', lines: [{ description: 'כיסא אלון', quantity: 4, unitCostMinor: 12000 }] } as unknown as PurchaseOrder
    const text = orderText(po)
    expect(text).toContain('הזמנה PO-00007')
    expect(text).toContain('• כיסא אלון × 4')
    expect(text).toContain('02/11/2026')
    expect(text).not.toMatch(/120/)
    const link = orderWhatsAppLink(po, { phone: '0521234567' })!
    expect(link.startsWith('https://wa.me/972521234567?text=')).toBe(true)
    expect(decodeURIComponent(link.split('text=')[1]!)).toBe(text)
    expect(orderWhatsAppLink(po, { phone: '031234567' })).toBeNull()
  })
})
