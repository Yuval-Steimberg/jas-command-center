'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePermission, userCan, type CurrentUser } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import type { Permission } from '@/lib/auth/rbac'
import { runAct, formStr, formShekels, errText, type ActionState, type ActResult } from '@/lib/ops/act'
import { getOpsStore, OpsSetupError } from '@/lib/ops'
import { CONDITIONS, LOCATION_KINDS, type Condition, type ItemPatch } from '@/lib/ops/types'
import {
  createManualItem, disposeItem, editItem, intakeFromFurniture, listOnWebsite, markDelivered, moveItem, releaseItem, reserveItem, returnItem, sellInStore, setListingPublished,
  type Actor, type OpResult,
} from '@/lib/inventory/service'
import { formatSku } from '@/lib/inventory/model'
import { upsertContact } from '@/lib/crm/service'

export type { ActionState } from '@/lib/ops/act'

const uuid = z.string().uuid()
const str = formStr
const shekels = formShekels
const actorOf = (u: CurrentUser): Actor => ({ email: u.email, name: u.name })

const act = (perms: Permission[], action: string, target: string, detail: Record<string, unknown>, run: (u: CurrentUser) => Promise<OpResult | ActResult>, paths: string[]) =>
  runAct('inventory', perms, action, target, detail, run, paths)

const condition = (f: FormData): Condition | null => {
  const c = String(f.get('condition') ?? '')
  return (CONDITIONS as readonly string[]).includes(c) ? (c as Condition) : null
}
const locationOf = (f: FormData) => {
  const l = String(f.get('locationId') ?? '')
  return uuid.safeParse(l).success ? l : null
}
const version = (f: FormData) => {
  const v = Number(f.get('version'))
  return Number.isInteger(v) && v > 0 ? v : null
}

export async function intakeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ids = f.getAll('fieldItemId').map(String).filter((x) => uuid.safeParse(x).success).slice(0, 100)
  if (!ids.length) return { ok: false, message: 'Tick at least one collected item.' }
  const price = shekels(f, 'price')
  if (Number.isNaN(price)) return { ok: false, message: 'The asking price must be an amount in ₪.' }
  return act(['inventory:operate'], 'inventory.intake', `furniture:${ids.length}`, { fieldItems: ids, locationId: locationOf(f) }, async (u) => {
    const r = await intakeFromFurniture(ids, { locationId: locationOf(f), condition: condition(f), priceMinor: price }, actorOf(u))
    return { ok: r.created.length > 0, message: r.message }
  }, ['/inventory', '/inventory/intake'])
}

export async function createItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const title = str(f, 'title', 200)
  if (!title) return { ok: false, message: 'Give the item a name.' }
  const price = shekels(f, 'price')
  if (Number.isNaN(price)) return { ok: false, message: 'The asking price must be an amount in ₪.' }
  const qty = Number(f.get('quantity') || 1)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) return { ok: false, message: 'Quantity must be a whole number from 1.' }
  const photo = str(f, 'photoUrl', 2000)
  if (photo && !/^https:\/\//.test(photo)) return { ok: false, message: 'The photo must be an https link.' }
  let createdId = ''
  const res = await act(['inventory:write'], 'inventory.create', 'item:new', { title }, async (u) => {
    const item = await createManualItem(
      { title, description: str(f, 'description'), category: str(f, 'category', 100), quantity: qty, kind: qty > 1 ? 'batch' : 'unique', condition: condition(f), locationId: locationOf(f), priceMinor: price, photoUrl: photo, dimensions: str(f, 'dimensions', 200), material: str(f, 'material', 200) },
      actorOf(u),
      str(f, 'note', 500) ?? undefined,
    )
    createdId = item.id
    return { ok: true, message: `Created ${item.sku}.` }
  }, ['/inventory'])
  if (res.ok && createdId) redirect(`/inventory/${createdId}`)
  return res
}

