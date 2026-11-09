import 'server-only'
import { getOpsStore, ConflictError } from '@/lib/ops'
import type { Condition, Item, ItemPatch, MovementType } from '@/lib/ops/types'
import { getFieldItems, intakeBlocker } from '@/lib/integrations/furniture/intake'
import {
  deleteWebsiteProduct, getWebsiteProduct, getWebsiteProductMeta, listWebsiteProductsByIds, saveWebsiteProduct, setWebsiteStock, updateWebsiteProduct,
  type WebsiteProduct,
} from '@/lib/integrations/website/manage'
import { shekelsToAgorot } from '@/lib/money'
import { websiteQty } from '@/lib/sync/products'
import { FIELD_CONDITION, OPS, draftProduct, websiteCategoryFor } from './model'
import { catalogColumns, needsCatalogPhoto, websiteBlockers, websitePhotos, BLOCKER_LABEL, type WebsiteBlocker } from './catalog'
import { photoroomCatalog, photoroomConfigured } from './photoroom'
import { ruleEnabled } from '@/lib/tasks/automations'
import { driveDownloadUrls, driveFileId } from './drive'
import { MAX_PHOTO_BYTES, PHOTO_TYPES, uploadInventoryPhoto } from './photos'
import { touchContact } from '@/lib/crm/service'
import { runRule } from '@/lib/tasks/automations'

/**
 * Inventory operations that cross systems. Order of steps is always:
 *   1. take the item off sale on the WEBSITE first (compare-and-set on stock),
 *   2. change the item here atomically (status check + movement in one step),
 *   3. if step 2 is refused, undo step 1.
 * So a failure leaves the item sellable in exactly one place, never two. Each
 * function returns what the systems confirmed; callers audit around it.
 */
export interface Actor {
  email: string
  name: string
}
export type OpResult = { ok: true; item: Item; message: string; warning?: string } | { ok: false; message: string }

const fail = (e: unknown): OpResult => ({ ok: false, message: e instanceof ConflictError ? `Not changed: ${e.message}.` : `Not changed: ${e instanceof Error ? e.message : String(e)}` })

async function websiteQuantity(productId: number): Promise<{ ok: true; quantity: number } | { ok: false; message: string }> {
  const r = await listWebsiteProductsByIds([productId])
  if (r.state !== 'ok') return { ok: false, message: r.state === 'error' ? `The website could not be read: ${r.error}` : `The website is not connected (${r.missing.join(', ')}).` }
  const p = r.data[0]
  if (!p) return { ok: false, message: `Website product #${productId} no longer exists. Unlink it by returning the item to storage.` }
  return { ok: true, quantity: p.in_stock === false ? 0 : (p.quantity ?? 1) }
}

/** Take a listed item off sale on the website. Returns the quantity it had (to restore on undo). */
async function zeroWebsite(item: Item): Promise<{ ok: true; had: number } | { ok: false; message: string }> {
  if (item.websiteProductId == null) return { ok: true, had: 0 }
  const q = await websiteQuantity(item.websiteProductId)
  if (!q.ok) return q
  if (q.quantity === 0) return { ok: true, had: 0 }
  // An outage is an answer here too: the item stays on sale online and nothing changes in inventory.
  const r = await setWebsiteStock(item.websiteProductId, q.quantity, 0).catch((e: unknown) => ({ ok: false as const, message: `the website could not be reached (${e instanceof Error ? e.message : String(e)})` }))
  if (!r.ok) return { ok: false, message: r.message }
  return { ok: true, had: q.quantity }
}

/**
 * Move a listed product's website stock by `delta` units with a compare-and-set
 * (a checkout holding the unit makes it refuse). Returns what it was and what
 * it became, so the caller can put it back with `undoWebsiteShift`.
 */
export async function shiftWebsiteStock(productId: number, delta: number): Promise<{ ok: true; had: number; now: number } | { ok: false; message: string }> {
  const q = await websiteQuantity(productId)
  if (!q.ok) return q
  const next = q.quantity + delta
  if (next < 0) return { ok: false, message: `the website has only ${q.quantity} in stock` }
  if (next === q.quantity) return { ok: true, had: q.quantity, now: next }
  const r = await setWebsiteStock(productId, q.quantity, next).catch((e: unknown) => ({ ok: false as const, message: `the website could not be reached (${e instanceof Error ? e.message : String(e)})` }))
  if (!r.ok) return { ok: false, message: r.message }
  return { ok: true, had: q.quantity, now: next }
}

export async function undoWebsiteShift(productId: number, shift: { had: number; now: number }): Promise<string | undefined> {
  if (shift.had === shift.now) return undefined
  try {
    const r = await setWebsiteStock(productId, shift.now, shift.had)
    return r.ok ? undefined : `The website stock could not be put back to ${shift.had} (${r.message}). Set it on the website product page.`
  } catch (e) {
    return `The website stock could not be put back to ${shift.had} (${e instanceof Error ? e.message : String(e)}). Set it on the website product page.`
  }
}

async function restoreWebsite(productId: number | null, had: number): Promise<string | undefined> {
  if (productId == null || had <= 0) return undefined
  try {
    const r = await setWebsiteStock(productId, 0, had)
    return r.ok ? undefined : `The website stock could not be put back to ${had} (${r.message}). Set it on the website product page.`
  } catch (e) {
    return `The website stock could not be put back to ${had} (${e instanceof Error ? e.message : String(e)}). Set it on the website product page.`
  }
}

// ── Intake ────────────────────────────────────────────────────────────────
export interface IntakeOptions {
  locationId: string | null
  condition?: Condition | null
  priceMinor?: number | null
}

