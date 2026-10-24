'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { userCan, type CurrentUser } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { getOpsStore } from '@/lib/ops'
import { runAct, formStr as str, formShekels, type ActionState } from '@/lib/ops/act'
import { runOpsSync } from '@/lib/sync/run'
import { upsertContact } from '@/lib/crm/service'
import { moveDelivery } from '@/lib/deliveries/service'
import { FULFILMENTS, PAYMENT_METHODS, basketProblem } from '@/lib/sales/model'
import { createShopSale, handOverLine, recordPayment, returnSaleUnits, setLineFulfilment } from '@/lib/sales/service'

/** Run the website → command center sync now instead of waiting for the hourly sweep. Idempotent. */
export async function syncNowAction(_p: ActionState, _f: FormData): Promise<ActionState> {
  return runAct('inventory', ['inventory:operate'], 'ops.sync', 'sync:now', {}, async () => {
    const r = await runOpsSync()
    if (r.state === 'not_set_up') return { ok: false, message: r.message ?? 'Not set up.' }
    const bad = r.steps.filter((s) => s.state === 'error')
    return { ok: bad.length === 0, message: r.steps.map((s) => s.message).join(' '), warning: bad.length ? `${bad.length} step(s) failed; see below.` : undefined }
  }, ['/sales', '/inventory', '/crm', '/tasks', '/'])
}

// ── Shop sales (migration 0006) ───────────────────────────────────────────
// Every write goes through runAct (permission, audit requested, run, audit outcome).
// The same actions serve the console (/sales) and shop mode (/shop).

const uuid = z.string().uuid()
const actorOf = (u: CurrentUser) => ({ email: u.email, name: u.name })
const base = (f: FormData) => (f.get('base') === '/shop' ? '/shop' : '/sales')
const SALE_PATHS = ['/sales', '/shop', '/inventory', '/deliveries', '/crm']

const basket = z.object({
  requestId: z.string().min(8).max(100),
  contactId: z.string().uuid().nullable(),
  newContact: z.object({ name: z.string().max(200), phone: z.string().max(40), email: z.string().max(200) }).nullable(),
  note: z.string().max(1000).nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        version: z.number().int().positive().optional(),
        quantity: z.number().int().min(1).max(10_000),
        unitPriceMinor: z.number().int().min(0).max(100_000_000),
        fulfilment: z.enum(FULFILMENTS),
        address: z.string().max(300).nullable().optional(),
        scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        timeWindow: z.string().max(60).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
  payment: z.object({ amountMinor: z.number().int().min(1).max(100_000_000), method: z.enum(PAYMENT_METHODS), note: z.string().max(300).nullable().optional() }).nullable(),
})

/** Checkout: the basket arrives as one JSON field built by the checkout screen. */
export async function createSaleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let parsed: z.infer<typeof basket>
  try {
    parsed = basket.parse(JSON.parse(String(f.get('basket') ?? '')))
  } catch {
    return { ok: false, message: 'The basket could not be read. Reload and try again.' }
  }
  const problem = basketProblem({ ...parsed, lines: parsed.lines, payment: parsed.payment })
  if (problem) return { ok: false, message: problem }
  let saleId = ''
  const res = await runAct('inventory', ['inventory:financial'], 'sale.create', `sale:${parsed.requestId}`, { lines: parsed.lines.length, totalMinor: parsed.lines.reduce((a, l) => a + l.quantity * l.unitPriceMinor, 0), paidMinor: parsed.payment?.amountMinor ?? 0 }, async (u) => {
    let contactId = parsed.contactId
    if (!contactId && parsed.newContact && (parsed.newContact.phone.trim() || parsed.newContact.email.trim())) {
      if (!parsed.newContact.name.trim()) return { ok: false, message: 'Give the new customer a name.' }
      if (!(await userCan('crm:write'))) return { ok: false, message: 'Your role cannot add customers; pick an existing one.' }
      const c = await upsertContact({ name: parsed.newContact.name, email: parsed.newContact.email || null, phone: parsed.newContact.phone || null, role: 'customer', source: 'in_store' })
      if (!c) return { ok: false, message: 'The new customer needs a valid phone or email.' }
      await audit(u, { action: c.created ? 'crm.contact.create' : 'crm.contact.update', product: 'crm', target: `contact:${c.contact.id}`, outcome: 'succeeded', detail: { via: 'sale', role: 'customer' } })
      contactId = c.contact.id
    }
    if (!contactId && parsed.lines.some((l) => l.fulfilment === 'delivery')) return { ok: false, message: 'A delivery needs a customer to call. Pick or add one.' }
    const r = await createShopSale({ contactId, note: parsed.note, lines: parsed.lines, payment: parsed.payment }, parsed.requestId, actorOf(u))
    if (r.ok) saleId = r.sale.id
    return r
  }, SALE_PATHS)
  if (res.ok && saleId) redirect(`${base(f)}/sales/${saleId}`.replace('/sales/sales/', '/sales/'))
  return res
}

