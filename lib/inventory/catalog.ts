import type { Item } from '@/lib/ops/types'

/**
 * Catalog photos and "goes on the website by itself" (owner, 2026-11-06).
 * Pure: the rules the item card, the automatic step and the website draft all
 * read, so they can never disagree.
 *
 * The catalog photo is made by Photoroom from the main photo: background removed,
 * a cream studio backdrop, a soft shadow, light corrected without shifting hue or
 * saturation. Nothing that redraws the item itself (beautify, upscale, uncrop,
 * text removal, AI edit) is ever asked for: these are used, renewed pieces, and a
 * photo that hides a scratch or changes a colour turns into a return.
 */

const https = (u: string | null | undefined): u is string => {
  if (!u) return false
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

/** Migration 0016 has run when the store returns its columns (null/false), not undefined. */
export const catalogColumns = (item: Pick<Item, 'catalogPhotoUrl'>) => item.catalogPhotoUrl !== undefined

/** The catalog photo that belongs to the CURRENT main photo, or null (none, stale, or switched off). */
export function currentCatalogPhoto(item: Pick<Item, 'photoUrl' | 'catalogPhotoUrl' | 'catalogPhotoFrom' | 'catalogPhotoOff'>): string | null {
  if (item.catalogPhotoOff === true) return null
  if (!https(item.catalogPhotoUrl) || !item.photoUrl || item.catalogPhotoFrom !== item.photoUrl) return null
  return item.catalogPhotoUrl
}

/**
 * What the website shows: the catalog photo as the main image when there is a
 * current one, and every untouched original in the gallery, so a customer can
 * always see the real piece, wear included.
 */
export function websitePhotos(item: Pick<Item, 'photoUrl' | 'extraPhotos' | 'catalogPhotoUrl' | 'catalogPhotoFrom' | 'catalogPhotoOff'>): { main: string; gallery: string[] } {
  const catalog = currentCatalogPhoto(item)
  const originals = [item.photoUrl, ...(item.extraPhotos ?? [])].filter(https)
  const main = catalog ?? item.photoUrl ?? ''
  const gallery = (catalog ? originals : originals.slice(1)).filter((u, i, all) => u !== main && all.indexOf(u) === i).slice(0, 30)
  return { main, gallery }
}

/** Should a catalog photo be made now? Never twice for the same photo: a failure waits for "remake". */
export function needsCatalogPhoto(item: Pick<Item, 'photoUrl' | 'catalogPhotoUrl' | 'catalogPhotoFrom' | 'catalogPhotoOff'>): boolean {
  if (!catalogColumns(item) || item.catalogPhotoOff === true || !https(item.photoUrl)) return false
  return item.catalogPhotoFrom !== item.photoUrl
}

export type CatalogState = 'unavailable' | 'none' | 'ready' | 'failed' | 'original' | 'pending'

/** For the item card. `unavailable` = migration 0016 not run. */
export function catalogState(item: Pick<Item, 'photoUrl' | 'catalogPhotoUrl' | 'catalogPhotoFrom' | 'catalogPhotoOff' | 'catalogPhotoError'>): CatalogState {
  if (!catalogColumns(item)) return 'unavailable'
  if (!https(item.photoUrl)) return 'none'
  if (item.catalogPhotoOff === true) return 'original'
  if (currentCatalogPhoto(item)) return 'ready'
  if (item.catalogPhotoFrom === item.photoUrl && item.catalogPhotoError) return 'failed'
  return 'pending'
}

/** Why an item is not going on the website yet. Empty = ready. */
export type WebsiteBlocker = 'status' | 'photo' | 'price' | 'price_not_approved' | 'workshop' | 'stock'

const WORKSHOP = /בית מלאכה|סדנה|workshop/i

/**
 * The gate for the automatic path. A person pressing "put on the website" is
 * their own decision; this is what lets an item go up with nobody pressing
 * anything: in storage, a photo, an asking price someone approved (the AI's
 * estimate never goes up alone), and not still in the workshop.
 */
export function websiteBlockers(
  item: Pick<Item, 'status' | 'photoUrl' | 'priceMinor' | 'priceApproved' | 'quantity' | 'locationId'>,
  locations: readonly { id: string; name: string }[],
): WebsiteBlocker[] {
  const out: WebsiteBlocker[] = []
  if (item.status !== 'in_storage') out.push('status')
  if (!https(item.photoUrl)) out.push('photo')
  if (!item.priceMinor || item.priceMinor <= 0) out.push('price')
  else if (item.priceApproved === false) out.push('price_not_approved')
  if (item.quantity < 1) out.push('stock')
  const loc = item.locationId ? locations.find((l) => l.id === item.locationId) : undefined
  if (loc && WORKSHOP.test(loc.name)) out.push('workshop')
  return out
}

export const BLOCKER_LABEL_HE: Record<WebsiteBlocker, string> = {
  status: 'הפריט לא במלאי',
  photo: 'אין תמונה',
  price: 'אין מחיר',
  price_not_approved: 'המחיר עוד לא אושר',
  workshop: 'הפריט בבית המלאכה',
  stock: 'אין יחידות במלאי',
}
export const BLOCKER_LABEL: Record<WebsiteBlocker, string> = {
  status: 'it is not in storage',
  photo: 'no photo',
  price: 'no asking price',
  price_not_approved: 'the price is not approved yet',
  workshop: 'it is still in the workshop',
  stock: 'no units in stock',
}

/**
 * The Photoroom v2/edit fields (docs.photoroom.com, image editing API, read
 * 2026-11-06). Only operations that work AROUND the product. 4:5 because the
 * website's shop cards are 4:5 with object-cover: a square would be cropped.
 * `lighting` is dropped on retry when Photoroom refuses it (relight is limited
 * to 3500px images).
 */
export function catalogEditFields(opts: { background?: string; lighting?: boolean } = {}): Record<string, string> {
  const bg = (opts.background ?? '').replace(/^#/, '')
  const fields: Record<string, string> = {
    removeBackground: 'true',
    'background.color': /^[0-9a-f]{6}$/i.test(bg) ? bg.toUpperCase() : 'F6F1E4',
    padding: '0.1',
    outputSize: '1600x2000',
    'shadow.mode': 'ai.soft',
    'export.format': 'jpeg',
  }
  if (opts.lighting !== false) fields['lighting.mode'] = 'ai.preserve-hue-and-saturation'
  return fields
}
