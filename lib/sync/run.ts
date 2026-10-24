import 'server-only'
import { getOpsStore, ConflictError, OpsSetupError } from '@/lib/ops'
import type { Item } from '@/lib/ops/types'
import { listWebsiteInquiries, listWebsiteOrdersSince, listWebsiteProducts, listWebsiteProductsByIds, type WebsiteInquiry, type WebsiteProduct } from '@/lib/integrations/website/manage'
import { upsertContact, touchContact } from '@/lib/crm/service'
import { adoptWebsiteProduct, releaseItem } from '@/lib/inventory/service'
import { reservationExpired } from '@/lib/inventory/model'
import { ruleEnabled, runRule } from '@/lib/tasks/automations'
import { planOrderSync } from './plan'
import { driftTask, planProductAdoption, planStockDrift } from './products'

/**
 * The event bridge between the sources and the command center's own records.
 * None of the sources pushes events, so this runs from the hourly sweep and
 * from "Sync now" on /sales. Each step is isolated (one failing source never
 * blocks the others), idempotent (refs and dedupe keys), and remembers its
 * cursor and last error in cc_sync_state, which /sales shows.
 */
export const SYSTEM_ACTOR = 'system:sync'
const ORDERS_KEY = 'ops:website_orders'
const FORMS_KEY = 'ops:website_forms'
const RESERVE_KEY = 'ops:reservations'
const PRODUCTS_KEY = 'ops:website_products'

