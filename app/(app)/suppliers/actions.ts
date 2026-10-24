'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getOpsStore, ConflictError } from '@/lib/ops'
import { runAct, formStr as str, formShekels, type ActionState } from '@/lib/ops/act'
import { normalizeEmail, normalizePhone, withRole } from '@/lib/crm/model'
import { getSupplierStore } from '@/lib/suppliers/store'
import { CONDITIONS } from '@/lib/ops/types'
import { PO_STATUSES, lineProblem, nextStatuses, remaining, type PoLineInput, type PoStatus } from '@/lib/suppliers/model'

const uuid = z.string().uuid()
const PATHS = ['/suppliers', '/inventory']

/**
 * Add a supplier. A contact with the same phone or email becomes a supplier
 * (the role is added); nothing they typed elsewhere is overwritten.
 */
export async function saveSupplierAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const fullName = str(f, 'fullName', 200)
  if (!fullName) return { ok: false, message: 'Give the supplier a name.' }
  const rawEmail = str(f, 'email', 200)
  const rawPhone = str(f, 'phone', 40)
  const email = normalizeEmail(rawEmail)
  const phone = normalizePhone(rawPhone)
  if (rawEmail && !email) return { ok: false, message: 'That email address is not valid.' }
  if (rawPhone && !phone) return { ok: false, message: 'That phone number is not valid (e.g. 050-123-4567).' }
  let goTo = ''
  const res = await runAct('crm', ['crm:write'], 'supplier.create', 'contact:new', {}, async () => {
    const store = getOpsStore()
    const existing = await store.findContact(email, phone)
    if (existing) {
      if (!existing.roles.includes('supplier')) await store.updateContact(existing.id, { roles: withRole(existing.roles, 'supplier') })
      goTo = existing.id
      return { ok: true, message: `${existing.fullName} was already a contact and is now a supplier.` }
    }
    const notes = [str(f, 'contactPerson', 200) ? `Contact person: ${str(f, 'contactPerson', 200)}` : null, str(f, 'notes', 2000)].filter(Boolean).join('\n') || null
    const c = await store.createContact({ fullName, kind: f.get('kind') === 'person' ? 'person' : 'company', email, phone, roles: ['supplier'], source: 'manual', notes })
    goTo = c.id
    return { ok: true, message: `Added ${c.fullName}.` }
  }, PATHS)
  if (res.ok && goTo) redirect(`/suppliers/${goTo}`)
  return res
}

/** Order lines arrive as parallel arrays: desc[], qty[], cost[], category[]. Empty rows are skipped. */
function linesOf(f: FormData): { lines: PoLineInput[]; problem: string | null } {
  const desc = f.getAll('desc').map((v) => String(v).trim())
  const qty = f.getAll('qty').map((v) => String(v).trim())
  const cat = f.getAll('category').map((v) => String(v).trim())
  const costs = f.getAll('cost').map((v) => String(v))
  const lines: PoLineInput[] = []
  for (let i = 0; i < desc.length; i++) {
    if (!desc[i] && !qty[i]) continue
    const fd = new FormData()
    fd.set('c', costs[i] ?? '')
    const cost = formShekels(fd, 'c')
    if (Number.isNaN(cost)) return { lines, problem: `Line ${i + 1}: the unit cost is not a valid amount.` }
    const l: PoLineInput = { description: (desc[i] ?? '').slice(0, 300), quantity: Number(qty[i] || 1), category: cat[i]?.slice(0, 100) || null, unitCostMinor: cost }
    const p = lineProblem(l)
    if (p) return { lines, problem: p }
    lines.push(l)
  }
  return { lines, problem: lines.length ? null : 'Add at least one line.' }
}

const dateOf = (f: FormData) => {
  const raw = String(f.get('expectedAt') ?? '').trim()
  if (!raw) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : 'invalid'
}

/** Create an order (draft), or replace its lines while nothing has arrived. */
export async function saveOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const version = Number(f.get('version'))
  const supplier = uuid.safeParse(f.get('supplierId'))
  if (!supplier.success) return { ok: false, message: 'Pick a supplier.' }
  const expectedAt = dateOf(f)
  if (expectedAt === 'invalid') return { ok: false, message: 'Pick a valid date.' }
  const { lines, problem } = linesOf(f)
  if (problem) return { ok: false, message: problem }
  let goTo = ''
  const res = await runAct('inventory', ['inventory:write'], id.success ? 'purchase_order.update' : 'purchase_order.create', `purchase_order:${id.success ? id.data : 'new'}`, { supplierId: supplier.data, lines: lines.length }, async (u) => {
    const sup = await getOpsStore().getContact(supplier.data)
    if (!sup) return { ok: false, message: 'That supplier no longer exists.' }
    try {
      const po = await getSupplierStore().saveOrder({ supplierId: sup.id, expectedAt, note: str(f, 'note', 1000), lines }, u.email, id.success ? id.data : undefined, id.success ? version : undefined)
      if (!sup.roles.includes('supplier')) await getOpsStore().updateContact(sup.id, { roles: withRole(sup.roles, 'supplier') })
      goTo = po.id
      return { ok: true, message: id.success ? `Saved ${po.number}.` : `Created ${po.number}.` }
    } catch (e) {
      if (e instanceof ConflictError) return { ok: false, message: `Not saved: ${e.message}. Reload the page.` }
      throw e
    }
  }, PATHS)
  if (res.ok && goTo) redirect(`/suppliers/orders/${goTo}`)
  return res
}

