/**
 * "Do we already have this?" while adding an item. Pure, so the page, the
 * server action and the tests share one definition.
 *
 * Two independent signals:
 * - photo: the difference hash (`photo-hash.ts`). Strong, but only items added
 *   through the form since migration 0006 carry one; the imported sheet items
 *   and website-adopted products have none.
 * - text: name, category, colours, material and description. Works for every
 *   item. Most stock is one-of-a-kind second-hand furniture, so a shared word
 *   alone ("כיסא") is NOT a match: the name has to agree AND at least one other
 *   detail has to agree, and any detail that clearly differs (another category,
 *   other colours, another material) rules it out.
 *
 * It only ever WARNS. A person decides, and saving is never blocked.
 */
import { normalize } from '@/lib/search/match'
import { similarPhotos } from './photo-hash'
import type { ItemStatus } from '@/lib/ops/types'

export interface DuplicateCandidate {
  id: string
  sku: string
  title: string
  category: string | null
  colors?: string | null
  material: string | null
  description: string | null
  photoUrl: string | null
  photoHash?: string | null
  status: ItemStatus
  locationId: string | null
}

export interface DuplicateQuery {
  photoHash?: string
  title?: string
  category?: string
  colors?: string
  material?: string
  description?: string
}

export type DuplicateReason = 'photo' | 'details'

export interface DuplicateMatch<T extends DuplicateCandidate = DuplicateCandidate> {
  item: T
  reasons: DuplicateReason[]
  score: number
}

/** Still in the shop's hands: a text match on a sold or given-away piece is history, not a duplicate. */
const ACTIVE: ReadonlySet<ItemStatus> = new Set(['in_storage', 'listed', 'reserved'])
export const MAX_MATCHES = 4

const STOP = new Set(['של', 'עם', 'את', 'על', 'או', 'גם', 'זוג', 'the', 'a', 'an', 'of', 'with', 'and', 'or', 'for', 'in'])
const FINAL: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }

/**
 * Words → comparable stems. Hebrew final letters are folded and a trailing
 * ה / א / ת is dropped, so כורסה, כורסא and כורסת (construct form) are one word.
 */
export function stems(text: string | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!text) return out
  for (const raw of normalize(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOP.has(raw)) continue
    let w = raw.replace(/[ךםןףץ]/g, (c) => FINAL[c]!)
    if (/^[א-ת]{4,}$/.test(w)) w = w.replace(/[התא]$/, '')
    // A one-letter prefix (ו "and", ה "the") in front of a longer word.
    if (/^[וה][א-ת]{3,}$/.test(w) && !out.has(w)) out.add(w.slice(1))
    if (w.length >= 2) out.add(w)
  }
  return out
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n
}

/** Dice coefficient: 1 = the same words, 0 = nothing in common. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  return (2 * overlap(a, b)) / (a.size + b.size)
}

/** agree / conflict / unknown for one detail (unknown when either side is empty). */
function compare(a: string | null | undefined, b: string | null | undefined): 'agree' | 'conflict' | 'unknown' {
  const x = stems(a)
  const y = stems(b)
  if (!x.size || !y.size) return 'unknown'
  return overlap(x, y) ? 'agree' : 'conflict'
}

function compareCategory(a: string | null | undefined, b: string | null | undefined): 'agree' | 'conflict' | 'unknown' {
  const x = normalize(a ?? '')
  const y = normalize(b ?? '')
  if (!x || !y || x === 'אחר' || y === 'אחר') return 'unknown'
  return x === y ? 'agree' : compare(x, y)
}

/** How much a candidate's text looks like the new item; null = not a match. */
export function detailsScore(q: DuplicateQuery, c: DuplicateCandidate): number | null {
  const qt = stems(q.title)
  const ct = stems(c.title)
  const shared = overlap(qt, ct)
  const title = similarity(qt, ct)
  if (!shared) return null
  const checks = [compareCategory(q.category, c.category), compare(q.colors, c.colors), compare(q.material, c.material)]
  if (checks.includes('conflict')) return null
  let agree = checks.filter((r) => r === 'agree').length
  if (similarity(stems(q.description), stems(c.description)) >= 0.35) agree++
  const strong = title >= 0.8 && agree >= 1
  const partial = title >= 0.5 && shared >= 2 && agree >= 2
  if (!strong && !partial) return null
  return title * 2 + agree * 0.5
}

/**
 * Items that may be the one being added, best first: photo matches (any
 * status, since the same photo is the same piece) then details matches
 * (active items only). `excludeId` = the item being edited.
 */
export function findDuplicates<T extends DuplicateCandidate>(q: DuplicateQuery, items: readonly T[], excludeId?: string): DuplicateMatch<T>[] {
  const pool = excludeId ? items.filter((i) => i.id !== excludeId) : [...items]
  const found = new Map<string, DuplicateMatch<T>>()
  if (q.photoHash) {
    for (const p of similarPhotos(q.photoHash, pool)) {
      const { distance, ...item } = p
      found.set(p.id, { item: item as unknown as T, reasons: ['photo'], score: 100 - distance })
    }
  }
  if (q.title?.trim()) {
    for (const item of pool) {
      if (!ACTIVE.has(item.status)) continue
      const s = detailsScore(q, item)
      if (s == null) continue
      const had = found.get(item.id)
      if (had) had.reasons.push('details')
      else found.set(item.id, { item, reasons: ['details'], score: s })
    }
  }
  return [...found.values()]
    .sort((a, b) => b.reasons.length - a.reasons.length || b.score - a.score || a.item.sku.localeCompare(b.item.sku))
    .slice(0, MAX_MATCHES)
}