export interface StepReport {
  step: 'website_orders' | 'website_forms' | 'reservations' | 'website_products'
  state: 'ok' | 'error' | 'skipped'
  message: string
  counts: Record<string, number>
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function syncOrders(): Promise<StepReport> {
  const store = getOpsStore()
  const counts = { orders: 0, sold: 0, delivered: 0, conflicts: 0, customers: 0 }
  const cur = await store.getCursor(ORDERS_KEY)
  // First run: the last 30 days. Later: from the newest change seen (inclusive; replays are no-ops).
  const since = cur.cursor ?? new Date(Date.now() - 30 * 86_400_000).toISOString()
  const r = await listWebsiteOrdersSince(since)
  if (r.state === 'not_configured') return { step: 'website_orders', state: 'skipped', message: `Website orders are not connected (${r.missing.join(', ')}).`, counts }
  if (r.state === 'error') {
    await store.setCursor(ORDERS_KEY, { ok: false, error: r.error })
    return { step: 'website_orders', state: 'error', message: r.error, counts }
  }
  counts.orders = r.data.length
  const productIds = [...new Set(r.data.flatMap((o) => (o.items ?? []).map((l) => l.product_id).filter((x): x is number => x != null && x > 0)))]
  const linked = new Map<number, Item>()
  if (productIds.length) for (const i of await store.listItems({ websiteProductIds: productIds })) if (i.websiteProductId != null) linked.set(i.websiteProductId, i)
  const { steps, cursor } = planOrderSync(r.data, linked)
  const customersOn = await ruleEnabled('website_order_customer')
  const buyer = new Map<number, string>()

  for (const s of steps) {
    try {
      if (s.kind === 'customer') {
        if (!customersOn) continue
        const c = await upsertContact({ name: s.name, email: s.email, phone: s.phone, role: 'customer', source: 'website_order' })
        if (!c) continue
        buyer.set(s.orderId, c.contact.id)
        if (c.created) counts.customers++
        await touchContact(c.contact.id, { channel: 'website_order', direction: 'in', summary: `Website order ${s.orderNumber} (₪${(s.totalMinor / 100).toFixed(2)})`, refKind: 'website_order', refId: String(s.orderId), at: s.at }, SYSTEM_ACTOR, 'customer')
      } else if (s.kind === 'sell') {
        const done = s.remaining === 0
        const item = await store.applyItem(
          s.itemId,
          { from: ['listed', 'reserved'] },
          done
            ? { status: 'sold', quantity: 0, soldChannel: 'website', soldAt: s.at, soldPriceMinor: s.lineTotalMinor, buyerContactId: buyer.get(s.orderId) ?? null, websiteOrderId: s.orderId, websiteOrderNumber: s.orderNumber, reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null }
            : { quantity: s.remaining },
          // Units of a lot sold online are a sale too (as in the shop), so analytics counts them; the lot itself stays listed.
          { type: 'sell', refKind: 'website_order', refId: String(s.orderId), actorEmail: SYSTEM_ACTOR, quantityDelta: -s.units, detail: { channel: 'website', orderNumber: s.orderNumber, lineTotalMinor: s.lineTotalMinor, units: s.units } },
        )
        counts.sold++
        if (done) await runRule('sale_needs_delivery', { item, orderNumber: s.orderNumber }, SYSTEM_ACTOR)
      } else if (s.kind === 'deliver') {
        await store.applyItem(s.itemId, { from: ['sold'] }, { status: 'delivered' }, { type: 'deliver', refKind: 'website_order', refId: String(s.orderId), actorEmail: SYSTEM_ACTOR, note: `Website order ${s.orderNumber} marked delivered` })
        counts.delivered++
      } else if (s.kind === 'conflict') {
        await store.applyItem(s.itemId, {}, {}, { type: 'conflict', refKind: 'website_order', refId: String(s.orderId), actorEmail: SYSTEM_ACTOR, note: s.reason })
        const t = await store.createTask({ title: `Check ${s.orderNumber}: possible double sale`, detail: s.reason, dueAt: new Date().toISOString(), entityKind: 'item', entityId: s.itemId, source: 'automation:double_sale', dedupeKey: `double_sale:${s.itemId}:${s.orderId}`, createdBy: SYSTEM_ACTOR })
        if (t.created) counts.conflicts++
      }
    } catch (e) {
      // A refused step (the item changed meanwhile) is recorded as a conflict task, never silently dropped.
      if (e instanceof ConflictError && s.kind !== 'customer') {
        await store.createTask({ title: `Check order ${s.orderNumber} against inventory`, detail: `${s.kind} was refused: ${e.message}`, dueAt: new Date().toISOString(), entityKind: 'item', entityId: s.itemId, source: 'automation:double_sale', dedupeKey: `sync_refused:${s.kind}:${s.itemId}:${s.orderId}`, createdBy: SYSTEM_ACTOR })
        counts.conflicts++
        continue
      }
      throw e
    }
  }
  await store.setCursor(ORDERS_KEY, { cursor: cursor ?? since, ok: true })
  return { step: 'website_orders', state: 'ok', message: `${counts.orders} order(s) read; ${counts.sold} inventory sale(s), ${counts.delivered} delivered, ${counts.customers} new customer(s), ${counts.conflicts} to check.`, counts }
}

const FORM_ROLE = { contact: 'lead', volunteer: 'volunteer', donate: 'donor' } as const
const FORM_TITLE = { contact: 'Contact form', volunteer: 'Volunteer form', donate: 'Donation offer' } as const

async function syncForms(): Promise<StepReport> {
  const counts = { messages: 0, leads: 0 }
  if (!(await ruleEnabled('website_form_lead'))) return { step: 'website_forms', state: 'skipped', message: 'The "website form → lead" automation is switched off.', counts }
  const store = getOpsStore()
  const r = await listWebsiteInquiries('all')
  if (r.state === 'not_configured') return { step: 'website_forms', state: 'skipped', message: `Website forms are not connected (${r.missing.join(', ')}).`, counts }
  if (r.state === 'error') {
    await store.setCursor(FORMS_KEY, { ok: false, error: r.error })
    return { step: 'website_forms', state: 'error', message: r.error, counts }
  }
  const cur = await store.getCursor(FORMS_KEY)
  const fresh = r.data.inquiries.filter((m: WebsiteInquiry) => !cur.cursor || m.created_at >= cur.cursor)
  counts.messages = fresh.length
  let newest = cur.cursor
  for (const m of fresh.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!newest || m.created_at > newest) newest = m.created_at
    const c = await upsertContact({ name: m.name, email: m.email, phone: m.phone, role: FORM_ROLE[m.kind], source: 'website_form' })
    if (!c) continue
    const handled = Boolean(m.handled_at)
    const deal = await store.createDeal({
      contactId: c.contact.id,
      title: `${FORM_TITLE[m.kind]}${m.subject ? `: ${m.subject.slice(0, 80)}` : ''}`,
      stage: handled ? 'contacted' : 'new',
      source: 'website_form',
      sourceRef: `website_inquiry:${m.id}`,
      lastContactedAt: m.handled_at,
      nextStep: handled ? null : 'Reply',
    })
    await touchContact(c.contact.id, { channel: 'website_form', direction: 'in', summary: `${FORM_TITLE[m.kind]}: ${m.message.slice(0, 300)}`, refKind: 'website_inquiry', refId: String(m.id), at: m.created_at }, SYSTEM_ACTOR)
    if (deal.created) {
      counts.leads++
      if (!handled)
        await store.createTask({ title: `Reply to ${c.contact.fullName} (${FORM_TITLE[m.kind].toLowerCase()})`, detail: m.message.slice(0, 500), dueAt: new Date(Date.parse(m.created_at) + 86_400_000).toISOString(), entityKind: 'deal', entityId: deal.deal.id, source: 'automation:website_form_lead', dedupeKey: `website_form_lead:${m.id}`, createdBy: SYSTEM_ACTOR })
    }
  }
  await store.setCursor(FORMS_KEY, { cursor: newest, ok: true })
  return { step: 'website_forms', state: 'ok', message: `${counts.messages} form message(s) read; ${counts.leads} new lead(s).`, counts }
}