/** Confirm intake of collected field items. One field item enters inventory once (unique key). */
export async function intakeFromFurniture(fieldItemIds: string[], opts: IntakeOptions, actor: Actor): Promise<{ created: Item[]; refused: { id: string; reason: string }[]; message: string }> {
  const store = getOpsStore()
  const r = await getFieldItems(fieldItemIds)
  if (r.state !== 'ok') return { created: [], refused: fieldItemIds.map((id) => ({ id, reason: r.state === 'error' ? r.error : 'furniture is not connected' })), message: 'The field app could not be read; nothing was taken in.' }
  const created: Item[] = []
  const refused: { id: string; reason: string }[] = []
  for (const id of fieldItemIds) {
    const f = r.data.find((x) => x.id === id)
    if (!f) {
      refused.push({ id, reason: 'not found in the field app' })
      continue
    }
    const block = intakeBlocker(f)
    if (block) {
      refused.push({ id, reason: `"${f.description.slice(0, 60)}": ${block}` })
      continue
    }
    const qty = Math.max(1, f.quantity ?? 1)
    try {
      const item = await store.createItem(
        {
          title: f.description.slice(0, 200),
          description: f.notes?.slice(0, 2000) ?? null,
          category: f.item_category ?? null,
          kind: qty > 1 ? 'batch' : 'unique',
          quantity: qty,
          condition: opts.condition ?? FIELD_CONDITION(f.condition),
          status: 'in_storage',
          locationId: opts.locationId,
          priceMinor: opts.priceMinor ?? null,
          photoUrl: f.image_url ?? null,
          dimensions: f.dimensions ?? null,
          material: f.material_category ?? null,
          weightKg: f.estimated_weight_kg ?? null,
          source: 'furniture',
          furnitureItemId: f.id,
          furnitureProjectId: f.project_id,
          furnitureProjectName: f.projectName,
          furnitureApartment: f.apartmentLabel,
          createdBy: actor.email,
        },
        { refKind: 'furniture_item', refId: f.id, actorEmail: actor.email, detail: { collectedBy: f.collected_by ?? null, collectedAt: f.collected_at ?? null } },
      )
      created.push(item)
      await runRule('intake_needs_price', { item }, actor.email)
    } catch (e) {
      if (e instanceof ConflictError) refused.push({ id, reason: `"${f.description.slice(0, 60)}": ${e.message}` })
      else throw e
    }
  }
  const message = `${created.length ? `Took in ${created.length} item(s): ${created.map((i) => i.sku).join(', ')}.` : 'Nothing was taken in.'}${refused.length ? ` Skipped ${refused.length}: ${refused.map((x) => x.reason).join('; ')}.` : ''}`
  return { created, refused, message }
}

export async function createManualItem(input: Pick<Item, 'title'> & ItemPatch, actor: Actor, note?: string): Promise<Item> {
  return getOpsStore().createItem({ ...input, status: 'in_storage', source: 'manual', createdBy: actor.email }, { actorEmail: actor.email, note: note ?? null })
}

// ── Website products made on the website (studio /manager/quick) ─────────
/**
 * Link a product that was created on the website to a new inventory item. It
 * is already for sale there, so the item starts `listed` with the website's
 * stock; price and photo are copied for reference (the website keeps the
 * listing's own). The intake movement's ref is the product id, which is how
 * the item page tells this provenance apart from "added by hand".
 */
export async function adoptWebsiteProduct(p: WebsiteProduct, opts: { locationId: string | null }, actor: Actor): Promise<Item> {
  const qty = websiteQty(p)
  return getOpsStore().createItem(
    {
      title: p.name_he.slice(0, 200),
      category: p.categories?.name_he ?? null,
      kind: qty > 1 ? 'batch' : 'unique',
      quantity: qty,
      status: 'listed',
      locationId: opts.locationId,
      priceMinor: p.price != null ? shekelsToAgorot(p.price) : null,
      photoUrl: p.image_url,
      websiteProductId: p.id,
      source: 'manual',
      createdBy: actor.email,
    },
    { refKind: 'website_product', refId: String(p.id), actorEmail: actor.email, note: `From the website shop (product #${p.id})`, detail: { slug: p.slug, published: p.published ?? null } },
  )
}

/** The person's pick on /inventory/website. Re-reads each product: the form only names ids. */
export async function adoptWebsiteProducts(ids: number[], opts: { locationId: string | null }, actor: Actor): Promise<{ created: Item[]; refused: string[]; message: string }> {
  const r = await listWebsiteProductsByIds(ids)
  if (r.state !== 'ok') return { created: [], refused: [], message: `The website could not be read (${r.state === 'error' ? r.error : 'not connected'}); nothing was taken in.` }
  const linked = new Set((await getOpsStore().listItems({ websiteProductIds: ids, limit: 1000 })).map((i) => i.websiteProductId))
  const created: Item[] = []
  const refused: string[] = []
  for (const id of ids) {
    const p = r.data.find((x) => x.id === id)
    if (!p) { refused.push(`#${id}: no longer on the website`); continue }
    if (linked.has(id)) { refused.push(`"${p.name_he.slice(0, 60)}": already in inventory`); continue }
    if (websiteQty(p) === 0) { refused.push(`"${p.name_he.slice(0, 60)}": out of stock on the website`); continue }
    try {
      created.push(await adoptWebsiteProduct(p, opts, actor))
    } catch (e) {
      if (e instanceof ConflictError) refused.push(`"${p.name_he.slice(0, 60)}": ${e.message}`)
      else throw e
    }
  }
  const message = `${created.length ? `Brought in ${created.length} item(s): ${created.map((i) => i.sku).join(', ')}.` : 'Nothing was taken in.'}${refused.length ? ` Skipped ${refused.length}: ${refused.join('; ')}.` : ''}`
  return { created, refused, message }
}

// ── Edit / move ───────────────────────────────────────────────────────────
/** Fields whose old and new values the history keeps (everything a person edits by hand). */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Change what a person typed about an item. Only fields that really changed
 * are written, and the movement keeps each one's old and new value, so the
 * item's history answers "who changed the price, and from what".
 */
