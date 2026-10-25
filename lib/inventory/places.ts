import type { LocationKind } from '@/lib/ops/types'

/**
 * The shop's four answers to "where is it?" on the add-item form. Each named
 * place is a real location row, found by its name (so a location the owner
 * already made, e.g. "מחסן יפו", is reused) and created on first use.
 * "unknown" is no location at all.
 */
export const PLACES = ['gallery', 'safe', 'warehouse', 'unknown'] as const
export type Place = (typeof PLACES)[number]
export const DEFAULT_PLACE: Place = 'gallery'

export const PLACE_LABEL_HE: Record<Place, string> = { gallery: 'חנות גלריה', safe: 'כספת', warehouse: 'מחסן', unknown: 'לא ידוע' }
export const PLACE_LABEL: Record<Place, string> = { gallery: 'Gallery shop', safe: 'Safe', warehouse: 'Warehouse', unknown: 'Unknown' }

/** The location row a named place creates when none matches. */
export const PLACE_NEW: Record<Exclude<Place, 'unknown'>, { name: string; kind: LocationKind }> = {
  gallery: { name: 'חנות גלריה', kind: 'shop' },
  safe: { name: 'כספת', kind: 'zone' },
  warehouse: { name: 'מחסן', kind: 'warehouse' },
}
const WORD: Record<Exclude<Place, 'unknown'>, RegExp> = { gallery: /גלריה|gallery/i, safe: /כספת|safe/i, warehouse: /מחסן|warehouse/i }

export function isPlace(v: unknown): v is Place {
  return typeof v === 'string' && (PLACES as readonly string[]).includes(v)
}

/** The active location a place means: the exact name, else the shortest name containing its word (the gallery: else the only shop-kind location); null = none yet. */
export function matchPlace<L extends { id: string; name: string; kind?: string; active?: boolean }>(place: Place, locations: L[]): L | null {
  if (place === 'unknown') return null
  const live = locations.filter((l) => l.active !== false)
  const exact = live.find((l) => l.name.trim() === PLACE_NEW[place].name)
  if (exact) return exact
  const hits = live.filter((l) => WORD[place].test(l.name)).sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
  if (hits[0]) return hits[0]
  // The shop itself is often just "the shop": one location of kind shop is the gallery.
  const shops = place === 'gallery' ? live.filter((l) => l.kind === 'shop') : []
  return shops.length === 1 ? shops[0]! : null
}
