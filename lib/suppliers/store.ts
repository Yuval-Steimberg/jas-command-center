import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import { ConflictError, OpsSetupError } from '@/lib/ops/store'
import { memoryStore, emptyData, type MemoryData } from '@/lib/ops/memory'
import { dropsCacheOnWrite } from '@/lib/ops/fresh'
import { fail, fromRow, toRow, type PgError, type Row } from '@/lib/ops/supabase'
import type { Item } from '@/lib/ops/types'
import { RECEIVABLE, editable, lineProblem, remaining, type PoInput, type PoStatus, type PurchaseOrder, type Receipt, type ReceiveLine } from './model'

/** Migration 0004 has not been run. */
export const suppliersSetup = () => new OpsSetupError('0004_suppliers.sql', 'The purchase order tables')

/**
 * Purchase orders and receiving. Same contract in both implementations:
 * saving lines is refused once anything arrived; receiving locks the order,
 * refuses more than is still to come, creates one inventory item per line
 * received (with an intake movement) and replays idempotently per request id.
 */
export interface SupplierStore {
  listOrders(f?: { supplierId?: string; statuses?: readonly PoStatus[]; ids?: readonly string[]; limit?: number }): Promise<PurchaseOrder[]>
  getOrder(id: string): Promise<PurchaseOrder | null>
  /** Create (no id) or replace header + lines (expectVersion required). */
  saveOrder(input: PoInput, actor: string, id?: string, expectVersion?: number): Promise<PurchaseOrder>
  /** Conditional on the current status and version. Null when the order moved on. */
  setStatus(id: string, from: PoStatus, version: number, to: PoStatus): Promise<PurchaseOrder | null>
  receive(id: string, lines: ReceiveLine[], requestId: string, actor: string): Promise<{ receipts: Receipt[]; replay: boolean }>
  listReceipts(f?: { supplierId?: string; poId?: string; since?: string; limit?: number }): Promise<Receipt[]>
  /** Items received from this supplier (for the supplier page). */
  itemsFrom(supplierId: string, limit?: number): Promise<Item[]>
}

const g = globalThis as unknown as { __ccOpsData?: MemoryData }

export function getSupplierStore(): SupplierStore {
  if (authMode().kind === 'supabase') return dropsCacheOnWrite(supabaseSupplierStore(supabaseAdmin()))
  return dropsCacheOnWrite(memorySupplierStore((g.__ccOpsData ??= emptyData())))
}

const now = () => new Date().toISOString()
const copy = <T>(x: T): T => structuredClone(x)

function checkInput(input: PoInput) {
  if (!input.lines.length) throw new ConflictError('an order needs at least one line')
  for (const l of input.lines) {
    const p = lineProblem(l)
    if (p) throw new ConflictError(p)
  }
}