export async function editItem(id: string, version: number, patch: ItemPatch, actor: Actor, opts: { op?: 'edit' | 'refurb' } = {}): Promise<OpResult> {
  try {
    const cur = await getOpsStore().getItem(id)
    if (!cur) return { ok: false, message: 'Item not found.' }
    if (patch.quantity !== undefined && cur.websiteProductId != null && patch.quantity !== cur.quantity)
      return { ok: false, message: 'This item is listed: change its stock on the website product, which owns it now.' }
    const changed: ItemPatch = {}
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const [k, v] of Object.entries(patch) as [keyof ItemPatch, unknown][]) {
      if (same(cur[k as keyof Item], v)) continue
      ;(changed as Record<string, unknown>)[k] = v
      changes[k] = { from: cur[k as keyof Item] ?? null, to: v ?? null }
    }
    if (!Object.keys(changed).length) return { ok: true, item: cur, message: 'Nothing changed.' }
    const op = opts.op ?? 'edit'
    const item = await getOpsStore().applyItem(id, { version, from: OPS[op] }, changed, { type: 'edit', actorEmail: actor.email, detail: { fields: Object.keys(changed), changes, ...(op === 'refurb' ? { refurb: true } : {}) } })
    const priceNote = cur.websiteProductId != null && changed.priceMinor !== undefined ? ' The website keeps its own price for a listed item: change it on the website product too.' : ''
    return { ok: true, item, message: `Saved.${priceNote}` }
  } catch (e) {
    return fail(e)
  }
}

export async function moveItem(id: string, version: number, locationId: string | null, note: string | null, actor: Actor): Promise<OpResult> {
  try {
    const item = await getOpsStore().applyItem(id, { version, from: OPS.move }, { locationId }, { type: 'move', actorEmail: actor.email, note })
    return { ok: true, item, message: 'Moved.' }
  } catch (e) {
    return fail(e)
  }
}

// ── Website listing ───────────────────────────────────────────────────────
/**
 * Create the website product as an unpublished draft and link it. An item
 * that was listed before (returned since) gets its existing product's stock
 * back instead of a second product.
 */
export async function listOnWebsite(id: string, version: number, opts: { categoryId?: number | null; publish?: boolean }, actor: Actor): Promise<OpResult> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (!OPS.list.includes(item.status as 'in_storage')) return { ok: false, message: `Only an item in storage can be listed; this one is ${item.status.replace('_', ' ')}.` }
  if (item.version !== version) return { ok: false, message: 'The item changed since it was loaded. Reload and try again.' }

  if (item.websiteProductId != null) {
    const q = await websiteQuantity(item.websiteProductId)
    if (!q.ok) return q
    if (q.quantity === 0) {
      const r = await setWebsiteStock(item.websiteProductId, 0, item.quantity)
      if (!r.ok) return { ok: false, message: r.message }
    }
    try {
      const updated = await store.applyItem(id, { version, from: OPS.list }, { status: 'listed' }, { type: 'list', refKind: 'website_product', refId: `${item.websiteProductId}:${version}`, actorEmail: actor.email, note: 'relisted' })
      return { ok: true, item: updated, message: `Back on sale on the website (product #${item.websiteProductId}, stock ${item.quantity}). Its published state is unchanged.` }
    } catch (e) {
      const warning = q.quantity === 0 ? await restoreZero(item.websiteProductId, item.quantity) : undefined
      const r = fail(e)
      return warning && !r.ok ? { ok: false, message: `${r.message} ${warning}` } : r
    }
  }

  const draft = draftProduct(item, { categoryId: opts.categoryId, published: opts.publish })
  if (!draft.ok) return { ok: false, message: draft.reason }
  const saved = await saveWebsiteProduct(draft.product)
  if (!saved.ok) return { ok: false, message: `The website refused the draft: ${saved.message}` }
  try {
    const updated = await store.applyItem(id, { version, from: OPS.list }, { status: 'listed', websiteProductId: saved.value.id }, { type: 'list', refKind: 'website_product', refId: String(saved.value.id), actorEmail: actor.email })
    return { ok: true, item: updated, message: opts.publish ? `On the website shop now (product #${saved.value.id}).` : `Draft listing created on the website (product #${saved.value.id}, not published yet). Check it and publish.` }
  } catch (e) {
    // Undo: the draft must not stay on the website unlinked.
    const del = await deleteWebsiteProduct(saved.value.id, saved.value.updated_at).catch((x: unknown) => ({ ok: false as const, conflict: false, message: x instanceof Error ? x.message : String(x) }))
    const r = fail(e)
    return !r.ok && !del.ok ? { ok: false, message: `${r.message} The draft product #${saved.value.id} could not be removed (${del.message}); delete it on the website.` } : r
  }
}

/** Runs `fn` over `xs` with at most `n` at a time, keeping the input order in the result. */
async function pool<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) {
      const i = next++
      out[i] = await fn(xs[i]!)
    }
  }))
  return out
}

/**
 * Put several items in storage on the website shop at once, published, each
 * in the website category of the same name. Every item goes through
 * `listOnWebsite`, so each one is linked and stays sellable in one place only;
 * one refusal never stops the others.
 */
