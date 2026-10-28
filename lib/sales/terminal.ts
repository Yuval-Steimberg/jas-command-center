import 'server-only'
import { env } from '@/lib/env'
import { audit } from '@/lib/audit/audit'
import { getOpsStore } from '@/lib/ops'
import { ConflictError } from '@/lib/ops/store'
import { touchContact } from '@/lib/crm/service'
import { formatAgorot } from '@/lib/money'
import {
  TERMINAL_WAIT_MS, approveForm, createProcessForm, flattenUpdate, parseProcessResponse, readUpdate, sameSecret, terminalSetup,
  type GrowTerminalConfig, type ServerUpdate, type TerminalSetup,
} from '@/lib/payments/grow-terminal'
import { getSalesStore } from './store'
import { getTerminalStore } from './terminal-store'
import { saleMoney, type TerminalCharge } from './model'

/**
 * The shop's Grow terminal, across systems. A sale already sold its items
 * (inventory + website stock, lib/sales/service.ts); the terminal only
 * collects the money. Its result lands as an ordinary sale payment, so the
 * sale page, the balance, the analytics and the customer's timeline all read
 * it from the one place they already read payments.
 */
export type Actor = { email: string; name?: string | null }
export type TerminalResult = { ok: boolean; message: string; warning?: string }

const GROW_ACTOR = 'Grow terminal'
const SYSTEM = { id: 'system', email: 'grow-webhook', role: 'system' } as const

export function growTerminalSetup(): TerminalSetup {
  return terminalSetup(env().growTerminal)
}