export async function editItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const title = str(f, 'title', 200)
  if (!title) return { ok: false, message: 'The item needs a name.' }
  const price = shekels(f, 'price')
  if (Number.isNaN(price)) return { ok: false, message: 'The asking price must be an amount in ₪.' }
  const photo = str(f, 'photoUrl', 2000)
  if (photo && !/^https:\/\//.test(photo)) return { ok: false, message: 'The photo must be an https link.' }
  const patch: ItemPatch = { title, description: str(f, 'description'), category: str(f, 'category', 100), condition: condition(f), priceMinor: price, photoUrl: photo, dimensions: str(f, 'dimensions', 200), material: str(f, 'material', 200) }
  const q = f.get('quantity')
  if (q != null && q !== '') {
    const n = Number(q)
    if (!Number.isInteger(n) || n < 0 || n > 10_000) return { ok: false, message: 'Quantity must be a whole number from 0.' }
    patch.quantity = n
    patch.kind = n > 1 ? 'batch' : 'unique'
  }
  return act(['inventory:write'], 'inventory.edit', `item:${id.data}`, { fields: Object.keys(patch) }, (u) => editItem(id.data, v, patch, actorOf(u)), [`/inventory/${id.data}`, '/inventory'])
}

export async function moveItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const loc = locationOf(f)
  return act(['inventory:operate'], 'inventory.move', `item:${id.data}`, { to: loc }, (u) => moveItem(id.data, v, loc, str(f, 'note', 500), actorOf(u)), [`/inventory/${id.data}`, '/inventory'])
}

export async function listItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const cat = Number(f.get('categoryId'))
  const categoryId = Number.isInteger(cat) && cat > 0 ? cat : null
  return act(['inventory:write', 'website:write'], 'inventory.list', `item:${id.data}`, { categoryId }, (u) => listOnWebsite(id.data, v, { categoryId }, actorOf(u)), [`/inventory/${id.data}`, '/inventory', '/website/products'])
}

export async function publishAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid item.' }
  const published = f.get('published') === 'true'
  return act(['inventory:write', 'website:write'], published ? 'inventory.publish' : 'inventory.unpublish', `item:${id.data}`, {}, (u) => setListingPublished(id.data, published, actorOf(u)), [`/inventory/${id.data}`, '/inventory', '/website/products'])
}

/** The customer picked in a form, or one created from its "new customer" fields (needs crm:write). */
async function contactFromForm(f: FormData, u: CurrentUser, role: 'customer' | 'partner'): Promise<{ id: string | null; error?: string }> {
  const picked = String(f.get('contactId') ?? '')
  if (uuid.safeParse(picked).success) return { id: picked }
  const name = str(f, 'newName', 200)
  const email = str(f, 'newEmail', 200)
  const phone = str(f, 'newPhone', 40)
  if (!name && !email && !phone) return { id: null }
  if (!(await userCan('crm:write'))) return { id: null, error: 'Your role cannot add customers; pick an existing one.' }
  const r = await upsertContact({ name, email, phone, role, source: 'in_store' })
  if (!r) return { id: null, error: 'A new customer needs a valid email or phone.' }
  await audit(u, { action: r.created ? 'crm.contact.create' : 'crm.contact.update', product: 'crm', target: `contact:${r.contact.id}`, outcome: 'succeeded', detail: { via: 'inventory', role } })
  return { id: r.contact.id }
}

/** Taking a LISTED item off sale changes website stock, so it also needs website:write. */
async function permsFor(id: string, base: Permission): Promise<Permission[]> {
  const item = await getOpsStore().getItem(id).catch(() => null)
  return item?.status === 'listed' ? [base, 'website:write'] : [base]
}

export async function reserveAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const days = Number(f.get('days') || 3)
  if (!Number.isInteger(days) || days < 1 || days > 30) return { ok: false, message: 'Reserve for 1 to 30 days.' }
  return act(await permsFor(id.data, 'inventory:operate'), 'inventory.reserve', `item:${id.data}`, { days }, async (u) => {
    const c = await contactFromForm(f, u, 'customer')
    if (c.error) return { ok: false, message: c.error }
    if (!c.id) return { ok: false, message: 'Pick or add the customer it is reserved for.' }
    return reserveItem(id.data, v, c.id, days, str(f, 'note', 500), actorOf(u))
  }, [`/inventory/${id.data}`, '/inventory', '/crm'])
}

export async function releaseAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid item.' }
  return act(['inventory:operate'], 'inventory.release', `item:${id.data}`, {}, (u) => releaseItem(id.data, str(f, 'note', 500) ?? 'Released by hand', actorOf(u)), [`/inventory/${id.data}`, '/inventory'])
}