export async function listManyOnWebsite(ids: string[], actor: Actor): Promise<{ listed: Item[]; refused: string[]; message: string }> {
  const store = getOpsStore()
  const meta = await getWebsiteProductMeta()
  if (meta.state !== 'ok') return { listed: [], refused: [], message: `The website could not be read (${meta.state === 'error' ? meta.error : 'not connected'}); nothing was listed.` }
  const items = await store.listItems({ ids, limit: ids.length })
  const results = await pool(ids, 5, async (id): Promise<{ ok: true; item: Item } | { ok: false; why: string }> => {
    const item = items.find((i) => i.id === id)
    if (!item) return { ok: false, why: `${id.slice(0, 8)}: not found` }
    try {
      // The website must not depend on Drive either: copy a Drive photo first.
      const copied = await copyDrivePhotos(item, actor)
      if (!copied.ok) return { ok: false, why: `${item.sku}: ${copied.message}` }
      // Marked "on the website", so the hourly step makes its catalog photo (not here: 30 Photoroom calls would outrun the request).
      const cur = await markWanted(copied.item, true, actor)
      const r = await listOnWebsite(id, cur.version, { categoryId: websiteCategoryFor(cur.category, meta.data.categories), publish: true }, actor)
      return r.ok ? { ok: true, item: r.item } : { ok: false, why: `${item.sku}: ${r.message}` }
    } catch (e) {
      return { ok: false, why: `${item.sku}: ${e instanceof Error ? e.message : String(e)}` }
    }
  })
  const listed = results.flatMap((r) => (r.ok ? [r.item] : []))
  const refused = results.flatMap((r) => (r.ok ? [] : [r.why]))
  const message = `${listed.length ? `${listed.length} item(s) are on the website shop now.` : 'Nothing was listed.'}${refused.length ? ` Not listed (${refused.length}): ${refused.join('; ')}.` : ''}`
  return { listed, refused, message }
}

/**
 * Take website products off the shop by unpublishing them. Nothing is deleted:
 * past orders still point at them, and publishing brings one back. A product
 * linked to an inventory item goes through `setListingPublished` so the item's
 * history records it.
 */
export async function hideWebsiteProducts(productIds: number[], actor: Actor): Promise<{ hidden: number; refused: string[]; message: string }> {
  const [linked, products] = await Promise.all([
    getOpsStore().listItems({ websiteProductIds: productIds, limit: productIds.length }),
    listWebsiteProductsByIds(productIds),
  ])
  if (products.state !== 'ok') return { hidden: 0, refused: [], message: `The website could not be read (${products.state === 'error' ? products.error : 'not connected'}); nothing was hidden.` }
  const results = await pool(productIds, 5, async (pid): Promise<string | null> => {
    const p = products.data.find((x) => x.id === pid)
    if (!p) return `#${pid}: no longer on the website`
    if (p.published === false) return null
    try {
      // Only the flag is sent: re-saving the whole product can exceed the website's request size (HTTP 413).
      const saved = await updateWebsiteProduct(pid, { published: false }, p.updated_at)
      if (!saved.ok) return `"${p.name_he.slice(0, 60)}": ${saved.message}`
    } catch (e) {
      return `"${p.name_he.slice(0, 60)}": ${e instanceof Error ? e.message : String(e)}`
    }
    const item = linked.find((i) => i.websiteProductId === pid)
    if (item) await getOpsStore().applyItem(item.id, {}, {}, { type: 'unpublish', actorEmail: actor.email, refKind: 'website_product', refId: `${pid}@hide:${p.updated_at}` }).catch(() => undefined)
    return null
  })
  const refused = results.filter((r): r is string => r != null)
  const hidden = productIds.length - refused.length
  return { hidden, refused, message: `${hidden ? `${hidden} product(s) hidden from the website shop (kept, not deleted).` : 'Nothing was hidden.'}${refused.length ? ` Not hidden (${refused.length}): ${refused.join('; ')}.` : ''}` }
}

/** Fetch one Drive file server-side; null when it is not an image Drive will give us. */
async function fetchDriveImage(id: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  for (const url of driveDownloadUrls(id)) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), cache: 'no-store' })
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
      if (!res.ok || !PHOTO_TYPES.has(type)) continue
      const bytes = await res.arrayBuffer()
      if (bytes.byteLength > 0 && bytes.byteLength <= MAX_PHOTO_BYTES) return { bytes, type }
    } catch {
      // try the next form
    }
  }
  return null
}

/**
 * Copy an item's Drive photos into the command center's photo store and point
 * the item at the copies (an ordinary edit, so the history keeps the old link).
 * An item with no Drive photo comes back unchanged.
 */
export async function copyDrivePhotos(item: Item, actor: Actor): Promise<{ ok: true; item: Item; copied: number } | { ok: false; message: string }> {
  const links = [item.photoUrl, ...(item.extraPhotos ?? [])]
  if (!links.some((l) => driveFileId(l))) return { ok: true, item, copied: 0 }
  const out: (string | null)[] = []
  let copied = 0
  for (const link of links) {
    const id = driveFileId(link)
    if (!id) { out.push(link); continue }
    const img = await fetchDriveImage(id)
    if (!img) return { ok: false, message: `its Drive photo could not be downloaded (file ${id}); check it is shared "anyone with the link"` }
    out.push(await uploadInventoryPhoto(img.bytes, img.type))
    copied++
  }
  const [photoUrl, ...extra] = out
  const r = await editItem(item.id, item.version, { photoUrl: photoUrl ?? null, extraPhotos: extra.filter((x): x is string => !!x) }, actor)
  return r.ok ? { ok: true, item: r.item, copied } : { ok: false, message: r.message }
}

/** Copy the Drive photos of several items, five at a time; one failure never stops the rest. */
export async function copyDrivePhotosMany(ids: string[], actor: Actor): Promise<{ done: number; refused: string[]; message: string }> {
  const items = await getOpsStore().listItems({ ids, limit: ids.length })
  const results = await pool(ids, 5, async (id): Promise<string | null> => {
    const item = items.find((i) => i.id === id)
    if (!item) return `${id.slice(0, 8)}: not found`
    try {
      const r = await copyDrivePhotos(item, actor)
      return r.ok ? null : `${item.sku}: ${r.message}`
    } catch (e) {
      return `${item.sku}: ${e instanceof Error ? e.message : String(e)}`
    }
  })
  const refused = results.filter((r): r is string => r != null)
  const done = ids.length - refused.length
  return { done, refused, message: `${done ? `Photos of ${done} item(s) are stored in the command center now.` : 'No photo was copied.'}${refused.length ? ` Not copied (${refused.length}): ${refused.join('; ')}.` : ''}` }
}