/** A pickup was collected; a delivery line is closed through its delivery (which also closes the delivery). */
export async function handOverAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('lineId'))
  if (!id.success) return { ok: false, message: 'Invalid line.' }
  return runAct('inventory', ['inventory:operate'], 'sale.handover', `sale_line:${id.data}`, {}, async (u) => {
    const ops = getOpsStore()
    const open = (await ops.listDeliveries({ saleLineIds: [id.data] })).find((d) => d.status === 'planned' || d.status === 'out' || d.status === 'failed')
    if (open) return moveDelivery(open, 'done', null, actorOf(u), false)
    return handOverLine(id.data, actorOf(u))
  }, SALE_PATHS)
}

export async function lineFulfilmentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('lineId'))
  const to = z.enum(FULFILMENTS).safeParse(f.get('to'))
  if (!id.success || !to.success) return { ok: false, message: 'Invalid request.' }
  const date = str(f, 'date', 10)
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: 'Pick the date from the calendar.' }
  return runAct('inventory', ['inventory:operate'], 'sale.fulfilment', `sale_line:${id.data}`, { to: to.data, date }, (u) =>
    setLineFulfilment(id.data, to.data, { address: str(f, 'address', 300), scheduledFor: date, timeWindow: str(f, 'window', 60) }, actorOf(u)),
  SALE_PATHS)
}

export async function returnLineAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('lineId'))
  const units = Number(f.get('units') || 1)
  const expect = Number(f.get('returned'))
  if (!id.success || !Number.isInteger(units) || units < 1) return { ok: false, message: 'Invalid request.' }
  const reason = str(f, 'reason', 500)
  if (!reason || reason.length < 3) return { ok: false, message: 'Say why it came back.' }
  const loc = uuid.safeParse(f.get('locationId'))
  return runAct('inventory', ['inventory:financial'], 'sale.return', `sale_line:${id.data}`, { units, reason }, (u) =>
    returnSaleUnits(id.data, units, Number.isInteger(expect) ? expect : null, loc.success ? loc.data : null, reason, actorOf(u)),
  SALE_PATHS)
}

/** A payment or a refund, recorded by hand. One form load = one request id, so a double click records once. */
export async function paymentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('saleId'))
  const amount = formShekels(f, 'amount')
  const method = z.enum(PAYMENT_METHODS).safeParse(f.get('method'))
  const requestId = String(f.get('requestId') ?? '')
  if (!id.success || !method.success || requestId.length < 8) return { ok: false, message: 'Invalid request.' }
  if (!amount || Number.isNaN(amount)) return { ok: false, message: 'Enter the amount in ₪.' }
  const refund = f.get('kind') === 'refund'
  return runAct('inventory', ['inventory:financial'], refund ? 'sale.refund' : 'sale.payment', `sale:${id.data}`, { amountMinor: refund ? -amount : amount, method: method.data }, (u) =>
    recordPayment(id.data, { amountMinor: refund ? -amount : amount, method: method.data, note: str(f, 'note', 300) }, requestId, actorOf(u)),
  SALE_PATHS)
}
