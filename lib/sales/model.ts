/**
 * Shop sales (migration 0006). Pure: types and the money rules, so the store,
 * the pages and the tests share one definition.
 *
 * A sale groups one or more lines for one customer. A line is one item (or
 * some units of a lot) at its own price, handed over its own way: picked up,
 * or delivered on its own day. Payments are recorded by hand and summed; a
 * refund is a negative payment. Returns never change the sale total, they
 * lower what is due.
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
  /** Σ quantity × unit price when sold. Returns do not change it. */
  totalMinor: number
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
  payment?: { amountMinor: number; method: PaymentMethod; note?: string | null } | null
}

export type PaymentState = 'unpaid' | 'deposit' | 'paid' | 'overpaid' | 'nothing_due'
export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = { unpaid: 'Unpaid', deposit: 'Deposit paid', paid: 'Paid', overpaid: 'Refund owed', nothing_due: 'Nothing due' }

export const lineValue = (l: Pick<SaleLine, 'quantity' | 'unitPriceMinor'>) => l.quantity * l.unitPriceMinor
export const returnedValue = (l: Pick<SaleLine, 'returnedQty' | 'unitPriceMinor'>) => l.returnedQty * l.unitPriceMinor
/** Units still with the customer (sold and not returned). */
export const keptQty = (l: Pick<SaleLine, 'quantity' | 'returnedQty'>) => l.quantity - l.returnedQty

export interface SaleMoney {
  totalMinor: number
  returnedMinor: number
  /** What the customer owes for what they kept. */
  dueMinor: number
  paidMinor: number
  /** Positive = still to collect; negative = to refund. */
  balanceMinor: number
  state: PaymentState
}

export function saleMoney(sale: Pick<Sale, 'totalMinor'>, lines: Pick<SaleLine, 'returnedQty' | 'unitPriceMinor'>[], payments: Pick<SalePayment, 'amountMinor'>[]): SaleMoney {
  const returnedMinor = lines.reduce((a, l) => a + returnedValue(l), 0)
  const dueMinor = Math.max(0, sale.totalMinor - returnedMinor)
  const paidMinor = payments.reduce((a, p) => a + p.amountMinor, 0)
  const balanceMinor = dueMinor - paidMinor
  const state: PaymentState =
    dueMinor === 0 && paidMinor === 0 ? 'nothing_due' : balanceMinor < 0 ? 'overpaid' : paidMinor <= 0 ? 'unpaid' : balanceMinor === 0 ? 'paid' : 'deposit'
  return { totalMinor: sale.totalMinor, returnedMinor, dueMinor, paidMinor, balanceMinor, state }
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
