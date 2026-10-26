'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePermission, userCan, type CurrentUser } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import type { Permission } from '@/lib/auth/rbac'
import { runAct, formStr, formShekels, errText, type ActionState, type ActResult } from '@/lib/ops/act'
import { getOpsStore, OpsSetupError } from '@/lib/ops'
import { CONDITIONS, LOCATION_KINDS, REFURB_LEVELS, REFURB_STATUSES, type Condition, type ItemPatch, type RefurbLevel, type RefurbStatus } from '@/lib/ops/types'
import { isPhotoHash } from '@/lib/inventory/photo-hash'
import { formatDimensions } from '@/lib/inventory/dimensions'
import { CONDITION_OF_RENEWAL, parseRenewalLevel } from '@/lib/inventory/renewal'
import { PLACE_NEW, isPlace, matchNamed, matchPlace } from '@/lib/inventory/places'
import { ITEM_CATEGORIES } from '@/lib/inventory/categories'
import { openSaleOf } from '@/lib/sales/service'
import {
  adoptWebsiteProducts, copyDrivePhotosMany, createManualItem, hideWebsiteProducts, listManyOnWebsite, disposeItem, editItem, intakeFromFurniture, listOnWebsite, markDelivered, moveItem, releaseItem, reserveItem, returnItem, sellInStore, setListingPublished, setShownOnWebsite,
  type Actor, type OpResult,
} from '@/lib/inventory/service'
import { formatSku, skuCandidates } from '@/lib/inventory/model'
import { upsertContact } from '@/lib/crm/service'

export type { ActionState } from '@/lib/ops/act'

const uuid = z.string().uuid()
/** One confirm = one serverless call; each item is its own atomic write. */
const MAX_PER_CONFIRM = 100
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
  const ids = [...new Set(f.getAll('fieldItemId').map(String).filter((x) => uuid.safeParse(x).success))]
  if (!ids.length) return { ok: false, message: 'Tick at least one collected item.' }
  if (ids.length > MAX_PER_CONFIRM) return { ok: false, message: `${ids.length} ticked: take in at most ${MAX_PER_CONFIRM} per confirm. Nothing was taken in.` }
  const price = shekels(f, 'price')
  if (Number.isNaN(price)) return { ok: false, message: 'The asking price must be an amount in ₪.' }
  return act(['inventory:operate'], 'inventory.intake', `furniture:${ids.length}`, { fieldItems: ids, locationId: locationOf(f) }, async (u) => {
    const r = await intakeFromFurniture(ids, { locationId: locationOf(f), condition: condition(f), priceMinor: price }, actorOf(u))
    return { ok: r.created.length > 0, message: r.message }
  }, ['/inventory', '/inventory/intake'])
}

export async function adoptWebsiteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ids = [...new Set(f.getAll('productId').map(Number).filter((x) => Number.isInteger(x) && x > 0))]
  if (!ids.length) return { ok: false, message: 'Tick at least one product.' }
  if (ids.length > MAX_PER_CONFIRM) return { ok: false, message: `${ids.length} ticked: bring in at most ${MAX_PER_CONFIRM} per confirm. Nothing was taken in.` }
  return act(['inventory:operate'], 'inventory.adopt_website', `website_products:${ids.length}`, { productIds: ids, locationId: locationOf(f) }, async (u) => {
    const r = await adoptWebsiteProducts(ids, { locationId: locationOf(f) }, actorOf(u))
    return { ok: r.created.length > 0, message: r.message }
  }, ['/inventory', '/inventory/website'])
}

/** Website writes take several calls each; a batch this size finishes well inside one serverless call. More ticked = the rest on the next press. */
const MAX_PER_WEBSITE_BATCH = 30

