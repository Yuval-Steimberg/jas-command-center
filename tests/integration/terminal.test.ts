import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeServer, resetSourceCache, type Req } from './fake-server'
import { getOpsStore } from '@/lib/ops'
import { emptyData } from '@/lib/ops/memory'
import { getSalesStore } from '@/lib/sales/store'
import { getTerminalStore } from '@/lib/sales/terminal-store'
import { saleMoney } from '@/lib/sales/model'
import { createShopSale } from '@/lib/sales/service'
import { cancelTerminalCharge, receiveServerUpdate, startTerminalCharge, terminalView } from '@/lib/sales/terminal'

/**
 * The shop's Grow terminal against a fake Grow and the in-memory store:
 * pushing an amount records nothing; Grow's server update records exactly what
 * was charged, once, approves it, and reaches the sale's balance and the
 * customer's timeline.
 */
const actor = { email: 'seller@jas.test', name: 'Seller' }
const g = globalThis as unknown as { __ccOpsData?: ReturnType<typeof emptyData> }
const SECRET = 'w'.repeat(32)
const KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'WEBSITE_URL', 'GROW_API_URL', 'GROW_API_PATH', 'GROW_USER_ID', 'GROW_API_KEY', 'GROW_TERMINAL_PAGE_CODE', 'GROW_TERMINAL_DEVICES', 'GROW_WEBHOOK_SECRET']

let closers: (() => Promise<void>)[] = []
beforeEach(() => {
  resetSourceCache()
  g.__ccOpsData = emptyData()
  for (const k of KEYS) delete process.env[k]
  // Dev sign-in mode: audit rows go to memory, as everywhere else in these tests.
  Object.assign(process.env, { CC_DEV_PASSWORD: 'pw', CC_SESSION_SECRET: 'x'.repeat(40) })
})
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})

async function grow(opts: { refuse?: string; approveFails?: boolean } = {}) {
  const s = await fakeServer((r: Req) => {
    const f = Object.fromEntries(new URLSearchParams(r.body))
    if (r.path.endsWith('/createPaymentProcess')) {
      if (opts.refuse) return { status: 200, body: { status: 0, err: { message: opts.refuse } } }
      return { status: 200, body: { status: 1, data: { url: `https://grow.test/pos/${f.cField1}`, processId: `p-${f.cField1}`, processToken: 'pt' } } }
    }
    if (r.path.endsWith('/approveTransaction')) return { status: 200, body: opts.approveFails ? { status: 0, err: { message: 'nope' } } : { status: 1, data: {} } }
    return { status: 404, body: {} }
  })
  closers.push(s.close)
  Object.assign(process.env, {
    GROW_API_URL: s.url, GROW_API_PATH: '/api/light/server/1.0', GROW_USER_ID: 'u1', GROW_TERMINAL_PAGE_CODE: 'pos-page',
    GROW_TERMINAL_DEVICES: 'Counter:dk-counter,Phone:dk-phone', GROW_WEBHOOK_SECRET: SECRET,
  })
  return s
}

async function sale(priceMinor = 50000, contact = true) {
  const it = await getOpsStore().createItem({ title: 'כורסה', priceMinor, createdBy: actor.email }, { actorEmail: actor.email })
  const c = contact ? await getOpsStore().createContact({ fullName: 'Noa Cohen', phone: '0501234567', email: null, roles: ['customer'], source: 'in_store' }) : null
  const r = await createShopSale({ contactId: c?.id ?? null, note: null, lines: [{ itemId: it.id, quantity: 1, unitPriceMinor: priceMinor, fulfilment: 'pickup' }] }, `req-${it.id}`, actor)
  if (!r.ok) throw new Error(r.message)
  return { sale: r.sale, contactId: c?.id ?? null }
}

const form = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k === 'status' ? k : k === 'cField1' ? 'data[customFields][cField1]' : `data[${k}]`, v])).toString()
const update = (body: string, token: string | null = SECRET) => receiveServerUpdate(body, 'application/x-www-form-urlencoded', token)
const money = async (id: string) => { const d = (await getSalesStore().getSale(id))!; return { ...saleMoney(d.sale, d.lines, d.payments), payments: d.payments } }

describe('off until configured', () => {
  it('refuses to charge, names what is missing, and the webhook does not exist', async () => {
    const { sale: s } = await sale()
    expect(await startTerminalCharge(s.id, 50000, null, 'r-1', actor)).toMatchObject({ ok: false, message: expect.stringContaining('GROW_USER_ID') })
    expect(await terminalView(s.id)).toMatchObject({ on: false, missing: expect.arrayContaining(['GROW_TERMINAL_DEVICES']) })
    expect((await update('x=1')).status).toBe(404)
  })
})