export async function sellAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const price = shekels(f, 'price')
  if (!price || Number.isNaN(price)) return { ok: false, message: 'Enter the amount the customer paid, in ₪.' }
  return act(await permsFor(id.data, 'inventory:financial'), 'inventory.sell_in_store', `item:${id.data}`, { priceMinor: price }, async (u) => {
    const c = await contactFromForm(f, u, 'customer')
    if (c.error) return { ok: false, message: c.error }
    return sellInStore(id.data, v, { priceMinor: price, contactId: c.id, note: str(f, 'note', 500) }, actorOf(u))
  }, [`/inventory/${id.data}`, '/inventory', '/sales', '/crm'])
}

export async function deliveredAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid item.' }
  return act(['inventory:operate'], 'inventory.deliver', `item:${id.data}`, {}, (u) => markDelivered(id.data, str(f, 'note', 500), actorOf(u)), [`/inventory/${id.data}`, '/inventory', '/sales'])
}

export async function returnAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const reason = str(f, 'reason', 500)
  if (!reason || reason.length < 3) return { ok: false, message: 'Say why it came back.' }
  return act(['inventory:financial'], 'inventory.return', `item:${id.data}`, { reason }, (u) => returnItem(id.data, v, locationOf(f), reason, actorOf(u)), [`/inventory/${id.data}`, '/inventory', '/sales'])
}

const dispositionKind = z.enum(['donate', 'recycle', 'dispose'])
export async function disposeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  const kind = dispositionKind.safeParse(f.get('kind'))
  if (!id.success || !v || !kind.success) return { ok: false, message: 'Invalid request.' }
  const note = str(f, 'note', 500)
  if (!note || note.length < 3) return { ok: false, message: kind.data === 'donate' ? 'Name who received it.' : kind.data === 'recycle' ? 'Name where it went.' : 'Say why.' }
  return act(await permsFor(id.data, 'inventory:write'), `inventory.${kind.data}`, `item:${id.data}`, { note }, async (u) => {
    const c = kind.data === 'dispose' ? { id: null } : await contactFromForm(f, u, 'partner')
    if (c.error) return { ok: false, message: c.error }
    return disposeItem(id.data, v, kind.data, note, actorOf(u), c.id)
  }, [`/inventory/${id.data}`, '/inventory'])
}

export async function saveLocationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const name = str(f, 'name', 120)
  if (!name) return { ok: false, message: 'Name the location.' }
  const kind = String(f.get('kind') ?? 'warehouse')
  if (!(LOCATION_KINDS as readonly string[]).includes(kind)) return { ok: false, message: 'Pick a kind.' }
  const id = uuid.safeParse(f.get('id'))
  const parent = String(f.get('parentId') ?? '')
  return act(['inventory:write'], id.success ? 'inventory.location.update' : 'inventory.location.create', `location:${id.success ? id.data : 'new'}`, { name, kind }, async () => {
    const l = await getOpsStore().saveLocation(
      {
        name,
        kind: kind as (typeof LOCATION_KINDS)[number],
        parentId: uuid.safeParse(parent).success && parent !== (id.success ? id.data : '') ? parent : null,
        address: str(f, 'address', 300),
        notes: str(f, 'notes', 500),
        active: f.get('active') !== 'false',
      },
      id.success ? id.data : undefined,
    )
    return { ok: true, message: `Saved "${l.name}".` }
  }, ['/inventory/locations', '/inventory'])
}

/** Scanner / typed SKU → the item page. A scanned label carries the item's URL, a typed code its SKU. */
export async function findBySkuAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    await requirePermission('inventory:read')
  } catch {
    return { ok: false, message: 'Your role cannot read inventory.' }
  }
  const raw = String(f.get('code') ?? '').trim().slice(0, 300)
  let target = /\/inventory\/([0-9a-f-]{36})/i.exec(raw)?.[1] ?? null
  try {
    if (!target) target = (await getOpsStore().getItemBySku(formatSku(raw)))?.id ?? null
  } catch (e) {
    return { ok: false, message: e instanceof OpsSetupError ? e.message : errText(e) }
  }
  if (!target) return { ok: false, message: `No item with code ${formatSku(raw) || '(empty)'}.` }
  redirect(`/inventory/${target}`)
}