async function restoreZero(productId: number, qty: number): Promise<string | undefined> {
  try {
    const r = await setWebsiteStock(productId, qty, 0)
    return r.ok ? undefined : `Website product #${productId} was put back on sale and could not be taken off again: set its stock to 0.`
  } catch {
    return `Website product #${productId} was put back on sale and could not be taken off again: set its stock to 0.`
  }
}

/** Publish / unpublish the linked website product (the website owns the flag). */
export async function setListingPublished(id: string, published: boolean, actor: Actor): Promise<OpResult> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item?.websiteProductId) return { ok: false, message: 'This item has no website listing.' }
  const p = await getWebsiteProduct(item.websiteProductId)
  if (p.state !== 'ok') return { ok: false, message: p.state === 'error' ? p.error : 'The website is not connected.' }
  if (!p.data) return { ok: false, message: `Website product #${item.websiteProductId} no longer exists.` }
  if (p.data.published === undefined) return { ok: false, message: 'This website has no published column; products there are always visible.' }
  if (Boolean(p.data.published) === published) return { ok: false, message: published ? 'It is already published.' : 'It is already hidden.' }
  // Only the flag: re-saving the whole product can exceed the website's request size (HTTP 413).
  const saved = await updateWebsiteProduct(p.data.id, { published }, p.data.updated_at)
  if (!saved.ok) return { ok: false, message: saved.message }
  try {
    const updated = await store.applyItem(id, {}, {}, { type: published ? 'publish' : 'unpublish', actorEmail: actor.email, refKind: 'website_product', refId: `${item.websiteProductId}@${saved.value.updated_at}` })
    return { ok: true, item: updated, message: published ? 'Published: it is in the shop now.' : 'Hidden from the shop.' }
  } catch (e) {
    return { ok: true, item, message: published ? 'Published on the website.' : 'Hidden on the website.', warning: `The history entry was not written (${e instanceof Error ? e.message : String(e)}).` }
  }
}

/**
 * "Shown on the website" yes/no, the item card's one switch. Yes: an item in
 * storage is listed and published (in the website category of the same name);
 * a listed but hidden one is published again. No: the listing is unpublished,
 * never deleted (orders point at products) and its stock is left alone.
 * Both directions reuse listOnWebsite / setListingPublished, so the website
 * and the item's history agree.
 */
export async function setShownOnWebsite(id: string, show: boolean, actor: Actor): Promise<OpResult> {
  const found = await getOpsStore().getItem(id)
  if (!found) return { ok: false, message: 'Item not found.' }
  // The wish is kept on the item (migration 0016), so "no" also stops the automatic step from putting it back.
  const item = await markWanted(found, show, actor)
  const linkedLive = item.websiteProductId != null && (item.status === 'listed' || item.status === 'reserved')
  if (!show) {
    if (linkedLive) return setListingPublished(id, false, actor)
    return found.websiteWanted === true ? { ok: true, item, message: 'It will not go on the website.' } : { ok: false, message: 'It is not on the website.' }
  }
  if (linkedLive) return setListingPublished(id, true, actor)
  if (!OPS.list.includes(item.status as 'in_storage')) return { ok: false, message: `Only an item in storage can go on the website; this one is ${item.status.replace('_', ' ')}.` }
  return putOnWebsite(item, actor)
}

/** Copy Drive photos, make the catalog photo, list and publish. A catalog-photo failure never stops the listing. */
async function putOnWebsite(item: Item, actor: Actor, deadline?: number): Promise<OpResult & { catalog?: boolean; catalogWarning?: string }> {
  const meta = await getWebsiteProductMeta()
  if (meta.state !== 'ok') return { ok: false, message: `The website could not be read (${meta.state === 'error' ? meta.error : 'not connected'}).` }
  const copied = await copyDrivePhotos(item, actor)
  if (!copied.ok) return { ok: false, message: copied.message }
  const cat = await ensureCatalogPhoto(copied.item, actor, { deadline })
  const r = await listOnWebsite(item.id, cat.item.version, { categoryId: websiteCategoryFor(cat.item.category, meta.data.categories), publish: true }, actor)
  if (!r.ok) return r
  return { ...r, catalog: cat.made, ...(cat.warning ? { warning: [r.warning, cat.warning].filter(Boolean).join(' ') } : {}), ...(cat.warning ? { catalogWarning: cat.warning } : {}) }
}

/** Record whether the item should be on the website. A no-op before migration 0016 or when already so. */
async function markWanted(item: Item, wanted: boolean, actor: Actor): Promise<Item> {
  if (!catalogColumns(item) || (item.websiteWanted === true) === wanted || !OPS.edit.includes(item.status as 'in_storage')) return item
  const r = await editItem(item.id, item.version, { websiteWanted: wanted }, actor)
  return r.ok ? r.item : item
}

// ── Catalog photos ────────────────────────────────────────────────────────
/** Fetch an https image server-side; null when it is not a photo we can send. */
async function fetchImage(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
    if (!res.ok || !PHOTO_TYPES.has(type)) return null
    const bytes = await res.arrayBuffer()
    return bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024 ? { bytes, type } : null
  } catch {
    return null
  }
}

/**
 * Make the catalog photo of the item's CURRENT main photo, once. The original is
 * never touched. A failure is recorded against that photo, so the hourly step
 * does not pay for the same failing photo again; "remake" (`force`) does.
 * Without Photoroom or migration 0016 the item comes back unchanged.
 */
