import type { LocationKind } from '@/lib/ops/types'

/**
 * The add-item form's answer to "where is it?" (owner, 2026-10-25): חנות by
 * default, מחסן, בית מלאכה, or אחר with a name typed in. Each one is a real
 * location row, found by its name (so a location the owner already made, e.g.
 * "מחסן יפו", is reused) and created on first use.
 */
export const PLACES = ['shop', 'warehouse', 'workshop', 'other'] as const
export type Place = (typeof PLACES)[number]
export type NamedPlace = Exclude<Place, 'other'>
export const DEFAULT_PLACE: Place = 'shop'

export const PLACE_LABEL_HE: Record<Place, string> = { shop: 'חנות', warehouse: 'מחסן', workshop: 'בית מלאכה', other: 'אחר' }
export const PLACE_LABEL: Record<Place, string> = { shop: 'Shop', warehouse: 'Warehouse', workshop: 'Workshop', other: 'Other' }

/** The location row a named place creates when none matches. */
export const PLACE_NEW: Record<NamedPlace, { name: string; kind: LocationKind }> = {
  shop: { name: 'חנות', kind: 'shop' },
  warehouse: { name: 'מחסן', kind: 'warehouse' },
  workshop: { name: 'בית מלאכה', kind: 'zone' },
}
const WORD: Record<NamedPlace, RegExp> = { shop: /חנות|גלריה|shop|gallery/i, warehouse: /מחסן|warehouse/i, workshop: /בית מלאכה|סדנה|workshop/i }

export function isPlace(v: unknown): v is Place {
  return typeof v === 'string' && (PLACES as readonly string[]).includes(v)
}

type Loc = { id: string; name: string; kind?: string; active?: boolean }
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The active location a named place means: the exact name, else the shortest name containing its word (the shop: else the only shop-kind location); null = none yet. */
export function matchPlace<L extends Loc>(place: NamedPlace, locations: L[]): L | null {
  const live = locations.filter((l) => l.active !== false)
  const exact = live.find((l) => clean(l.name) === PLACE_NEW[place].name)
  if (exact) return exact
  const hits = live.filter((l) => WORD[place].test(l.name)).sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
  if (hits[0]) return hits[0]
  const shops = place === 'shop' ? live.filter((l) => l.kind === 'shop') : []
  return shops.length === 1 ? shops[0]! : null
}

/** "אחר": an active location with exactly this name (spacing and case aside), or null = create it. */
export function matchNamed<L extends Loc>(name: string, locations: L[]): L | null {
  const want = clean(name).toLowerCase()
  if (!want) return null
  return locations.find((l) => l.active !== false && clean(l.name).toLowerCase() === want) ?? null
}
