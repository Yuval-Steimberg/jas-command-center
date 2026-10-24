import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import { ConflictError, OpsSetupError } from '@/lib/ops/store'
import { emptyData, memoryStore, type MemoryData } from '@/lib/ops/memory'
import { fail, fromRow, toRow, type PgError, type Row } from '@/lib/ops/supabase'
import type { ItemPatch, ItemStatus } from '@/lib/ops/types'
import { basketProblem, keptQty, type Fulfilment, type Sale, type SaleInput, type SaleLine, type SalePayment, type PaymentMethod } from './model'

/** Migration 0006 has not been run. */
export const salesSetup = () => new OpsSetupError('0006_shop_sales.sql', 'The shop sale tables')

export interface SaleDetail {
  sale: Sale
  lines: SaleLine[]
  payments: SalePayment[]
}

export interface LinePatch {
  fulfilment?: Fulfilment
  address?: string | null
  scheduledFor?: string | null
  timeWindow?: string | null
}

/**
 * Shop sales. Same contract in both implementations (the SQL is in 0006):
 * creating a sale sells every line through the item write path or nothing,
 * and replays by request id; a return locks the line, refuses more than the
 * customer still has, and puts the units back in stock in the same step.
 * Line handover and payments are conditional / idempotent writes.
 */
export interface SalesStore {
  listSales(f?: { since?: string; contactId?: string; ids?: readonly string[]; limit?: number }): Promise<Sale[]>
  getSale(id: string): Promise<SaleDetail | null>
  /** Lines of many sales at once (list pages). */
  linesOf(saleIds: readonly string[]): Promise<SaleLine[]>
  paymentsOf(saleIds: readonly string[]): Promise<SalePayment[]>
  /** Every line that sold these items. */
  linesForItems(itemIds: readonly string[]): Promise<SaleLine[]>
  openLines(limit?: number): Promise<SaleLine[]>
  getLine(id: string): Promise<SaleLine | null>
  createSale(input: SaleInput, requestId: string, actor: string): Promise<{ sale: Sale; replay: boolean }>
  /** open → done. Null when the line is no longer open. */
  closeLine(id: string): Promise<SaleLine | null>
  /** Conditional on the line still being open. */
  updateLine(id: string, patch: LinePatch): Promise<SaleLine | null>
  returnUnits(lineId: string, units: number, expectReturned: number | null, locationId: string | null, reason: string, actor: string): Promise<SaleLine>
  addPayment(saleId: string, p: { amountMinor: number; method: PaymentMethod; note: string | null }, requestId: string, actor: string): Promise<{ payment: SalePayment; replay: boolean }>
}

const g = globalThis as unknown as { __ccOpsData?: MemoryData }

export function getSalesStore(): SalesStore {
  if (authMode().kind === 'supabase') return supabaseSalesStore(supabaseAdmin())
  return memorySalesStore((g.__ccOpsData ??= emptyData()))
}

const now = () => new Date().toISOString()
const copy = <T>(x: T): T => structuredClone(x)
const SELLABLE: readonly ItemStatus[] = ['in_storage', 'listed', 'reserved']

