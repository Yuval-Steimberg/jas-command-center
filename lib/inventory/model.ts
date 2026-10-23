import type { WebsiteProductInput } from '@/lib/integrations/website/manage'
import type { Condition, Item, ItemStatus } from '@/lib/ops/types'

/**
 * Inventory rules, pure. The lifecycle of a physical item after intake:
 *
 *   in_storage ──list──▶ listed ──(website order)──▶ sold ──▶ delivered
 *       │  ▲               │  ▲                        │          │
 *       │  └──release──────┼──┘ reserve ◀──────────────┘ return ◀─┘ (back to in_storage)
 *       └──▶ donated / recycled / disposed (final)
 *
 * The website owns a listed item's price, published flag and stock. Every
 * operation that takes an item out of sale (reserve, in-store sale, donate…)
 * zeroes the website stock FIRST, so the shop cannot sell it at the same time.
 */

export const STATUS_LABEL: Record<ItemStatus, string> = {
  in_storage: 'In storage',
  listed: 'Listed on website',
  reserved: 'Reserved',
  sold: 'Sold',
  delivered: 'Delivered',
  donated: 'Donated',
  recycled: 'Recycled',
  disposed: 'Disposed',
}

export const CONDITION_LABEL: Record<Condition, string> = { as_new: 'As new', good: 'Good', needs_repair: 'Needs repair', scrap_only: 'Scrap only' }

/** Statuses a customer could still buy. */
export const AVAILABLE: readonly ItemStatus[] = ['in_storage', 'listed']
/** Still physically ours (counts as stock on hand). */
export const ON_HAND: readonly ItemStatus[] = ['in_storage', 'listed', 'reserved', 'sold']
export const FINAL: readonly ItemStatus[] = ['delivered', 'donated', 'recycled', 'disposed']

export const OPS = {
  list: ['in_storage'],
  reserve: ['in_storage', 'listed'],
  release: ['reserved'],
  sell_in_store: ['in_storage', 'listed', 'reserved'],
  website_sale: ['listed', 'reserved'],
  deliver: ['sold'],
  return: ['sold', 'delivered'],
  donate: ['in_storage', 'listed'],
  recycle: ['in_storage', 'listed'],
  dispose: ['in_storage', 'listed'],
  move: ['in_storage', 'listed', 'reserved', 'sold'],
  edit: ['in_storage', 'listed', 'reserved'],
} as const satisfies Record<string, readonly ItemStatus[]>
export type Op = keyof typeof OPS

export const can = (op: Op, status: ItemStatus) => (OPS[op] as readonly ItemStatus[]).includes(status)

/** The field app's condition scale → the website's. */
export const WEBSITE_CONDITION: Record<Condition, WebsiteProductInput['condition']> = { as_new: 'excellent', good: 'good', needs_repair: 'fair', scrap_only: 'as-is' }

export const FIELD_CONDITION = (v: string | null | undefined): Condition | null => (v === 'as_new' || v === 'good' || v === 'needs_repair' || v === 'scrap_only' ? v : null)

/** jas-000123: a stable, unique product address derived from the SKU. */
export const skuSlug = (sku: string) => sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const isHttps = (u: string | null | undefined) => {
  if (!u) return false
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The unpublished website product a draft listing creates. The website's own
 * product rules apply (a price above 0 and a main image), so an item without
 * them is refused here with the reason rather than by the website.
 */
export function draftProduct(item: Item, opts: { categoryId?: number | null } = {}): { ok: true; product: WebsiteProductInput } | { ok: false; reason: string } {
  if (!item.priceMinor || item.priceMinor <= 0) return { ok: false, reason: `${item.sku} has no asking price. Set one first.` }
  if (!isHttps(item.photoUrl)) return { ok: false, reason: `${item.sku} has no photo the website can show (an https link is needed).` }
  const story = [item.furnitureProjectName && `נאסף מפרויקט ${item.furnitureProjectName}`, item.furnitureApartment].filter(Boolean).join(', ')
  return {
    ok: true,
    product: {
      name_he: item.title.slice(0, 200),
      name_en: null,
      slug: skuSlug(item.sku),
      description_he: item.description?.slice(0, 10_000) ?? null,
      description_en: null,
      story_he: story || null,
      story_en: null,
      price: item.priceMinor / 100,
      original_price: null,
      category_id: opts.categoryId ?? null,
      condition: item.condition ? WEBSITE_CONDITION[item.condition] : 'good',
      style: null,
      dimensions: item.dimensions?.slice(0, 200) ?? null,
      material: item.material?.slice(0, 200) ?? null,
      origin: null,
      image_url: item.photoUrl!,
      images: [],
      featured: false,
      quantity: item.quantity,
      tags: [item.sku],
      published: false,
    },
  }
}

export const reservationExpired = (item: Pick<Item, 'status' | 'reservedUntil'>, now = Date.now()) =>
  item.status === 'reserved' && item.reservedUntil != null && Date.parse(item.reservedUntil) <= now

/** Days an item has been with us (intake → sale, or → now while unsold). */
export function daysHeld(item: Pick<Item, 'createdAt' | 'soldAt'>, now = Date.now()): number {
  const end = item.soldAt ? Date.parse(item.soldAt) : now
  return Math.max(0, Math.floor((end - Date.parse(item.createdAt)) / 86_400_000))
}

export const formatSku = (raw: string) => {
  const m = /^\s*(?:jas-?)?(\d{1,6})\s*$/i.exec(raw)
  return m ? `JAS-${m[1]!.padStart(6, '0')}` : raw.trim().toUpperCase()
}