export async function listManyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ids = [...new Set(f.getAll('itemId').map(String).filter((x) => uuid.safeParse(x).success))]
  if (!ids.length) return { ok: false, message: 'Tick at least one item.' }
  const batch = ids.slice(0, MAX_PER_WEBSITE_BATCH)
  const left = ids.length - batch.length
  return act(['inventory:write', 'website:write'], 'inventory.list_many', `items:${batch.length}`, { items: batch }, async (u) => {
    const r = await listManyOnWebsite(batch, actorOf(u))
    return { ok: r.listed.length > 0, message: left ? `${r.message} ${left} more ticked: tick them again and press once more.` : r.message }
  }, ['/inventory', '/inventory/online', '/website/products', '/shop'])
}

export async function copyDrivePhotosAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ids = [...new Set(f.getAll('itemId').map(String).filter((x) => uuid.safeParse(x).success))]
  if (!ids.length) return { ok: false, message: 'No item has a Drive photo.' }
  const batch = ids.slice(0, MAX_PER_WEBSITE_BATCH)
  const left = ids.length - batch.length
  return act(['inventory:write'], 'inventory.copy_drive_photos', `items:${batch.length}`, { items: batch }, async (u) => {
    const r = await copyDrivePhotosMany(batch, actorOf(u))
    return { ok: r.done > 0, message: left ? `${r.message} ${left} more to go: press again.` : r.message }
  }, ['/inventory', '/inventory/online', '/shop'])
}

export async function hideWebsiteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ids = [...new Set(f.getAll('productId').map(Number).filter((x) => Number.isInteger(x) && x > 0))]
  if (!ids.length) return { ok: false, message: 'Tick at least one product.' }
  const batch = ids.slice(0, MAX_PER_WEBSITE_BATCH)
  const left = ids.length - batch.length
  return act(['website:write'], 'website.products.hide', `website_products:${batch.length}`, { productIds: batch }, async (u) => {
    const r = await hideWebsiteProducts(batch, actorOf(u))
    return { ok: r.hidden > 0, message: left ? `${r.message} ${left} more ticked: tick them again and press once more.` : r.message }
  }, ['/inventory', '/inventory/online', '/website/products'])
}

/** The form's four measurements (+ an older free-text note) as the one text column; a plain `dimensions` field still works. */
function dimensionsOf(f: FormData): string | null {
  if (!f.has('dimLength')) return str(f, 'dimensions', 200)
  const g = (k: string) => String(f.get(k) ?? '')
  return formatDimensions({ length: g('dimLength'), width: g('dimWidth'), height: g('dimHeight'), diameter: g('dimDiameter'), note: g('dimNote') }) || null
}