describe('a charge on the terminal', () => {
  it('pushes the balance to the chosen device, records the payment once from the server update, and approves it', async () => {
    const grow_ = await grow()
    const { sale: s, contactId } = await sale()
    const r = await startTerminalCharge(s.id, 50000, 'Phone', 'r-1', actor)
    expect(r).toMatchObject({ ok: true })
    const sent = Object.fromEntries(new URLSearchParams(grow_.seen[0]!.body))
    expect(sent).toMatchObject({ pageCode: 'pos-page', userId: 'u1', deviceKey: 'dk-phone', sum: '500.00', 'pageField[fullName]': 'Noa Cohen', 'pageField[phone]': '0501234567' })
    expect(sent.notifyUrl).toContain(`/api/webhooks/grow?token=${SECRET}`)
    const [charge] = await getTerminalStore().forSale(s.id)
    expect(charge).toMatchObject({ status: 'sent', device: 'Phone', url: `https://grow.test/pos/${charge!.id}` })
    // Pushing moved no money.
    expect((await money(s.id)).paidMinor).toBe(0)

    // A second push while the first waits is refused; the same form replays.
    expect(await startTerminalCharge(s.id, 50000, null, 'r-2', actor)).toMatchObject({ ok: false, message: expect.stringContaining('already waiting') })
    expect(await startTerminalCharge(s.id, 50000, 'Phone', 'r-1', actor)).toMatchObject({ ok: true, message: expect.stringContaining('Already sent') })

    expect((await update('x=1', 'wrong'.padEnd(32, 'x'))).status).toBe(401)
    const body = form({ status: '1', processId: `p-${charge!.id}`, transactionId: 'T-9001', transactionToken: 'tt', asmachta: '123456', cardSuffix: '4242', paymentSum: '500', statusCode: '2', cField1: charge!.id })
    expect(await update(body)).toMatchObject({ status: 200, body: { paid: true, replay: false } })
    expect(await update(body)).toMatchObject({ status: 200, body: { paid: true, replay: true } })

    const m = await money(s.id)
    expect(m).toMatchObject({ paidMinor: 50000, balanceMinor: 0, state: 'paid' })
    expect(m.payments).toHaveLength(1)
    expect(m.payments[0]).toMatchObject({ method: 'card', requestId: 'grow:T-9001', note: expect.stringContaining('****4242') })
    expect((await getTerminalStore().get(charge!.id))).toMatchObject({ status: 'paid', transactionId: 'T-9001', paidMinor: 50000, approvedAt: expect.any(String), approveError: null })
    const approve = grow_.seen.filter((x) => x.path.endsWith('/approveTransaction'))
    expect(approve).toHaveLength(1)
    expect(Object.fromEntries(new URLSearchParams(approve[0]!.body))).toMatchObject({ userId: 'u1', pageCode: 'pos-page', transactionId: 'T-9001', transactionToken: 'tt' })
    const timeline = (await getOpsStore().listInteractions({ contactId: contactId! })).map((i) => i.summary)
    expect(timeline.filter((t) => t.includes('Paid ₪500 by card on the shop terminal (S-00001)'))).toHaveLength(1)
  })

  it('finds the charge by processId when the update carries no custom field, and ignores sales that are not ours', async () => {
    await grow()
    const { sale: s } = await sale(10000, false)
    await startTerminalCharge(s.id, 10000, null, 'r-1', actor)
    const [c] = await getTerminalStore().forSale(s.id)
    expect(await update(JSON.stringify({ transactionCode: 'W-1', paymentSum: '80', payerEmail: 'x@y.z' }))).toMatchObject({ status: 200, body: { ignored: expect.any(String) } })
    expect(await update(form({ processId: c!.processId!, transactionId: 'T-2', paymentSum: '100' }))).toMatchObject({ body: { paid: true } })
    expect((await money(s.id)).state).toBe('paid')
  })

  it('records what Grow says was charged, and a payment that arrives after a cancel or a failure', async () => {
    await grow()
    const { sale: s } = await sale(30000, false)
    await startTerminalCharge(s.id, 30000, null, 'r-1', actor)
    const [c] = await getTerminalStore().forSale(s.id)
    expect(await update(form({ cField1: c!.id, statusCode: '3', paymentSum: '300' }))).toMatchObject({ body: { paid: false } })
    expect((await getTerminalStore().get(c!.id))!.status).toBe('failed')
    expect(await cancelTerminalCharge(c!.id)).toMatchObject({ ok: false })

    await startTerminalCharge(s.id, 30000, null, 'r-2', actor)
    const c2 = (await getTerminalStore().forSale(s.id)).find((x) => x.requestId === 'r-2')!
    expect(await cancelTerminalCharge(c2.id)).toMatchObject({ ok: true })
    // The customer paid anyway, a different amount: the money is the truth.
    await update(form({ cField1: c2.id, transactionId: 'T-3', paymentSum: '250', asmachta: '9' }))
    expect(await getTerminalStore().get(c2.id)).toMatchObject({ status: 'paid', paidMinor: 25000 })
    expect(await money(s.id)).toMatchObject({ paidMinor: 25000, balanceMinor: 5000, state: 'deposit' })
    expect((await money(s.id)).payments[0]!.note).toContain('sent ₪300')
  })

  it('keeps a Grow refusal on the charge, refuses more than the balance, and shows a failed approve', async () => {
    await grow({ refuse: 'deviceKey לא תקין' })
    const { sale: s } = await sale(20000, false)
    expect(await startTerminalCharge(s.id, 20001, null, 'r-0', actor)).toMatchObject({ ok: false, message: expect.stringContaining('still to pay') })
    expect(await startTerminalCharge(s.id, 20000, null, 'r-1', actor)).toMatchObject({ ok: false, message: expect.stringContaining('deviceKey לא תקין') })
    expect((await getTerminalStore().forSale(s.id))[0]).toMatchObject({ status: 'failed', error: 'deviceKey לא תקין' })

    await grow({ approveFails: true })
    await startTerminalCharge(s.id, 20000, null, 'r-2', actor)
    const c = (await getTerminalStore().forSale(s.id)).find((x) => x.requestId === 'r-2')!
    await update(form({ cField1: c.id, transactionId: 'T-4', paymentSum: '200' }))
    expect(await getTerminalStore().get(c.id)).toMatchObject({ status: 'paid', approvedAt: null, approveError: 'nope' })
    expect((await money(s.id)).state).toBe('paid')
  })
})