async function expireReservations(): Promise<StepReport> {
  const counts = { released: 0, failed: 0 }
  if (!(await ruleEnabled('reservation_expiry'))) return { step: 'reservations', state: 'skipped', message: 'The reservation-expiry automation is switched off.', counts }
  const store = getOpsStore()
  const due = (await store.listItems({ statuses: ['reserved'] })).filter((i) => reservationExpired(i))
  const problems: string[] = []
  for (const i of due) {
    const r = await releaseItem(i.id, `Reservation ended ${i.reservedUntil?.slice(0, 10)}`, { email: SYSTEM_ACTOR, name: 'Automation' })
    if (r.ok) {
      counts.released++
      if (r.warning) problems.push(`${i.sku}: ${r.warning}`)
    } else {
      counts.failed++
      problems.push(`${i.sku}: ${r.message}`)
    }
  }
  await store.setCursor(RESERVE_KEY, problems.length ? { ok: false, error: problems.join(' · ') } : { ok: true })
  return { step: 'reservations', state: problems.length ? 'error' : 'ok', message: `${counts.released} expired reservation(s) released.${problems.length ? ` ${problems.join(' · ')}` : ''}`, counts }
}

/**
 * Website products → inventory (lib/sync/products.ts): adopt products created
 * on the website since the last run, then report listed items whose website
 * stock changed without an order. Runs after the order step on purpose.
 */
async function syncProducts(): Promise<StepReport> {
  const counts = { products: 0, adopted: 0, drift: 0 }
  if (!(await ruleEnabled('website_product_inventory'))) return { step: 'website_products', state: 'skipped', message: 'The "website product → inventory" automation is switched off.', counts }
  const store = getOpsStore()
  const r = await listWebsiteProducts('')
  if (r.state === 'not_configured') return { step: 'website_products', state: 'skipped', message: `Website products are not connected (${r.missing.join(', ')}).`, counts }
  if (r.state === 'error') {
    await store.setCursor(PRODUCTS_KEY, { ok: false, error: r.error })
    return { step: 'website_products', state: 'error', message: r.error, counts }
  }
  counts.products = r.data.length
  const cur = await store.getCursor(PRODUCTS_KEY)
  const cursor = cur.cursor != null && /^\d+$/.test(cur.cursor) ? Number(cur.cursor) : null
  const ids = r.data.map((p) => p.id)
  const linked = new Set(ids.length ? (await store.listItems({ websiteProductIds: ids, limit: 1000 })).map((i) => i.websiteProductId!) : [])
  const plan = planProductAdoption(r.data, linked, cursor)
  const problems: string[] = []
  for (const p of plan.adopt) {
    try {
      await adoptWebsiteProduct(p, { locationId: null }, { email: SYSTEM_ACTOR, name: 'Sync' })
      counts.adopted++
    } catch (e) {
      if (!(e instanceof ConflictError)) problems.push(`#${p.id}: ${err(e)}`)
    }
  }

  const listed = (await store.listItems({ statuses: ['listed'], limit: 5000 })).filter((i) => i.websiteProductId != null)
  const byId = new Map<number, WebsiteProduct>()
  const want = listed.map((i) => i.websiteProductId!)
  let read = true
  for (let k = 0; k < want.length; k += 200) {
    const page = await listWebsiteProductsByIds(want.slice(k, k + 200))
    if (page.state !== 'ok') { read = false; problems.push(`stock check: ${page.state === 'error' ? page.error : 'not connected'}`); break }
    for (const p of page.data) byId.set(p.id, p)
  }
  if (read) {
    for (const d of planStockDrift(listed, byId)) {
      const t = driftTask(d)
      const made = await store.createTask({ ...t, dueAt: new Date().toISOString(), entityKind: 'item', entityId: d.item.id, source: 'automation:website_stock', createdBy: SYSTEM_ACTOR })
      if (made.created) counts.drift++
    }
  }
  // A failed adoption keeps the old cursor, so that product is tried again next run (adopted ones are linked by then).
  const adoptFailed = problems.some((x) => x.startsWith('#'))
  await store.setCursor(PRODUCTS_KEY, { cursor: adoptFailed ? cur.cursor : String(plan.cursor), ok: !problems.length, error: problems.join(' · ') || null })
  return { step: 'website_products', state: problems.length ? 'error' : 'ok', message: `${counts.products} website product(s) read; ${counts.adopted} new one(s) taken into inventory, ${counts.drift} stock change(s) to check.${problems.length ? ` ${problems.join(' · ')}` : ''}`, counts }
}

export async function runOpsSync(): Promise<{ state: 'ok' | 'not_set_up'; steps: StepReport[]; message?: string }> {
  try {
    await getOpsStore().getCursor(ORDERS_KEY)
    await getOpsStore().listItems({ limit: 1 })
  } catch (e) {
    if (e instanceof OpsSetupError) return { state: 'not_set_up', steps: [], message: e.message }
    throw e
  }
  const steps: StepReport[] = []
  for (const [step, run] of [['website_orders', syncOrders], ['website_forms', syncForms], ['reservations', expireReservations], ['website_products', syncProducts]] as const) {
    try {
      steps.push(await run())
    } catch (e) {
      steps.push({ step, state: 'error', message: err(e), counts: {} })
    }
  }
  return { state: 'ok', steps }
}

export async function syncStatus() {
  const store = getOpsStore()
  const [orders, forms, reservations, products] = await Promise.all([store.getCursor(ORDERS_KEY), store.getCursor(FORMS_KEY), store.getCursor(RESERVE_KEY), store.getCursor(PRODUCTS_KEY)])
  return { orders, forms, reservations, products }
}