export function memorySupplierStore(d: MemoryData): SupplierStore {
  const items = memoryStore(d)
  return {
    async listOrders(f = {}) {
      return copy(
        d.purchaseOrders
          .filter((p) => (!f.supplierId || p.supplierId === f.supplierId) && (!f.statuses || f.statuses.includes(p.status)) && (!f.ids || f.ids.includes(p.id)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, f.limit ?? 500),
      )
    },
    async getOrder(id) {
      return copy(d.purchaseOrders.find((p) => p.id === id) ?? null)
    },
    async saveOrder(input, actor, id, expectVersion) {
      checkInput(input)
      const t = now()
      if (!id) {
        const po: PurchaseOrder = {
          id: crypto.randomUUID(), number: `PO-${String(++d.poSeq).padStart(5, '0')}`, supplierId: input.supplierId, status: 'draft', expectedAt: input.expectedAt, note: input.note,
          orderedAt: null, closedAt: null, version: 1, createdBy: actor, createdAt: t, updatedAt: t, lines: [],
        }
        po.lines = input.lines.map((l, i) => ({ id: crypto.randomUUID(), poId: po.id, position: i, description: l.description, category: l.category ?? null, quantity: l.quantity, unitCostMinor: l.unitCostMinor ?? null, receivedQty: 0 }))
        d.purchaseOrders.push(po)
        return copy(po)
      }
      const po = d.purchaseOrders.find((p) => p.id === id)
      if (!po) throw new ConflictError('order not found')
      if (expectVersion != null && po.version !== expectVersion) throw new ConflictError('the order changed since it was loaded')
      if (!editable(po)) throw new ConflictError(po.lines.some((l) => l.receivedQty > 0) ? 'part of this order was already received' : `the order is ${po.status}`)
      Object.assign(po, { supplierId: input.supplierId, expectedAt: input.expectedAt, note: input.note, version: po.version + 1, updatedAt: t })
      po.lines = input.lines.map((l, i) => ({ id: crypto.randomUUID(), poId: po.id, position: i, description: l.description, category: l.category ?? null, quantity: l.quantity, unitCostMinor: l.unitCostMinor ?? null, receivedQty: 0 }))
      return copy(po)
    },
    async setStatus(id, from, version, to) {
      const po = d.purchaseOrders.find((p) => p.id === id && p.status === from && p.version === version)
      if (!po) return null
      const t = now()
      Object.assign(po, { status: to, version: po.version + 1, updatedAt: t, ...(to === 'ordered' ? { orderedAt: po.orderedAt ?? t } : {}), ...(to === 'received' || to === 'cancelled' ? { closedAt: t } : {}) })
      return copy(po)
    },
    async receive(id, lines, requestId, actor) {
      // Everything up to the item writes runs without an await, so two receipts are serialised like the row lock.
      const prior = d.receipts.filter((r) => r.poId === id && r.requestId === requestId)
      if (prior.length) return { receipts: copy(prior), replay: true }
      const po = d.purchaseOrders.find((p) => p.id === id)
      if (!po) throw new ConflictError('order not found')
      if (!RECEIVABLE.includes(po.status)) throw new ConflictError(`the order is ${po.status}`)
      if (!lines.length) throw new ConflictError('nothing to receive')
      const want = new Map<string, number>()
      for (const r of lines) {
        const l = po.lines.find((x) => x.id === r.lineId)
        if (!l) throw new ConflictError('that line is not on this order')
        if (!Number.isInteger(r.quantity) || r.quantity <= 0) throw new ConflictError('quantity must be at least 1')
        want.set(l.id, (want.get(l.id) ?? 0) + r.quantity)
        if (want.get(l.id)! > remaining(l)) throw new ConflictError(`only ${remaining(l)} of "${l.description}" still to come`)
      }
      for (const r of lines) po.lines.find((x) => x.id === r.lineId)!.receivedQty += r.quantity
      const t = now()
      const done = po.lines.every((l) => l.receivedQty >= l.quantity)
      Object.assign(po, { status: done ? 'received' : 'partial', orderedAt: po.orderedAt ?? t, closedAt: done ? t : null, version: po.version + 1, updatedAt: t })
      const out: Receipt[] = []
      for (const r of lines) {
        const l = po.lines.find((x) => x.id === r.lineId)!
        const item = await items.createItem(
          {
            title: l.description, category: l.category, kind: r.quantity > 1 ? 'batch' : 'unique', quantity: r.quantity, condition: (r.condition as Item['condition']) || null,
            locationId: r.locationId, source: 'purchase', createdBy: actor, purchaseOrderId: po.id, supplierId: po.supplierId, unitCostMinor: l.unitCostMinor,
          },
          { refKind: 'po_line', refId: `${l.id}:${requestId}`, note: po.number, actorEmail: actor },
        )
        const rc: Receipt = { id: crypto.randomUUID(), poId: po.id, lineId: l.id, supplierId: po.supplierId, quantity: r.quantity, itemId: item.id, locationId: item.locationId, condition: item.condition, requestId, actorEmail: actor, at: t }
        d.receipts.push(rc)
        out.push(rc)
      }
      return { receipts: copy(out), replay: false }
    },
    async listReceipts(f = {}) {
      return copy(
        d.receipts
          .filter((r) => (!f.supplierId || r.supplierId === f.supplierId) && (!f.poId || r.poId === f.poId) && (!f.since || r.at >= f.since))
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, f.limit ?? 500),
      )
    },
    async itemsFrom(supplierId, limit = 200) {
      return copy(d.items.filter((i) => i.supplierId === supplierId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit))
    },
  }
}