/** What the sale page needs: whether the terminal is on, its device names, and this sale's charges. */
export async function terminalView(saleId: string): Promise<{ on: boolean; missing: string[]; devices: string[]; charges: TerminalCharge[] }> {
  const s = growTerminalSetup()
  if (!s.on) return { on: false, missing: s.missing, devices: [], charges: [] }
  try {
    return { on: true, missing: [], devices: s.config.devices.map((d) => d.name), charges: await getTerminalStore().forSale(saleId) }
  } catch (e) {
    // The keys are in but 0007 is not run: the sale page must still load.
    return { on: false, missing: [why(e)], devices: [], charges: [] }
  }
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const notifyUrl = (c: GrowTerminalConfig) => `${env().cc.appUrl}/api/webhooks/grow?token=${encodeURIComponent(c.webhookSecret)}`

async function post(c: GrowTerminalConfig, endpoint: string, form: URLSearchParams): Promise<unknown> {
  const res = await fetch(`${c.base}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`Grow answered ${res.status} without JSON`)
  }
}

/**
 * Push an amount to a terminal. One form load = one request id, so a double
 * press creates one charge. Refuses a second push while one is still waiting
 * on the terminal, so a customer is never asked to pay twice for one sale.
 */
export async function startTerminalCharge(saleId: string, amountMinor: number, deviceName: string | null, requestId: string, actor: Actor): Promise<TerminalResult> {
  const s = growTerminalSetup()
  if (!s.on) return { ok: false, message: `The card terminal is not connected yet (missing ${s.missing.join(', ')}).` }
  const c = s.config
  const device = deviceName ? c.devices.find((d) => d.name === deviceName) : c.devices[0]
  if (!device) return { ok: false, message: 'Pick a terminal.' }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, message: 'Enter the amount in ₪.' }

  const detail = await getSalesStore().getSale(saleId)
  if (!detail) return { ok: false, message: 'Sale not found.' }
  const m = saleMoney(detail.sale, detail.lines, detail.payments)
  if (amountMinor > m.balanceMinor) return { ok: false, message: `Only ${formatAgorot(Math.max(0, m.balanceMinor))} is still to pay on this sale.` }

  const store = getTerminalStore()
  const waiting = (await store.forSale(saleId)).find((x) => x.status === 'sent' && x.requestId !== requestId && Date.now() - Date.parse(x.createdAt) < TERMINAL_WAIT_MS)
  if (waiting) return { ok: false, message: `${formatAgorot(waiting.amountMinor)} is already waiting on the terminal. Finish it there, or cancel it here first.` }

  const { charge, replay } = await store.create({ saleId, amountMinor, device: device.name, requestId, createdBy: actor.email })
  if (replay) return charge.url ? { ok: true, message: 'Already sent. Open the link to push it to the terminal.' } : { ok: false, message: charge.error ?? 'Already tried.' }

  let fullName: string | null = null
  let phone: string | null = null
  if (detail.sale.contactId) {
    const ct = await getOpsStore().getContact(detail.sale.contactId).catch(() => null)
    fullName = ct?.fullName ?? null
    phone = ct?.phone ?? null
  }
  let res
  try {
    res = parseProcessResponse(await post(c, 'createPaymentProcess', createProcessForm(c, {
      amountMinor, deviceKey: device.key, chargeId: charge.id, description: `Just A Second ${detail.sale.number}`, notifyUrl: notifyUrl(c), returnUrl: `${env().cc.appUrl}/shop/sales/${saleId}`, fullName, phone,
    })))
  } catch (e) {
    res = { ok: false as const, message: why(e) }
  }
  if (!res.ok) {
    await store.update(charge.id, ['sent'], { status: 'failed', error: res.message })
    return { ok: false, message: `Grow refused the charge: ${res.message}` }
  }
  await store.update(charge.id, ['sent'], { url: res.url, processId: res.processId })
  return { ok: true, message: `${formatAgorot(amountMinor)} ready for ${device.name}. Open the link to send it to the terminal.` }
}

/** Stop waiting here. The terminal itself is cancelled on the terminal; a payment made anyway is still recorded. */
export async function cancelTerminalCharge(chargeId: string): Promise<TerminalResult> {
  const r = await getTerminalStore().update(chargeId, ['sent'], { status: 'cancelled' })
  if (!r) return { ok: false, message: 'This charge is no longer waiting.' }
  return { ok: true, message: 'Cancelled here. Cancel it on the terminal too. If the customer pays anyway, the payment is still recorded.' }
}

export type UpdateOutcome = { status: number; body: Record<string, unknown> }

/**
 * Grow's server update (per-request notifyUrl, or the account webhook pointed
 * at the same route). Never 4xx's on an update that is simply not ours: the
 * account webhook also carries the website's and gift cards' sales.
 */
export async function receiveServerUpdate(rawBody: string, contentType: string, token: string | null): Promise<UpdateOutcome> {
  const s = growTerminalSetup()
  if (!s.on) return { status: 404, body: { error: 'not found' } }
  if (!token || !sameSecret(token, s.config.webhookSecret)) return { status: 401, body: { error: 'unauthorized' } }
  const u = readUpdate(flattenUpdate(rawBody, contentType))
  const store = getTerminalStore()
  const charge = (u.chargeId ? await store.get(u.chargeId) : null) ?? (u.processId ? await store.byProcessId(u.processId) : null)
  if (!charge) return { status: 200, body: { ok: true, ignored: 'not a terminal charge' } }
  return { status: 200, body: await applyUpdate(s.config, charge, u) }
}

async function applyUpdate(c: GrowTerminalConfig, charge: TerminalCharge, u: ServerUpdate): Promise<Record<string, unknown>> {
  const store = getTerminalStore()
  const target = `terminal_charge:${charge.id}`
  if (!u.paid) {
    // A failure never overrides a payment, and is only news while the charge waits.
    await store.update(charge.id, ['sent'], { status: 'failed', error: `Grow reported no payment${u.statusCode ? ` (status ${u.statusCode})` : ''}.`, raw: u.fields })
    await audit(SYSTEM, { via: 'system', action: 'sale.terminal_update', product: 'inventory', target, outcome: 'failed', detail: { saleId: charge.saleId, statusCode: u.statusCode } })
    return { ok: true, paid: false }
  }

  await audit(SYSTEM, { via: 'system', action: 'sale.terminal_payment', product: 'inventory', target, outcome: 'requested', detail: { saleId: charge.saleId, paidMinor: u.paidMinor, transactionId: u.transactionId } })
  const mismatch = u.paidMinor !== charge.amountMinor
  const note = [`Grow ${charge.device}`, u.asmachta ? `אסמכתא ${u.asmachta}` : null, u.cardSuffix ? `****${u.cardSuffix}` : null, mismatch ? `sent ${formatAgorot(charge.amountMinor)}` : null].filter(Boolean).join(' · ')
  let paymentId: string
  let replay: boolean
  try {
    // The card was charged: record exactly what Grow says was taken, whatever this charge's state.
    const pay = () => getSalesStore().addPayment(charge.saleId, { amountMinor: u.paidMinor, method: 'card', note }, `grow:${u.transactionId}`, GROW_ACTOR)
    // Two copies of one update racing: the loser hits the unique request id, and a second read replays.
    const r = await pay().catch((e) => (e instanceof ConflictError ? pay() : Promise.reject(e)))
    paymentId = r.payment.id
    replay = r.replay
  } catch (e) {
    await audit(SYSTEM, { via: 'system', action: 'sale.terminal_payment', product: 'inventory', target, outcome: 'failed', detail: { saleId: charge.saleId, error: why(e) } })
    throw e instanceof ConflictError ? new Error(e.message) : e
  }
  const moved = await store.update(charge.id, ['sent', 'failed', 'cancelled'], {
    status: 'paid', transactionId: u.transactionId, asmachta: u.asmachta, cardSuffix: u.cardSuffix, paidMinor: u.paidMinor, paymentId, error: null, raw: u.fields,
  })
  const current = moved ?? (await store.get(charge.id))!

  // Tell Grow we have it. A failed approve is kept on the charge (and shown); the money is already recorded.
  if (!current.approvedAt) {
    let approveError: string | null = null
    try {
      const a = (await post(c, 'approveTransaction', approveForm(c, u))) as Record<string, unknown> | unknown[]
      const r = (Array.isArray(a) ? a[0] : a) as Record<string, unknown> | undefined
      if (String(r?.status) !== '1') approveError = (r?.err as { message?: string })?.message ?? 'Grow did not confirm the approve call.'
    } catch (e) {
      approveError = why(e)
    }
    await store.update(charge.id, ['paid'], approveError ? { approveError } : { approvedAt: new Date().toISOString(), approveError: null })
  }

  // The customer's timeline, keyed by the payment so a replayed update writes it once (and heals a failed write).
  let warning: string | undefined
  const sale = (await getSalesStore().getSale(charge.saleId))?.sale
  if (sale?.contactId) {
    try {
      await touchContact(sale.contactId, { channel: 'in_person', direction: 'none', summary: `Paid ${formatAgorot(u.paidMinor)} by card on the shop terminal (${sale.number})`, refKind: 'sale_payment', refId: paymentId }, GROW_ACTOR)
    } catch (e) {
      warning = `timeline not updated: ${why(e)}`
    }
  }
  await audit(SYSTEM, {
    via: 'system', action: 'sale.terminal_payment', product: 'inventory', target, outcome: 'succeeded',
    detail: { saleId: charge.saleId, paidMinor: u.paidMinor, sentMinor: charge.amountMinor, replay, wasStatus: charge.status, ...(warning ? { warning } : {}) },
  })
  return { ok: true, paid: true, replay }
}