/** Fields both the add and edit forms carry (photos, colours, renewal level, AI price), validated once. */
async function itemFields(f: FormData): Promise<{ ok: true; patch: ItemPatch } | { ok: false; message: string }> {
  const price = shekels(f, 'price')
  if (Number.isNaN(price)) return { ok: false, message: 'The asking price must be an amount in ₪.' }
  const photo = str(f, 'photoUrl', 2000)
  if (photo && !/^https:\/\//.test(photo)) return { ok: false, message: 'The photo must be an https link.' }
  const before = str(f, 'beforePhotoUrl', 2000)
  if (before && !/^https:\/\//.test(before)) return { ok: false, message: 'The "before" photo must be an https link.' }
  const category = str(f, 'category', 100)
  // The list, or the category an older item already had (shown as an extra option until someone picks from the list).
  if (category && !(ITEM_CATEGORIES as readonly string[]).includes(category) && category !== String(f.get('categoryWas') ?? '')) return { ok: false, message: 'Pick a category from the list.' }
  const extra = f.getAll('extraPhoto').map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  if (extra.some((x) => !/^https:\/\//.test(x) || x.length > 2000)) return { ok: false, message: 'Every extra photo must be an https link.' }
  const patch: ItemPatch = {
    title: str(f, 'title', 200) ?? undefined, description: str(f, 'description'), category, priceMinor: price, photoUrl: photo,
    dimensions: dimensionsOf(f), material: str(f, 'material', 200), colors: str(f, 'colors', 200),
  }
  if (f.has('condition')) patch.condition = condition(f)
  // The renewal level replaced condition on the form; condition follows it (the website reads condition).
  // A blank level leaves both as they were.
  if (f.has('renewalLevel')) {
    const level = parseRenewalLevel(f.get('renewalLevel'))
    if (level != null) {
      patch.renewalLevel = level
      patch.condition = CONDITION_OF_RENEWAL[level]
    }
  }
  if (f.has('extraPhotosSent')) patch.extraPhotos = extra
  if (f.has('beforePhotoUrl')) patch.beforePhotoUrl = before
  if (f.has('origin')) patch.origin = str(f, 'origin', 500)
  if (f.has('notes')) patch.notes = str(f, 'notes', 2000)
  const hash = String(f.get('photoHash') ?? '')
  if (f.has('photoHash')) patch.photoHash = isPhotoHash(hash) ? hash : null
  if (f.has('priceApproved')) patch.priceApproved = f.get('priceApproved') !== 'false'
  const ai = shekels(f, 'aiPrice')
  if (f.has('aiPrice') && !Number.isNaN(ai)) patch.aiPriceMinor = ai
  // Purchase cost is a money figure: only roles that see money set it.
  if (f.has('cost') && (await userCan('inventory:financial'))) {
    const cost = shekels(f, 'cost')
    if (Number.isNaN(cost)) return { ok: false, message: 'The purchase cost must be an amount in ₪.' }
    patch.unitCostMinor = cost
  }
  return { ok: true, patch }
}

/** The add form's place buttons → a location id: the matching location, made on first use. "אחר" names one. */
async function placeLocation(f: FormData): Promise<string | null> {
  const place = String(f.get('place') ?? '')
  if (!isPlace(place)) return null
  const store = getOpsStore()
  const locations = await store.listLocations()
  if (place === 'other') {
    const name = str(f, 'placeOther', 100)
    if (!name) return null
    return (matchNamed(name, locations) ?? (await store.saveLocation({ name, kind: 'zone' }))).id
  }
  const found = matchPlace(place, locations)
  return found ? found.id : (await store.saveLocation(PLACE_NEW[place])).id
}

export async function createItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const title = str(f, 'title', 200)
  if (!title) return { ok: false, message: 'Give the item a name.' }
  const qty = Number(f.get('quantity') || 1)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) return { ok: false, message: 'Quantity must be a whole number from 1.' }
  const fields = await itemFields(f)
  if (!fields.ok) return fields
  let createdId = ''
  const res = await act(['inventory:write'], 'inventory.create', 'item:new', { title }, async (u) => {
    const item = await createManualItem(
      { ...fields.patch, title, quantity: qty, kind: qty > 1 ? 'batch' : 'unique', locationId: locationOf(f) ?? (await placeLocation(f)) },
      actorOf(u),
      // Where it came from also goes on the intake entry, as it always did.
      str(f, 'origin', 500) ?? str(f, 'note', 500) ?? undefined,
    )
    createdId = item.id
    return { ok: true, message: `Created ${item.sku}.` }
  }, ['/inventory', '/shop'])
  if (!res.ok || !createdId) return res
  // "Shown on the website: yes" puts it there right away. The item exists either way; the card says how the website step went.
  let website = ''
  if (f.get('onWebsite') === 'yes') {
    const w = await websiteShown(createdId, true)
    website = `?website=${w.ok ? 'ok' : encodeURIComponent((w.message ?? 'failed').slice(0, 300))}`
  }
  redirect(`${f.get('base') === '/shop' ? `/shop/items/${createdId}` : `/inventory/${createdId}`}${website}`)
}

const websiteShown = (id: string, show: boolean) =>
  act(['inventory:write', 'website:write'], show ? 'inventory.website_show' : 'inventory.website_hide', `item:${id}`, {}, (u) => setShownOnWebsite(id, show, actorOf(u)), [`/inventory/${id}`, `/shop/items/${id}`, '/inventory', '/shop', '/website/products'])

/** The item card's "shown on the website" yes/no. */
export async function websiteShownAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid item.' }
  return websiteShown(id.data, f.get('show') === 'true')
}

export async function editItemAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const title = str(f, 'title', 200)
  if (!title) return { ok: false, message: 'The item needs a name.' }
  const fields = await itemFields(f)
  if (!fields.ok) return fields
  const patch: ItemPatch = { ...fields.patch, title }
  const q = f.get('quantity')
  if (q != null && q !== '') {
    const n = Number(q)
    if (!Number.isInteger(n) || n < 0 || n > 10_000) return { ok: false, message: 'Quantity must be a whole number from 0.' }
    patch.quantity = n
    patch.kind = n > 1 ? 'batch' : 'unique'
  }
  return act(['inventory:write'], 'inventory.edit', `item:${id.data}`, { fields: Object.keys(patch) }, (u) => editItem(id.data, v, patch, actorOf(u)), [`/inventory/${id.data}`, '/inventory', `/shop/items/${id.data}`])
}