const MOVE_ACTION: Partial<Record<PoStatus, string>> = { ordered: 'purchase_order.ordered', cancelled: 'purchase_order.cancel', received: 'purchase_order.close' }

/** Mark ordered (sent to the supplier), cancel, or close a partly received order ("the rest is not coming"). */
export async function setOrderStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const to = String(f.get('to') ?? '') as PoStatus
  const version = Number(f.get('version'))
  if (!id.success || !PO_STATUSES.includes(to) || !Number.isInteger(version)) return { ok: false, message: 'Invalid request.' }
  return runAct('inventory', ['inventory:write'], MOVE_ACTION[to] ?? `purchase_order.${to}`, `purchase_order:${id.data}`, { to }, async () => {
    const store = getSupplierStore()
    const po = await store.getOrder(id.data)
    if (!po) return { ok: false, message: 'That order no longer exists.' }
    if (po.version !== version) return { ok: false, message: 'The order changed since you loaded it. Reload the page.' }
    if (!nextStatuses(po).includes(to)) return { ok: false, message: `A ${po.status} order cannot become ${to}.` }
    const done = await store.setStatus(po.id, po.status, po.version, to)
    if (!done) return { ok: false, message: 'The order changed since you loaded it. Reload the page.' }
    return { ok: true, message: to === 'ordered' ? `${po.number} marked as ordered.` : to === 'cancelled' ? `${po.number} cancelled.` : `${po.number} closed; what did not arrive is no longer expected.` }
  }, [...PATHS, `/suppliers/orders/${id.data}`, ...supplierPath(f)])
}

/**
 * Receive goods. Each line with a quantity becomes one inventory item (a batch
 * when more than one unit), in the chosen location. The form carries a
 * request id made when the page loaded, so a double click receives once.
 */
export async function receiveOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const requestId = z.string().min(8).max(80).safeParse(f.get('requestId'))
  if (!id.success || !requestId.success) return { ok: false, message: 'Invalid request. Reload the page.' }
  const defaultLoc = uuid.safeParse(f.get('locationId'))
  const cond = String(f.get('condition') ?? '')
  const condition = (CONDITIONS as readonly string[]).includes(cond) ? cond : null
  return runAct('inventory', ['inventory:operate'], 'purchase_order.receive', `purchase_order:${id.data}`, { requestId: requestId.data }, async (u) => {
    const store = getSupplierStore()
    const po = await store.getOrder(id.data)
    if (!po) return { ok: false, message: 'That order no longer exists.' }
    const lines = []
    for (const l of po.lines) {
      const raw = String(f.get(`qty_${l.id}`) ?? '').trim()
      if (!raw || raw === '0') continue
      const q = Number(raw)
      if (!Number.isInteger(q) || q < 0) return { ok: false, message: `"${l.description}": enter a whole number.` }
      if (q > remaining(l)) return { ok: false, message: `"${l.description}": only ${remaining(l)} still to come.` }
      const loc = uuid.safeParse(f.get(`loc_${l.id}`))
      lines.push({ lineId: l.id, quantity: q, locationId: loc.success ? loc.data : defaultLoc.success ? defaultLoc.data : null, condition })
    }
    if (!lines.length) return { ok: false, message: 'Enter how many arrived on at least one line.' }
    try {
      const { receipts, replay } = await store.receive(po.id, lines, requestId.data, u.email)
      const units = receipts.reduce((s, r) => s + r.quantity, 0)
      const items = await getOpsStore().listItems({ ids: receipts.map((r) => r.itemId) })
      const skus = items.map((i) => i.sku).sort()
      return { ok: true, message: `${replay ? 'Already received' : 'Received'} ${units} unit(s) into inventory as ${skus.join(', ')}.` }
    } catch (e) {
      if (e instanceof ConflictError) return { ok: false, message: `Not received: ${e.message}. Reload the page.` }
      throw e
    }
  }, [...PATHS, `/suppliers/orders/${id.data}`, ...supplierPath(f)])
}

const supplierPath = (f: FormData) => (uuid.safeParse(f.get('supplierId')).success ? [`/suppliers/${f.get('supplierId')}`] : [])