export function supabaseSupplierStore(db: SupabaseClient): SupplierStore {
  const bad = (e: PgError): never => fail(e, suppliersSetup)
  async function rows<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const { data, error } = await p
    if (error) bad(error)
    return ((data ?? []) as Row[]).map((r) => fromRow<T>(r))
  }
  const SELECT = '*, lines:cc_purchase_order_lines(*)'
  const shape = (po: PurchaseOrder): PurchaseOrder => ({ ...po, lines: ((po.lines ?? []) as unknown as Row[]).map((l) => fromRow<PurchaseOrder['lines'][number]>(l)).sort((a, b) => a.position - b.position) })

  const store: SupplierStore = {
    async listOrders(f = {}) {
      let q = db.from('cc_purchase_orders').select(SELECT).order('created_at', { ascending: false }).limit(f.limit ?? 500)
      if (f.supplierId) q = q.eq('supplier_id', f.supplierId)
      if (f.statuses) q = q.in('status', [...f.statuses])
      if (f.ids) q = q.in('id', [...f.ids])
      return (await rows<PurchaseOrder>(q)).map(shape)
    },
    async getOrder(id) {
      const r = await rows<PurchaseOrder>(db.from('cc_purchase_orders').select(SELECT).eq('id', id).limit(1))
      return r[0] ? shape(r[0]) : null
    },
    async saveOrder(input, actor, id, expectVersion) {
      checkInput(input)
      const r = await rows<PurchaseOrder>(
        db.rpc('cc_po_save', {
          p_id: id ?? null,
          p_expect_version: expectVersion ?? null,
          p_header: { supplier_id: input.supplierId, expected_at: input.expectedAt, note: input.note },
          p_lines: input.lines.map((l) => ({ description: l.description, category: l.category ?? null, quantity: l.quantity, unit_cost_minor: l.unitCostMinor ?? null })),
          p_actor: actor,
        }),
      )
      const po = r[0] ? await store.getOrder(r[0].id) : null
      if (!po) throw new Error('The order was saved but could not be read back.')
      return po
    },
    async setStatus(id, from, version, to) {
      const t = now()
      const patch: Row = { status: to, version: version + 1, updated_at: t }
      if (to === 'received' || to === 'cancelled') patch.closed_at = t
      if (to === 'ordered') patch.ordered_at = t
      const r = await rows<PurchaseOrder>(db.from('cc_purchase_orders').update(patch).eq('id', id).eq('status', from).eq('version', version).select('id'))
      return r[0] ? store.getOrder(id) : null
    },
    async receive(id, lines, requestId, actor) {
      const before = await rows<Receipt>(db.from('cc_po_receipts').select('*').eq('po_id', id).eq('request_id', requestId))
      if (before.length) return { receipts: before, replay: true }
      const receipts = await rows<Receipt>(
        db.rpc('cc_po_receive', {
          p_po: id,
          p_lines: lines.map((l) => toRow({ lineId: l.lineId, quantity: l.quantity, locationId: l.locationId, condition: l.condition })),
          p_request: requestId,
          p_actor: actor,
        }),
      )
      return { receipts, replay: false }
    },
    listReceipts(f = {}) {
      let q = db.from('cc_po_receipts').select('*').order('at', { ascending: false }).limit(f.limit ?? 500)
      if (f.supplierId) q = q.eq('supplier_id', f.supplierId)
      if (f.poId) q = q.eq('po_id', f.poId)
      if (f.since) q = q.gte('at', f.since)
      return rows<Receipt>(q)
    },
    itemsFrom(supplierId, limit = 200) {
      return rows<Item>(db.from('cc_inventory_items').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false }).limit(limit))
    },
  }
  return store
}