/** Refurbishment: what it needs, who does it, and how far it is. Also allowed after a sale (paid, awaiting refurbishment). */
export async function refurbAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const v = version(f)
  if (!id.success || !v) return { ok: false, message: 'Invalid item.' }
  const status = String(f.get('refurbStatus') ?? '')
  const level = String(f.get('refurbLevel') ?? '')
  const contact = uuid.safeParse(f.get('refurbContactId'))
  const patch: ItemPatch = {
    refurbStatus: (REFURB_STATUSES as readonly string[]).includes(status) ? (status as RefurbStatus) : null,
    refurbLevel: (REFURB_LEVELS as readonly string[]).includes(level) ? (level as RefurbLevel) : null,
    refurbContactId: contact.success ? contact.data : null,
    refurbInstructions: str(f, 'refurbInstructions', 2000),
  }
  if (patch.refurbStatus === 'done' && patch.condition === undefined) {
    const cur = await getOpsStore().getItem(id.data).catch(() => null)
    if (cur?.condition === 'needs_repair') patch.condition = 'good'
  }
  return act(['inventory:operate'], 'inventory.refurb', `item:${id.data}`, { status: patch.refurbStatus, level: patch.refurbLevel }, (u) => editItem(id.data, v, patch, actorOf(u), { op: 'refurb' }), [`/inventory/${id.data}`, '/inventory', `/shop/items/${id.data}`, '/shop'])
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
  const sale = await openSaleOf({ id: id.data }).catch(() => null)
  if (sale) return { ok: false, message: `This was sold in the shop on ${sale.detail.sale.number}: return it from that sale, so the sale and its payments stay right.` }
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
  const he = f.get('base') === '/shop'
  try {
    await requirePermission('inventory:read')
  } catch {
    return { ok: false, message: he ? 'אין לך הרשאה לראות את המלאי.' : 'Your role cannot read inventory.' }
  }
  const raw = String(f.get('code') ?? '').trim().slice(0, 300)
  let target = /\/(?:inventory|shop\/items)\/([0-9a-f-]{36})/i.exec(raw)?.[1] ?? null
  try {
    // 4-digit serials (JAS-0042), and the 6-digit codes printed before migration 0010 renumbered those items.
    for (const sku of skuCandidates(raw)) {
      if (target) break
      target = (await getOpsStore().getItemBySku(sku))?.id ?? null
    }
  } catch (e) {
    return { ok: false, message: e instanceof OpsSetupError ? e.message : errText(e) }
  }
  if (!target) return { ok: false, message: he ? `לא נמצא פריט עם הקוד ${raw || '(ריק)'}.` : `No item with code ${formatSku(raw) || '(empty)'}.` }
  redirect(f.get('base') === '/shop' ? `/shop/items/${target}` : `/inventory/${target}`)
}
