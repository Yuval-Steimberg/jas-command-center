/**
 * Shop sales (migration 0006). Pure: types and the money rules, so the store,
 * the pages and the tests share one definition.
 *
 * A sale groups one or more lines for one customer. A line is one item (or
 * some units of a lot) at its own price, handed over its own way: picked up,
 * or delivered on its own day. Payments are recorded by hand and summed; a
 * refund is a negative payment. Returns never change the sale total, they
 * lower what is due.
 *
 * A discount (migration 0009) is given on the whole sale and spread over its
 * lines in proportion to their value (`spreadDiscount`), so each line, the
 * item's sold price, the analytics movements and a later return all carry the
 * price the customer actually paid. A coupon code is recorded as typed; it is
 * not checked against the website's or the gift cards' codes.
 */

export const FULFILMENTS = ['pickup', 'delivery'] as const
export type Fulfilment = (typeof FULFILMENTS)[number]

export const LINE_STATUSES = ['open', 'done', 'returned'] as const
export type LineStatus = (typeof LINE_STATUSES)[number]

export const PAYMENT_METHODS = ['cash', 'card', 'bit', 'transfer', 'grow_link', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card (terminal)', bit: 'Bit', transfer: 'Bank transfer', grow_link: 'Grow payment link', other: 'Other' }

export interface Sale {
  id: string
  number: string
  contactId: string | null
  /** Σ line values after the discount, when sold. Returns do not change it. */
  totalMinor: number
  /** The discount given on the sale (0009); absent on a database before it. */
  discountMinor?: number
  /** As typed at the counter, never validated (0009). */
  couponCode?: string | null
  note: string | null
  requestId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface SaleLine {
  id: string
  saleId: string
  itemId: string
  position: number
  quantity: number
  unitPriceMinor: number
  /** This line's share of the sale discount (0009). */
  discountMinor?: number
  fulfilment: Fulfilment
  address: string | null
  /** YYYY-MM-DD */
  scheduledFor: string | null
  timeWindow: string | null
  status: LineStatus
  doneAt: string | null
  returnedQty: number
  updatedAt: string
}

export interface SalePayment {
  id: string
  saleId: string
  /** Agorot; negative for a refund. */
  amountMinor: number
  method: PaymentMethod
  at: string
  note: string | null
  requestId: string
  actorEmail: string
}

export interface SaleLineInput {
  itemId: string
  /** The item version the basket was built from; a changed item is refused. */
  version?: number
  quantity: number
  unitPriceMinor: number
  fulfilment: Fulfilment
  address?: string | null
  scheduledFor?: string | null
  timeWindow?: string | null
}
export interface SaleInput {
  contactId: string | null
  note: string | null
  lines: SaleLineInput[]
  /** Off the whole sale, in agorot; ≤ the lines' value. */
  discountMinor?: number
  couponCode?: string | null
  payment?: { amountMinor: number; method: PaymentMethod; note?: string | null } | null
}

export type PaymentState = 'unpaid' | 'deposit' | 'paid' | 'overpaid' | 'nothing_due'
export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = { unpaid: 'Unpaid', deposit: 'Deposit paid', paid: 'Paid', overpaid: 'Refund owed', nothing_due: 'Nothing due' }

/** Before the discount. */
export const lineGross = (l: Pick<SaleLine, 'quantity' | 'unitPriceMinor'>) => l.quantity * l.unitPriceMinor
type Priced = Pick<SaleLine, 'quantity' | 'unitPriceMinor' | 'discountMinor'>
/** What the customer pays for the line: after its share of the discount. */
export const lineValue = (l: Priced) => lineGross(l) - (l.discountMinor ?? 0)
/** The line's share of the discount for `units` of it; all units = the whole share, exactly. */
export const discountFor = (l: Priced, units: number) => Math.floor(((l.discountMinor ?? 0) * units) / l.quantity)
/** What returned units were paid for (so what a refund gives back). */
export const unitsValue = (l: Priced, units: number) => units * l.unitPriceMinor - discountFor(l, units)
export const returnedValue = (l: Priced & Pick<SaleLine, 'returnedQty'>) => unitsValue(l, l.returnedQty)

export const MAX_COUPON = 60

/**
 * Split a sale discount over lines in proportion to their gross value, in
 * whole agorot (largest remainder, ties to the earlier line). Σ = discount.
 */
export function spreadDiscount(gross: readonly number[], discountMinor: number): number[] {
  const total = gross.reduce((a, g) => a + g, 0)
  if (discountMinor <= 0 || total <= 0) return gross.map(() => 0)
  const exact = gross.map((g) => (g * discountMinor) / total)
  const out = exact.map(Math.floor)
  let left = discountMinor - out.reduce((a, x) => a + x, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    if (out[i]! < gross[i]!) { out[i] = out[i]! + 1; left-- }
  }
  return out
}

/** A discount typed as ₪ or %, in agorot (rounded to the agora), or null when unreadable. */
export function discountFromInput(kind: 'amount' | 'percent', value: string, grossMinor: number): number | null {
  const v = value.replace(/[₪%,\s]/g, '')
  if (v === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const n = Number(v)
  return kind === 'percent' ? (n > 100 ? null : Math.round((grossMinor * n) / 100)) : Math.round(n * 100)
}

/** Units still with the customer (sold and not returned). */
export const keptQty = (l: Pick<SaleLine, 'quantity' | 'returnedQty'>) => l.quantity - l.returnedQty

export interface SaleMoney {
  /** After the discount. */
  totalMinor: number
  discountMinor: number
  returnedMinor: number
  /** What the customer owes for what they kept. */
  dueMinor: number
  paidMinor: number
  /** Positive = still to collect; negative = to refund. */
  balanceMinor: number
  state: PaymentState
}

export function saleMoney(sale: Pick<Sale, 'totalMinor' | 'discountMinor'>, lines: Pick<SaleLine, 'returnedQty' | 'quantity' | 'unitPriceMinor' | 'discountMinor'>[], payments: Pick<SalePayment, 'amountMinor'>[]): SaleMoney {
  const returnedMinor = lines.reduce((a, l) => a + returnedValue(l), 0)
  const dueMinor = Math.max(0, sale.totalMinor - returnedMinor)
  const paidMinor = payments.reduce((a, p) => a + p.amountMinor, 0)
  const balanceMinor = dueMinor - paidMinor
  const state: PaymentState =
    dueMinor === 0 && paidMinor === 0 ? 'nothing_due' : balanceMinor < 0 ? 'overpaid' : paidMinor <= 0 ? 'unpaid' : balanceMinor === 0 ? 'paid' : 'deposit'
  return { totalMinor: sale.totalMinor, discountMinor: sale.discountMinor ?? 0, returnedMinor, dueMinor, paidMinor, balanceMinor, state }
}

/** Every line handed over or returned. */
export const saleClosed = (lines: Pick<SaleLine, 'status'>[]) => lines.length > 0 && lines.every((l) => l.status !== 'open')

/** A problem with a basket line before it is sent, or null. */
export function lineProblem(l: SaleLineInput): string | null {
  if (!Number.isInteger(l.quantity) || l.quantity < 1) return 'Each line needs a quantity of at least 1.'
  if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) return 'Each line needs a price.'
  if (!(FULFILMENTS as readonly string[]).includes(l.fulfilment)) return 'Each line is picked up or delivered.'
  if (l.fulfilment === 'delivery' && !l.address?.trim()) return 'A delivery needs an address.'
  if (l.scheduledFor && !/^\d{4}-\d{2}-\d{2}$/.test(l.scheduledFor)) return 'Pick the delivery date from the calendar.'
  return null
}

export function basketProblem(input: SaleInput): string | null {
  if (!input.lines.length) return 'Add at least one item.'
  const ids = new Set<string>()
  for (const l of input.lines) {
    if (ids.has(l.itemId)) return 'The same item is in the basket twice: sell more units on one line.'
    ids.add(l.itemId)
    const p = lineProblem(l)
    if (p) return p
  }
  const gross = input.lines.reduce((a, l) => a + l.quantity * l.unitPriceMinor, 0)
  const d = input.discountMinor ?? 0
  if (!Number.isInteger(d) || d < 0) return 'The discount must be a positive amount.'
  if (d > gross) return 'The discount is larger than the sale.'
  if ((input.couponCode ?? '').length > MAX_COUPON) return `A coupon code is at most ${MAX_COUPON} characters.`
  if (input.payment && (!Number.isInteger(input.payment.amountMinor) || input.payment.amountMinor <= 0)) return 'A payment at checkout must be above zero.'
  return null
}

/**
 * One push of an amount to the shop's Grow terminal (migration 0007).
 * sent → paid when Grow's server update says so; sent → failed / cancelled
 * otherwise. A late "paid" update still records the money, whatever the state:
 * the customer's card was charged.
 */
export const TERMINAL_STATUSES = ['sent', 'paid', 'failed', 'cancelled'] as const
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

export interface TerminalCharge {
  id: string
  saleId: string
  amountMinor: number
  /** The device name from GROW_TERMINAL_DEVICES (never its key). */
  device: string
  status: TerminalStatus
  /** Opening it pushes the amount to the terminal. */
  url: string | null
  processId: string | null
  transactionId: string | null
  asmachta: string | null
  cardSuffix: string | null
  /** What Grow says was charged; can differ from amountMinor. */
  paidMinor: number | null
  paymentId: string | null
  approvedAt: string | null
  approveError: string | null
  error: string | null
  /** The last server update, as received (minus nothing: Grow sends no card number). */
  raw: Record<string, string> | null
  requestId: string
  createdBy: string
  createdAt: string
  updatedAt: string
}
