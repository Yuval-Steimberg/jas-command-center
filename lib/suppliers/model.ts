/**
 * Suppliers, purchase orders and receiving (migration 0004). Pure: types,
 * the status rules and the per-supplier figures, so tests and pages share them.
 *
 * A supplier is a contact with the `supplier` role. An order is a list of
 * lines (what, how many, unit cost); receiving creates inventory items and is
 * the only thing that moves an order towards "received".
 */

export const PO_STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const
export type PoStatus = (typeof PO_STATUSES)[number]

export const PO_STATUS_LABEL: Record<PoStatus, string> = { draft: 'Draft', ordered: 'Ordered', partial: 'Partly received', received: 'Received', cancelled: 'Cancelled' }

export interface PoLine {
  id: string
  poId: string
  position: number
  description: string
  category: string | null
  quantity: number
  /** Agorot per unit; null when the price is not known yet. */
  unitCostMinor: number | null
  receivedQty: number
}

export interface PurchaseOrder {
  id: string
  number: string
  supplierId: string
  status: PoStatus
  /** YYYY-MM-DD */
  expectedAt: string | null
  note: string | null
  orderedAt: string | null
  closedAt: string | null
  version: number
  createdBy: string
  createdAt: string
  updatedAt: string
  lines: PoLine[]
}

export interface Receipt {
  id: string
  poId: string
  lineId: string
  supplierId: string
  quantity: number
  itemId: string
  locationId: string | null
  condition: string | null
  requestId: string
  actorEmail: string
  at: string
}

export type PoLineInput = Pick<PoLine, 'description' | 'quantity'> & Partial<Pick<PoLine, 'category' | 'unitCostMinor'>>
export interface PoInput {
  supplierId: string
  expectedAt: string | null
  note: string | null
  lines: PoLineInput[]
}
export interface ReceiveLine {
  lineId: string
  quantity: number
  locationId: string | null
  condition: string | null
}

export const OPEN_PO: readonly PoStatus[] = ['draft', 'ordered', 'partial']
export const RECEIVABLE: readonly PoStatus[] = ['draft', 'ordered', 'partial']

/** Lines (and supplier / date) can change only before anything arrived. */
export const editable = (po: PurchaseOrder) => (po.status === 'draft' || po.status === 'ordered') && po.lines.every((l) => l.receivedQty === 0)

/** The status moves a person makes; receiving moves the rest. */
export function nextStatuses(po: PurchaseOrder): PoStatus[] {
  const nothingIn = po.lines.every((l) => l.receivedQty === 0)
  if (po.status === 'draft') return ['ordered', 'cancelled']
  if (po.status === 'ordered') return nothingIn ? ['cancelled'] : []
  // "The rest is not coming": closes a partly received order as received.
  if (po.status === 'partial') return ['received']
  return []
}

export const remaining = (l: PoLine) => l.quantity - l.receivedQty

export interface PoTotals {
  /** Sum of qty × unit cost over lines that have a cost (agorot). */
  orderedMinor: number
  receivedMinor: number
  /** Lines without a unit cost: the totals are a lower bound when > 0. */
  uncosted: number
  units: number
  unitsReceived: number
}

export function poTotals(po: Pick<PurchaseOrder, 'lines'>): PoTotals {
  const t: PoTotals = { orderedMinor: 0, receivedMinor: 0, uncosted: 0, units: 0, unitsReceived: 0 }
  for (const l of po.lines) {
    t.units += l.quantity
    t.unitsReceived += l.receivedQty
    if (l.unitCostMinor == null) t.uncosted++
    else {
      t.orderedMinor += l.quantity * l.unitCostMinor
      t.receivedMinor += l.receivedQty * l.unitCostMinor
    }
  }
  return t
}

/** Israel's calendar day for "today", so an order due today is not overdue at 23:00 UTC. */
export const israelDay = (now = Date.now()) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })

export const isOverdue = (po: Pick<PurchaseOrder, 'status' | 'expectedAt'>, now = Date.now()) =>
  (po.status === 'ordered' || po.status === 'partial') && !!po.expectedAt && po.expectedAt < israelDay(now)

export interface SupplierStats {
  orders: number
  open: number
  overdue: number
  /** Value of what actually arrived (agorot), over costed lines only. */
  receivedMinor: number
  /** Value still to come on open orders. */
  onOrderMinor: number
  uncostedLines: number
  /** Of the closed-with-goods orders that had a due date, the share whose last receipt came on or before it. */
  onTime: { early: number; late: number }
  lastOrderAt: string | null
  lastReceiptAt: string | null
}

export function supplierStats(orders: PurchaseOrder[], receipts: Receipt[], now = Date.now()): SupplierStats {
  const s: SupplierStats = { orders: 0, open: 0, overdue: 0, receivedMinor: 0, onOrderMinor: 0, uncostedLines: 0, onTime: { early: 0, late: 0 }, lastOrderAt: null, lastReceiptAt: null }
  const lastReceipt = new Map<string, string>()
  for (const r of receipts) {
    if (!lastReceipt.has(r.poId) || r.at > lastReceipt.get(r.poId)!) lastReceipt.set(r.poId, r.at)
    if (!s.lastReceiptAt || r.at > s.lastReceiptAt) s.lastReceiptAt = r.at
  }
  for (const po of orders) {
    if (po.status === 'cancelled') continue
    s.orders++
    const t = poTotals(po)
    s.receivedMinor += t.receivedMinor
    s.uncostedLines += t.uncosted
    if (OPEN_PO.includes(po.status)) {
      s.open++
      s.onOrderMinor += t.orderedMinor - t.receivedMinor
    }
    if (isOverdue(po, now)) s.overdue++
    const at = po.orderedAt ?? po.createdAt
    if (!s.lastOrderAt || at > s.lastOrderAt) s.lastOrderAt = at
    const last = lastReceipt.get(po.id)
    if (po.status === 'received' && po.expectedAt && last) {
      if (new Date(last).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }) <= po.expectedAt) s.onTime.early++
      else s.onTime.late++
    }
  }
  return s
}

/** Validate typed order lines: description, whole quantity 1–10,000, cost ≥ 0. Returns the problem or null. */
export function lineProblem(l: PoLineInput): string | null {
  if (!l.description.trim()) return 'Every line needs a description.'
  if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 10_000) return `"${l.description}": quantity must be a whole number from 1 to 10,000.`
  if (l.unitCostMinor != null && (!Number.isInteger(l.unitCostMinor) || l.unitCostMinor < 0 || l.unitCostMinor > 100_000_000)) return `"${l.description}": unit cost is not a valid amount.`
  return null
}