export function memorySalesStore(d: MemoryData): SalesStore {
  const items = memoryStore(d)
  const lines = (saleId: string) => d.saleLines.filter((l) => l.saleId === saleId).sort((a, b) => a.position - b.position)
  return {
    async listSales(f = {}) {
      return copy(
        d.sales
          .filter((s) => (!f.since || s.createdAt >= f.since) && (!f.contactId || s.contactId === f.contactId) && (!f.ids || f.ids.includes(s.id)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, f.limit ?? 500),
      )
    },
    async getSale(id) {
      const sale = d.sales.find((s) => s.id === id)
      if (!sale) return null
      return copy({ sale, lines: lines(id), payments: d.salePayments.filter((p) => p.saleId === id).sort((a, b) => a.at.localeCompare(b.at)) })
    },
    async linesOf(ids) {
      return copy(d.saleLines.filter((l) => ids.includes(l.saleId)))
    },
    async paymentsOf(ids) {
      return copy(d.salePayments.filter((p) => ids.includes(p.saleId)))
    },
    async linesForItems(ids) {
      return copy(d.saleLines.filter((l) => ids.includes(l.itemId)))
    },
    async openLines(limit = 500) {
      return copy(d.saleLines.filter((l) => l.status === 'open').slice(0, limit))
    },
    async getLine(id) {
      return copy(d.saleLines.find((l) => l.id === id) ?? null)
    },
    async createSale(input, requestId, actor) {
      const prior = d.sales.find((s) => s.requestId === requestId)
      if (prior) return { sale: copy(prior), replay: true }
      const problem = basketProblem(input)
      if (problem) throw new ConflictError(problem)
      // Check every line before writing anything (the SQL rolls back instead).
      for (const l of input.lines) {
        const it = d.items.find((i) => i.id === l.itemId)
        if (!it) throw new ConflictError('an item in the basket no longer exists')
        if (!SELLABLE.includes(it.status)) throw new ConflictError(`${it.sku} is ${it.status.replace('_', ' ')}`)
        if (l.version != null && it.version !== l.version) throw new ConflictError(`${it.sku} changed since the basket was loaded`)
        if (it.kind === 'unique' && l.quantity !== 1) throw new ConflictError(`${it.sku} is a single piece`)
        if (l.quantity > it.quantity) throw new ConflictError(`only ${it.quantity} of ${it.sku} left`)
      }
      const t = now()
      const sale: Sale = { id: crypto.randomUUID(), number: `S-${String(++d.saleSeq).padStart(5, '0')}`, contactId: input.contactId, totalMinor: 0, note: input.note, requestId, createdBy: actor, createdAt: t, updatedAt: t }
      d.sales.push(sale)
      let pos = 0
      for (const l of input.lines) {
        const it = d.items.find((i) => i.id === l.itemId)!
        const line: SaleLine = {
          id: crypto.randomUUID(), saleId: sale.id, itemId: it.id, position: ++pos, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, fulfilment: l.fulfilment,
          address: l.address?.trim() || null, scheduledFor: l.scheduledFor || null, timeWindow: l.timeWindow?.trim() || null, status: 'open', doneAt: null, returnedQty: 0, updatedAt: t,
        }
        d.saleLines.push(line)
        sale.totalMinor += l.quantity * l.unitPriceMinor
        const whole = it.kind === 'unique' || l.quantity === it.quantity
        const set: ItemPatch = whole
          ? { status: 'sold', soldChannel: 'in_store', soldAt: t, soldPriceMinor: l.quantity * l.unitPriceMinor, buyerContactId: sale.contactId, reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null, ...(it.kind === 'batch' ? { quantity: 0 } : {}) }
          : { quantity: it.quantity - l.quantity }
        await items.applyItem(it.id, { from: SELLABLE }, set, {
          type: 'sell', refKind: 'sale_line', refId: line.id, actorEmail: actor, quantityDelta: -l.quantity, note: sale.number,
          detail: { channel: 'in_store', priceMinor: l.quantity * l.unitPriceMinor, units: l.quantity, saleId: sale.id, saleNumber: sale.number },
        })
        if (l.fulfilment === 'delivery') {
          await items.createDelivery({ itemId: it.id, contactId: sale.contactId, address: line.address, scheduledFor: line.scheduledFor, timeWindow: line.timeWindow, note: sale.number, createdBy: actor, saleLineId: line.id })
        }
      }
      if (input.payment && input.payment.amountMinor !== 0) {
        d.salePayments.push({ id: crypto.randomUUID(), saleId: sale.id, amountMinor: input.payment.amountMinor, method: input.payment.method, at: t, note: input.payment.note ?? null, requestId: `${requestId}:payment`, actorEmail: actor })
      }
      return { sale: copy(sale), replay: false }
    },
    async closeLine(id) {
      const l = d.saleLines.find((x) => x.id === id && x.status === 'open')
      if (!l) return null
      Object.assign(l, { status: 'done', doneAt: now(), updatedAt: now() })
      return copy(l)
    },
    async updateLine(id, patch) {
      const l = d.saleLines.find((x) => x.id === id && x.status === 'open')
      if (!l) return null
      Object.assign(l, patch, { updatedAt: now() })
      return copy(l)
    },
    async returnUnits(lineId, units, expectReturned, locationId, reason, actor) {
      const l = d.saleLines.find((x) => x.id === lineId)
      if (!l) throw new ConflictError('sale line not found')
      const sale = d.sales.find((s) => s.id === l.saleId)!
      if (!Number.isInteger(units) || units < 1) throw new ConflictError('return at least one unit')
      if (expectReturned != null && l.returnedQty !== expectReturned) throw new ConflictError('this line changed since it was loaded')
      if (units > keptQty(l)) throw new ConflictError(`only ${keptQty(l)} still with the customer`)
      const it = d.items.find((i) => i.id === l.itemId)!
      const back = it.kind === 'unique' || it.status === 'sold' || it.status === 'delivered'
      if (back && it.status !== 'sold' && it.status !== 'delivered') throw new ConflictError(`${it.sku} is ${it.status.replace('_', ' ')}`)
      const set: ItemPatch = back
        ? { status: 'in_storage', locationId: locationId ?? it.locationId, soldChannel: null, soldAt: null, soldPriceMinor: null, buyerContactId: null, websiteOrderId: null, websiteOrderNumber: null, ...(it.kind === 'batch' ? { quantity: units } : {}) }
        : { quantity: it.quantity + units }
      await items.applyItem(it.id, {}, set, {
        type: 'return', refKind: 'sale_line_return', refId: `${l.id}:${l.returnedQty + units}`, actorEmail: actor, quantityDelta: units, note: reason,
        detail: { channel: 'in_store', priceMinor: units * l.unitPriceMinor, units, saleId: sale.id, saleNumber: sale.number },
      })
      l.returnedQty += units
      if (l.returnedQty === l.quantity) {
        l.status = 'returned'
        for (const x of d.deliveries) if (x.saleLineId === l.id && (x.status === 'planned' || x.status === 'failed')) Object.assign(x, { status: 'cancelled', note: `${x.note ? `${x.note} · ` : ''}returned`, updatedAt: now() })
      }
      l.updatedAt = now()
      return copy(l)
    },
    async addPayment(saleId, p, requestId, actor) {
      const prior = d.salePayments.find((x) => x.requestId === requestId)
      if (prior) return { payment: copy(prior), replay: true }
      if (!d.sales.some((s) => s.id === saleId)) throw new ConflictError('sale not found')
      if (!Number.isInteger(p.amountMinor) || p.amountMinor === 0) throw new ConflictError('the amount cannot be zero')
      const payment: SalePayment = { id: crypto.randomUUID(), saleId, amountMinor: p.amountMinor, method: p.method, at: now(), note: p.note, requestId, actorEmail: actor }
      d.salePayments.push(payment)
      return { payment: copy(payment), replay: false }
    },
  }
}

export function supabaseSalesStore(db: SupabaseClient): SalesStore {
  const bad = (e: PgError): never => fail(e, salesSetup)
  async function rows<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const { data, error } = await p
    if (error) bad(error)
    return ((data ?? []) as Row[]).map((r) => fromRow<T>(r))
  }
  /** PostgREST caps a response silently; long id lists go in chunks. */
  async function chunked<T>(ids: readonly string[], q: (part: string[]) => PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const out: T[] = []
    for (let i = 0; i < ids.length; i += 150) out.push(...(await rows<T>(q(ids.slice(i, i + 150)))))
    return out
  }
  const store: SalesStore = {
    listSales(f = {}) {
      let q = db.from('cc_sales').select('*').order('created_at', { ascending: false }).limit(f.limit ?? 500)
      if (f.since) q = q.gte('created_at', f.since)
      if (f.contactId) q = q.eq('contact_id', f.contactId)
      if (f.ids) q = q.in('id', [...f.ids])
      return rows<Sale>(q)
    },
    async getSale(id) {
      const [s, lines, payments] = await Promise.all([
        rows<Sale>(db.from('cc_sales').select('*').eq('id', id).limit(1)),
        rows<SaleLine>(db.from('cc_sale_lines').select('*').eq('sale_id', id).order('position')),
        rows<SalePayment>(db.from('cc_sale_payments').select('*').eq('sale_id', id).order('at')),
      ])
      return s[0] ? { sale: s[0], lines, payments } : null
    },
    linesOf: (ids) => (ids.length ? chunked<SaleLine>(ids, (p) => db.from('cc_sale_lines').select('*').in('sale_id', p).limit(1000)) : Promise.resolve([])),
    paymentsOf: (ids) => (ids.length ? chunked<SalePayment>(ids, (p) => db.from('cc_sale_payments').select('*').in('sale_id', p).limit(1000)) : Promise.resolve([])),
    linesForItems: (ids) => (ids.length ? chunked<SaleLine>(ids, (p) => db.from('cc_sale_lines').select('*').in('item_id', p).limit(1000)) : Promise.resolve([])),
    openLines: (limit = 500) => rows<SaleLine>(db.from('cc_sale_lines').select('*').eq('status', 'open').order('scheduled_for', { ascending: true, nullsFirst: false }).limit(limit)),
    async getLine(id) {
      const r = await rows<SaleLine>(db.from('cc_sale_lines').select('*').eq('id', id).limit(1))
      return r[0] ?? null
    },
    async createSale(input, requestId, actor) {
      const before = await rows<Sale>(db.from('cc_sales').select('*').eq('request_id', requestId).limit(1))
      if (before[0]) return { sale: before[0], replay: true }
      const problem = basketProblem(input)
      if (problem) throw new ConflictError(problem)
      const r = await rows<Sale>(
        db.rpc('cc_sale_create', {
          p_header: {
            contact_id: input.contactId,
            note: input.note,
            ...(input.payment ? { payment: { amount_minor: input.payment.amountMinor, method: input.payment.method, note: input.payment.note ?? null } } : {}),
          },
          p_lines: input.lines.map((l) => ({
            item_id: l.itemId, version: l.version ?? null, quantity: l.quantity, unit_price_minor: l.unitPriceMinor, fulfilment: l.fulfilment,
            address: l.address?.trim() || null, scheduled_for: l.scheduledFor || null, time_window: l.timeWindow?.trim() || null,
          })),
          p_request: requestId,
          p_actor: actor,
        }),
      )
      if (!r[0]) throw new Error('The sale was saved but could not be read back.')
      return { sale: r[0], replay: false }
    },
    async closeLine(id) {
      const t = now()
      const r = await rows<SaleLine>(db.from('cc_sale_lines').update({ status: 'done', done_at: t, updated_at: t }).eq('id', id).eq('status', 'open').select('*'))
      return r[0] ?? null
    },
    async updateLine(id, patch) {
      const r = await rows<SaleLine>(db.from('cc_sale_lines').update({ ...toRow(patch), updated_at: now() }).eq('id', id).eq('status', 'open').select('*'))
      return r[0] ?? null
    },
    async returnUnits(lineId, units, expectReturned, locationId, reason, actor) {
      const r = await rows<SaleLine>(db.rpc('cc_sale_return', { p_line: lineId, p_units: units, p_expect_returned: expectReturned, p_location: locationId, p_reason: reason, p_actor: actor }))
      if (!r[0]) throw new ConflictError('sale line not found')
      return r[0]
    },
    async addPayment(saleId, p, requestId, actor) {
      const before = await rows<SalePayment>(db.from('cc_sale_payments').select('*').eq('request_id', requestId).limit(1))
      if (before[0]) return { payment: before[0], replay: true }
      if (!Number.isInteger(p.amountMinor) || p.amountMinor === 0) throw new ConflictError('the amount cannot be zero')
      const r = await rows<SalePayment>(db.from('cc_sale_payments').insert({ sale_id: saleId, amount_minor: p.amountMinor, method: p.method, note: p.note, request_id: requestId, actor_email: actor }).select('*'))
      return { payment: r[0]!, replay: false }
    },
  }
  return store
}