export async function ensureCatalogPhoto(item: Item, actor: Actor, opts: { force?: boolean; deadline?: number } = {}): Promise<{ item: Item; made: boolean; warning?: string; deferred?: true }> {
  if (!photoroomConfigured() || !catalogColumns(item)) return { item, made: false }
  const due = opts.force ? !!item.photoUrl?.startsWith('https://') : needsCatalogPhoto(item)
  if (!due || !item.photoUrl) return { item, made: false }
  const source = item.photoUrl
  const record = async (patch: ItemPatch) => {
    const r = await editItem(item.id, item.version, patch, actor)
    return r.ok ? r.item : item
  }
  const failed = async (why: string) => ({ item: await record({ catalogPhotoUrl: null, catalogPhotoFrom: source, catalogPhotoError: why.slice(0, 300) }), made: false, warning: `No catalog photo: ${why}. The original photo is used.` })
  const img = await fetchImage(source)
  if (!img) return failed('the main photo could not be downloaded')
  const out = await photoroomCatalog(img.bytes, img.type, { deadline: opts.deadline })
  // Out of time (an hourly run's deadline) is not the photo's fault: nothing is recorded, the next run tries again.
  if (!out.ok && out.deferred) return { item, made: false, deferred: true }
  if (!out.ok) return failed(out.message)
  let url: string
  try {
    url = await uploadInventoryPhoto(out.bytes, out.type)
  } catch (e) {
    return failed(`the catalog photo could not be stored (${e instanceof Error ? e.message : String(e)})`)
  }
  const saved = await editItem(item.id, item.version, { catalogPhotoUrl: url, catalogPhotoFrom: source, catalogPhotoError: null, catalogPhotoOff: false }, actor)
  // Made and paid for, but not saved on the item: say so instead of counting it as made.
  if (!saved.ok) return { item, made: false, warning: `A catalog photo was made but could not be saved on the item (${saved.message}).` }
  return { item: saved.item, made: true }
}

/** Point the linked website product at the item's photos (catalog main + originals in the gallery). */
export async function syncWebsitePhotos(item: Item): Promise<{ ok: true; changed: boolean } | { ok: false; message: string }> {
  if (item.websiteProductId == null) return { ok: true, changed: false }
  const p = await getWebsiteProduct(item.websiteProductId)
  if (p.state !== 'ok') return { ok: false, message: p.state === 'error' ? p.error : 'The website is not connected.' }
  if (!p.data) return { ok: false, message: `Website product #${item.websiteProductId} no longer exists.` }
  const { main, gallery } = websitePhotos(item)
  if (!main.startsWith('https://')) return { ok: true, changed: false }
  if (p.data.image_url === main && JSON.stringify(p.data.images ?? []) === JSON.stringify(gallery)) return { ok: true, changed: false }
  try {
    const saved = await updateWebsiteProduct(p.data.id, { image_url: main, images: gallery }, p.data.updated_at)
    return saved.ok ? { ok: true, changed: true } : { ok: false, message: saved.message }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

const photoNote = (s: Awaited<ReturnType<typeof syncWebsitePhotos>>) => (s.ok ? undefined : `The website still shows the previous photo (${s.message}).`)

/** "Use the original photo" (off = true) or back to the catalog photo, on the item and the website. */
export async function setCatalogPhotoOff(id: string, off: boolean, actor: Actor): Promise<OpResult> {
  const item = await getOpsStore().getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (!catalogColumns(item)) return { ok: false, message: 'Catalog photos need migration 0016 first.' }
  const r = await editItem(id, item.version, { catalogPhotoOff: off }, actor)
  if (!r.ok) return r
  let cur = r.item
  if (!off) cur = (await ensureCatalogPhoto(cur, actor)).item
  const synced = await syncWebsitePhotos(cur)
  return { ok: true, item: cur, message: off ? 'The website shows the original photo now.' : 'The website shows the catalog photo now.', warning: photoNote(synced) }
}

/** Make the catalog photo again (a new Photoroom call) and show it on the website. */
export async function remakeCatalogPhoto(id: string, actor: Actor): Promise<OpResult> {
  const item = await getOpsStore().getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (!photoroomConfigured()) return { ok: false, message: 'Photoroom is not set up yet (PHOTOROOM_API_KEY).' }
  if (!catalogColumns(item)) return { ok: false, message: 'Catalog photos need migration 0016 first.' }
  const made = await ensureCatalogPhoto(item, actor, { force: true })
  if (!made.made) return { ok: false, message: made.warning ?? 'No catalog photo was made.' }
  const synced = await syncWebsitePhotos(made.item)
  return { ok: true, item: made.item, message: 'New catalog photo made.', warning: photoNote(synced) }
}

// ── Automatic publishing ──────────────────────────────────────────────────
export type AutoPublish =
  | { state: 'listed' | 'waiting' | 'skipped'; message: string; blockers?: WebsiteBlocker[]; warning?: string; catalog?: boolean; catalogWarning?: string }
  | { state: 'failed'; message: string }

/**
 * An item marked "on the website" goes up by itself once ready
 * (`websiteBlockers`). Called after every save that can make it ready (create,
 * edit, approve price, move out of the workshop) and by the hourly step.
 */
export async function publishIfReady(id: string, actor: Actor, opts: { deadline?: number } = {}): Promise<AutoPublish> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item || item.websiteWanted !== true) return { state: 'skipped', message: 'Not marked for the website.' }
  if (item.status !== 'in_storage') return { state: 'skipped', message: 'Already on the website or not in storage.' }
  if (!(await ruleEnabled('website_auto_publish'))) return { state: 'skipped', message: 'Automatic publishing is switched off on /tasks.' }
  const blockers = websiteBlockers(item, await store.listLocations())
  if (blockers.length) return { state: 'waiting', blockers, message: `Waiting for the website: ${blockers.map((b) => BLOCKER_LABEL[b]).join(', ')}.` }
  const r = await putOnWebsite(item, actor, opts.deadline)
  return r.ok ? { state: 'listed', message: r.message, warning: r.warning, catalog: r.catalog, catalogWarning: r.catalogWarning } : { state: 'failed', message: r.message }
}

/** Would `publishIfReady` put it up now? Read-only, so a caller audits only what really happens. */
export async function autoPublishDue(id: string): Promise<boolean> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item || item.websiteWanted !== true || item.status !== 'in_storage') return false
  if (websiteBlockers(item, await store.listLocations()).length) return false
  return ruleEnabled('website_auto_publish')
}

/** At most this many Photoroom calls per hourly run. */
const SWEEP_PHOTO_BUDGET = 6
/**
 * An item is not started with less time than this before the run's deadline:
 * publishing one copies its photos, makes the catalog photo and lists it,
 * several round trips plus a Photoroom edit. What is left waits for the next run.
 */
export const AUTO_PUBLISH_ITEM_MS = 20_000

/**
 * The hourly step: publish wanted items that became ready, and give listed
 * wanted items a catalog photo of their current main photo (new listing from
 * the bulk page, or a changed photo). Items never marked are never touched,
 * so nothing already in stock goes online by this.
 *
 * `deadline` (epoch ms): the run stops starting items before it and counts
 * them as `deferred`. Without it a slow Photoroom killed the whole serverless
 * function at its time limit (Nov 2026: every hourly sweep 504'd for two days).
 */
export async function runWebsiteAutoPublish(actor: Actor, opts: { deadline?: number } = {}): Promise<{ listed: number; photos: number; waiting: number; deferred: number; problems: string[] }> {
  const store = getOpsStore()
  const items = await store.listItems({ websiteWanted: true, statuses: ['in_storage', 'listed', 'reserved'], limit: 1000 })
  const locations = await store.listLocations()
  const out = { listed: 0, photos: 0, waiting: 0, deferred: 0, problems: [] as string[] }
  const { deadline } = opts
  const outOfTime = () => deadline != null && deadline - Date.now() < AUTO_PUBLISH_ITEM_MS
  let budget = SWEEP_PHOTO_BUDGET
  for (const item of items) {
    if (item.status === 'in_storage') {
      if (websiteBlockers(item, locations).length) { out.waiting++; continue }
      if (budget <= 0) continue
      if (outOfTime()) { out.deferred++; continue }
      budget -= needsCatalogPhoto(item) && photoroomConfigured() ? 1 : 0
      const r = await publishIfReady(item.id, actor, { deadline }).catch((e: unknown) => ({ state: 'failed' as const, message: e instanceof Error ? e.message : String(e) }))
      if (r.state === 'listed') {
        out.listed++
        if (r.catalog) out.photos++
        // A catalog photo that failed while publishing must show in the sync result, not only on the item card.
        else if (r.catalogWarning) out.problems.push(`${item.sku}: ${r.catalogWarning}`)
      } else if (r.state === 'failed') out.problems.push(`${item.sku}: ${r.message}`)
    } else if (budget > 0 && photoroomConfigured() && needsCatalogPhoto(item)) {
      if (outOfTime()) { out.deferred++; continue }
      budget--
      const made = await ensureCatalogPhoto(item, actor, { deadline })
      if (made.deferred) { out.deferred++; continue }
      if (!made.made) { if (made.warning) out.problems.push(`${item.sku}: ${made.warning}`); continue }
      out.photos++
      const s = await syncWebsitePhotos(made.item)
      if (!s.ok) out.problems.push(`${item.sku}: ${s.message}`)
    }
  }
  return out
}

// ── Reservation ───────────────────────────────────────────────────────────
export async function reserveItem(id: string, version: number, contactId: string, days: number, note: string | null, actor: Actor): Promise<OpResult> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (!OPS.reserve.includes(item.status as 'in_storage')) return { ok: false, message: `It cannot be reserved: it is ${item.status.replace('_', ' ')}.` }
  if (item.version !== version) return { ok: false, message: 'The item changed since it was loaded. Reload and try again.' }
  const contact = await store.getContact(contactId)
  if (!contact) return { ok: false, message: 'Pick the customer it is reserved for.' }
  const off = item.status === 'listed' ? await zeroWebsite(item) : { ok: true as const, had: 0 }
  if (!off.ok) return { ok: false, message: `Not reserved: ${off.message}` }
  try {
    const until = new Date(Date.now() + Math.min(Math.max(days, 1), 30) * 86_400_000).toISOString()
    const updated = await store.applyItem(
      id,
      { version, from: OPS.reserve },
      { status: 'reserved', reservedFor: contactId, reservedUntil: until, reservedPrevStatus: item.status, reservedWebsiteQty: off.had },
      { type: 'reserve', refKind: 'contact', refId: null, actorEmail: actor.email, note, detail: { contact: contact.fullName, until, websiteQuantityBefore: off.had } },
    )
    await touchContact(contactId, { channel: 'note', direction: 'none', summary: `Reserved ${item.sku} "${item.title}" until ${until.slice(0, 10)}${note ? `: ${note}` : ''}`, refKind: 'reserve', refId: `${item.id}:${updated.version}` }, actor.email)
    return { ok: true, item: updated, message: `Reserved for ${contact.fullName} until ${until.slice(0, 10)}.${off.had ? ' The website shows it as sold out meanwhile.' : ''}` }
  } catch (e) {
    const warning = await restoreWebsite(item.websiteProductId, off.had)
    const r = fail(e)
    return warning && !r.ok ? { ok: false, message: `${r.message} ${warning}` } : r
  }
}

export async function releaseItem(id: string, reason: string, actor: Actor): Promise<OpResult> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (item.status !== 'reserved') return { ok: false, message: 'It is not reserved.' }
  const back = item.reservedPrevStatus === 'listed' ? 'listed' : 'in_storage'
  try {
    const updated = await store.applyItem(
      id,
      { version: item.version, from: OPS.release },
      { status: back, reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null },
      { type: 'release', actorEmail: actor.email, note: reason },
    )
    const warning = back === 'listed' ? await restoreWebsite(item.websiteProductId, item.reservedWebsiteQty ?? 0) : undefined
    return { ok: true, item: updated, message: back === 'listed' ? 'Released: it is on sale on the website again.' : 'Released: back in storage.', warning }
  } catch (e) {
    return fail(e)
  }
}

// ── Sale, delivery, return, disposition ───────────────────────────────────
export async function sellInStore(id: string, version: number, sale: { priceMinor: number; contactId: string | null; note: string | null }, actor: Actor): Promise<OpResult> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (!OPS.sell_in_store.includes(item.status as 'in_storage')) return { ok: false, message: `It cannot be sold: it is ${item.status.replace('_', ' ')}.` }
  if (item.version !== version) return { ok: false, message: 'The item changed since it was loaded. Reload and try again.' }
  const off = item.status === 'listed' ? await zeroWebsite(item) : { ok: true as const, had: 0 }
  if (!off.ok) return { ok: false, message: `Not sold: ${off.message}` }
  try {
    const updated = await store.applyItem(
      id,
      { version, from: OPS.sell_in_store },
      { status: 'sold', soldChannel: 'in_store', soldAt: new Date().toISOString(), soldPriceMinor: sale.priceMinor, buyerContactId: sale.contactId, reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null },
      { type: 'sell', actorEmail: actor.email, note: sale.note, detail: { channel: 'in_store', priceMinor: sale.priceMinor, websiteQuantityBefore: off.had } },
    )
    if (sale.contactId) {
      await touchContact(sale.contactId, { channel: 'in_person', direction: 'none', summary: `Bought ${item.sku} "${item.title}" in the shop`, refKind: 'item_sale', refId: item.id }, actor.email, 'customer')
    }
    await runRule('sale_needs_delivery', { item: updated }, actor.email)
    return { ok: true, item: updated, message: 'Recorded as sold in the shop.' }
  } catch (e) {
    const warning = await restoreWebsite(item.websiteProductId, off.had)
    const r = fail(e)
    return warning && !r.ok ? { ok: false, message: `${r.message} ${warning}` } : r
  }
}

export async function markDelivered(id: string, note: string | null, actor: Actor, ref?: { kind: string; id: string }): Promise<OpResult> {
  try {
    const item = await getOpsStore().applyItem(id, { from: OPS.deliver }, { status: 'delivered' }, { type: 'deliver', actorEmail: actor.email, note, refKind: ref?.kind ?? null, refId: ref?.id ?? null })
    return { ok: true, item, message: 'Marked delivered.' }
  } catch (e) {
    return fail(e)
  }
}

/** Back to stock. Clears the sale on the item (the movement keeps it); the money goes back through Grow or the till, not here. */
export async function returnItem(id: string, version: number, locationId: string | null, reason: string, actor: Actor): Promise<OpResult> {
  const store = getOpsStore()
  const cur = await store.getItem(id)
  if (!cur) return { ok: false, message: 'Item not found.' }
  try {
    const item = await store.applyItem(
      id,
      { version, from: OPS.return },
      { status: 'in_storage', locationId: locationId ?? cur.locationId, soldChannel: null, soldAt: null, soldPriceMinor: null, buyerContactId: null, websiteOrderId: null, websiteOrderNumber: null },
      { type: 'return', actorEmail: actor.email, note: reason, detail: { soldChannel: cur.soldChannel, soldPriceMinor: cur.soldPriceMinor, websiteOrderNumber: cur.websiteOrderNumber, buyerContactId: cur.buyerContactId } },
    )
    const money = cur.soldChannel === 'website' ? ` Refund the customer in Grow if they paid online (order ${cur.websiteOrderNumber ?? '?'}).` : cur.soldChannel === 'in_store' ? ' Refund the customer at the till if they paid.' : ''
    return { ok: true, item, message: `Back in storage.${money}${cur.websiteProductId ? ' Use "List on website" to put it back on sale.' : ''}` }
  } catch (e) {
    return fail(e)
  }
}

const DISPOSITION: Record<'donate' | 'recycle' | 'dispose', { status: 'donated' | 'recycled' | 'disposed'; done: string }> = {
  donate: { status: 'donated', done: 'Recorded as donated.' },
  recycle: { status: 'recycled', done: 'Recorded as sent to recycling.' },
  dispose: { status: 'disposed', done: 'Recorded as disposed.' },
}

export async function disposeItem(id: string, version: number, kind: 'donate' | 'recycle' | 'dispose', note: string, actor: Actor, contactId?: string | null): Promise<OpResult> {
  const store = getOpsStore()
  const item = await store.getItem(id)
  if (!item) return { ok: false, message: 'Item not found.' }
  if (!OPS[kind].includes(item.status as 'in_storage')) return { ok: false, message: `It cannot be ${DISPOSITION[kind].status}: it is ${item.status.replace('_', ' ')}.` }
  if (item.version !== version) return { ok: false, message: 'The item changed since it was loaded. Reload and try again.' }
  const off = item.status === 'listed' ? await zeroWebsite(item) : { ok: true as const, had: 0 }
  if (!off.ok) return { ok: false, message: `Not changed: ${off.message}` }
  try {
    const updated = await store.applyItem(id, { version, from: OPS[kind] }, { status: DISPOSITION[kind].status, dispositionNote: note, buyerContactId: contactId ?? null }, { type: kind as MovementType, actorEmail: actor.email, note })
    if (contactId) await touchContact(contactId, { channel: 'note', direction: 'none', summary: `Received ${item.sku} "${item.title}" (${DISPOSITION[kind].status})`, refKind: kind, refId: item.id }, actor.email, 'partner')
    const hidden = off.had ? ' The website product is now out of stock; unpublish or delete it there if it should disappear.' : ''
    return { ok: true, item: updated, message: `${DISPOSITION[kind].done}${hidden}` }
  } catch (e) {
    const warning = await restoreWebsite(item.websiteProductId, off.had)
    const r = fail(e)
    return warning && !r.ok ? { ok: false, message: `${r.message} ${warning}` } : r
  }
}

