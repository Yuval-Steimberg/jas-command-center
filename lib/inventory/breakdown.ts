import type { Item, Movement } from '@/lib/ops/types'
import { RENEWAL_LEVELS } from '@/lib/ops/types'
import { israelDate, type DateRange } from '@/lib/time'
import { AVAILABLE } from './model'
import { ITEM_CATEGORIES, toItemCategory } from './categories'
import { RENEWAL_LABEL_HE, isRenewalLevel } from './renewal'

/**
 * Stock and sales per group (category, main colour, renewal level). Pure, and
 * the ONE definition both /inventory and /analytics read, so the two pages
 * cannot disagree about "how many armchairs did we sell".
 *
 * - Stock = units of items a customer could still buy (AVAILABLE), now.
 *   "In the shop" is the part of it whose location is the shop.
 * - Sold in the shop = in-store `sell` movements in the period minus in-store
 *   returns in the period (from a sale or from the item page), in units and in what the customer paid (after the
 *   sale discount). Online sales are counted in units only: their money is the
 *   website's revenue and is never valued here (CLAUDE.md).
 * - A sale is grouped by what the item says NOW (its category, colour, level),
 *   since that is all the log knows about it.
 * - Colour is the MAIN colour only (the first one written), so every item lands
 *   in exactly one row and the rows add up to the total.
 */

export const BREAKDOWNS = ['category', 'colour', 'renewal'] as const
export type Breakdown = (typeof BREAKDOWNS)[number]
export const BREAKDOWN_LABEL: Record<Breakdown, string> = { category: 'Category', colour: 'Main colour', renewal: 'Renewal level' }
export const isBreakdown = (v: unknown): v is Breakdown => typeof v === 'string' && (BREAKDOWNS as readonly string[]).includes(v)

export const NO_CATEGORY = 'ללא קטגוריה'
export const NO_COLOUR = 'ללא צבע'
export const NO_LEVEL = 'ללא רמה'
const UNKNOWN_ITEM = 'פריט לא נמצא'

const strip = (s: string) => s.replace(/[֑-ׇ]/g, '').replace(/[׳'"`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Hebrew name per colour family; every spelling (both genders, English, light/dark) points to it. */
const COLOUR_WORDS: [string, string[]][] = [
  ['שחור', ['שחור', 'שחורה', 'black']],
  ['לבן', ['לבן', 'לבנה', 'white', 'שמנת', 'off white', 'offwhite']],
  ['אפור', ['אפור', 'אפורה', 'grey', 'gray', 'אנטרציט', 'anthracite', 'charcoal']],
  ['חום', ['חום', 'חומה', 'brown', 'שוקולד', 'אגוז', 'walnut', 'קפה', 'וונגה', 'wenge', 'מהגוני', 'mahogany']],
  ['בז', ['בז', 'beige', 'קרם', 'cream', 'חול', 'sand', 'טאופ', 'taupe', 'אופוויט']],
  ['עץ טבעי', ['עץ טבעי', 'טבעי', 'natural', 'natural wood', 'wood', 'עץ', 'אלון', 'oak', 'אורן', 'pine', 'דבש', 'honey', 'במבוק', 'teak', 'טיק']],
  ['צהוב', ['צהוב', 'צהובה', 'yellow', 'חרדל', 'mustard']],
  ['כתום', ['כתום', 'כתומה', 'orange', 'ג׳ינג׳ר', 'גינגר', 'terracotta', 'טרקוטה', 'חלודה', 'rust']],
  ['אדום', ['אדום', 'אדומה', 'red', 'בורדו', 'bordeaux', 'burgundy', 'יין', 'wine']],
  ['ורוד', ['ורוד', 'ורודה', 'pink', 'פודרה', 'powder', 'סלמון', 'salmon', 'אפרסק', 'peach']],
  ['סגול', ['סגול', 'סגולה', 'purple', 'violet', 'לילך', 'lilac', 'חציל']],
  ['כחול', ['כחול', 'כחולה', 'blue', 'נייבי', 'navy', 'כחול נייבי', 'פטרול', 'petrol']],
  ['תכלת', ['תכלת', 'light blue', 'sky blue', 'baby blue']],
  ['טורקיז', ['טורקיז', 'turquoise', 'teal', 'אקווה', 'aqua']],
  ['ירוק', ['ירוק', 'ירוקה', 'green', 'זית', 'olive', 'מנטה', 'mint', 'בקבוק', 'מרווה', 'sage', 'אמרלד', 'emerald']],
  ['זהב', ['זהב', 'זהוב', 'זהובה', 'gold', 'golden', 'פליז', 'brass']],
  ['כסף', ['כסף', 'כסוף', 'כסופה', 'silver', 'כרום', 'chrome', 'נירוסטה', 'steel', 'פלדה']],
  ['נחושת', ['נחושת', 'copper', 'ברונזה', 'bronze']],
  ['שקוף', ['שקוף', 'שקופה', 'clear', 'transparent', 'זכוכית', 'glass']],
  ['צבעוני', ['צבעוני', 'צבעונית', 'multicolor', 'multicolour', 'multi', 'colorful', 'colourful']],
]
const COLOUR_OF = new Map<string, string>(COLOUR_WORDS.flatMap(([name, words]) => words.map((w) => [strip(w), name] as const)))
const SHADE = /^(כהה|בהיר|בהירה|עמוק|עמוקה|מט|מבריק|מבריקה|dark|light|pale|deep|matte|glossy|bright)$/
const SHADE_WORDS = /(^|\s)(כהה|בהיר|בהירה|עמוק|עמוקה|מט|מבריק|מבריקה|dark|light|pale|deep|matte|glossy|bright)(?=\s|$)/g

/** "חום כהה, שחור" → "חום"; "Light Grey" → "אפור"; an unknown colour stays as written; blank → null. */
export function mainColour(raw: string | null | undefined): string | null {
  const first = (raw ?? '').split(/[,;/|\n]| ו(?=\S)/)[0] ?? ''
  const s = strip(first)
  if (!s) return null
  if (COLOUR_OF.has(s)) return COLOUR_OF.get(s)!
  const bare = s.replace(SHADE_WORDS, ' ').replace(/\s+/g, ' ').trim()
  if (bare && COLOUR_OF.has(bare)) return COLOUR_OF.get(bare)!
  // "ירוק זית", "כחול נייבי": the first word that names a colour decides.
  for (const w of s.split(' ')) if (!SHADE.test(w) && COLOUR_OF.has(w)) return COLOUR_OF.get(w)!
  return first.replace(/\s+/g, ' ').trim()
}

export function groupOf(item: Item | undefined, by: Breakdown): string {
  if (!item) return UNKNOWN_ITEM
  if (by === 'category') return toItemCategory(item.category) ?? (item.category?.replace(/\s+/g, ' ').trim() || NO_CATEGORY)
  if (by === 'colour') return mainColour(item.colors) ?? NO_COLOUR
  const l = item.renewalLevel
  return l != null && isRenewalLevel(l) ? `${l} · ${RENEWAL_LABEL_HE[l]}` : NO_LEVEL
}

export interface BreakdownRow {
  group: string
  /** Units a customer could buy now. */
  stock: number
  /** Of `stock`, the units whose location is the shop. */
  inShop: number
  /** Sold in the shop in the period, net of units returned in the period. */
  soldInShop: number
  /** What customers paid for them (agorot, after discount, net of returns). */
  shopValueMinor: number
  /** Sold through the website in the period, net of items returned to stock: counted, never valued. */
  soldOnline: number
}

const units = (x: Movement) => Math.max(1, Number(x.detail.units) || Math.abs(x.quantityDelta) || 1)
// A return from the item page ("back to stock", also how a cancelled website order comes back) writes
// `soldChannel` / `soldPriceMinor`; a sale's own return writes `channel` / `priceMinor`. Both undo a sale.
const price = (x: Movement) => Number(x.detail.priceMinor ?? x.detail.soldPriceMinor) || 0
const channelOf = (x: Movement) => x.detail.channel ?? x.detail.soldChannel
const inPeriod = (iso: string, p: DateRange | null) => {
  if (!p) return true
  const day = israelDate(new Date(iso))
  return day >= p.from && day <= p.to
}

/**
 * Rows sorted the way a reader looks for them: renewal levels 0→4, categories
 * in the shop's list order, colours by how much stock + sales they carry.
 * `period` null = every movement given. `shopLocationIds` empty = nothing is
 * known to be in the shop, and `inShop` is 0 (the page says so).
 */
export function stockAndSales(items: Item[], movements: Movement[], by: Breakdown, period: DateRange | null, shopLocationIds: ReadonlySet<string> = new Set()): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>()
  const row = (g: string) => {
    let r = rows.get(g)
    if (!r) rows.set(g, (r = { group: g, stock: 0, inShop: 0, soldInShop: 0, shopValueMinor: 0, soldOnline: 0 }))
    return r
  }
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const i of items) {
    if (!AVAILABLE.includes(i.status)) continue
    const r = row(groupOf(i, by))
    const n = Math.max(0, i.quantity)
    r.stock += n
    if (i.locationId && shopLocationIds.has(i.locationId)) r.inShop += n
  }
  for (const x of movements) {
    if (!inPeriod(x.at, period)) continue
    const channel = channelOf(x)
    if (x.type === 'sell' && channel === 'in_store') {
      const r = row(groupOf(byId.get(x.itemId), by))
      r.soldInShop += units(x)
      r.shopValueMinor += price(x)
    } else if (x.type === 'return' && channel === 'in_store') {
      const r = row(groupOf(byId.get(x.itemId), by))
      r.soldInShop -= units(x)
      r.shopValueMinor -= price(x)
    } else if (x.type === 'sell' && channel === 'website') {
      row(groupOf(byId.get(x.itemId), by)).soldOnline += units(x)
    } else if (x.type === 'return' && channel === 'website') {
      row(groupOf(byId.get(x.itemId), by)).soldOnline -= units(x)
    }
  }
  const order = (g: string) => {
    if (by === 'renewal') {
      const n = Number(g.split(' ')[0])
      return Number.isInteger(n) && (RENEWAL_LEVELS as readonly number[]).includes(n) ? n : 99
    }
    if (by === 'category') {
      const k = (ITEM_CATEGORIES as readonly string[]).indexOf(g)
      return k >= 0 ? k : 99
    }
    return 0
  }
  const last = (g: string) => g === NO_CATEGORY || g === NO_COLOUR || g === NO_LEVEL || g === UNKNOWN_ITEM
  const weight = (r: BreakdownRow) => r.stock + r.soldInShop + r.soldOnline
  return [...rows.values()].sort((a, b) => Number(last(a.group)) - Number(last(b.group)) || order(a.group) - order(b.group) || weight(b) - weight(a) || a.group.localeCompare(b.group, 'he'))
}

export function breakdownTotals(rows: BreakdownRow[]): Omit<BreakdownRow, 'group'> {
  return rows.reduce((t, r) => ({ stock: t.stock + r.stock, inShop: t.inShop + r.inShop, soldInShop: t.soldInShop + r.soldInShop, shopValueMinor: t.shopValueMinor + r.shopValueMinor, soldOnline: t.soldOnline + r.soldOnline }), { stock: 0, inShop: 0, soldInShop: 0, shopValueMinor: 0, soldOnline: 0 })
}

/** Items sold in the period, shop and website together, net of returns: the count shop mode shows. */
export const soldUnits = (r: BreakdownRow) => r.soldInShop + r.soldOnline
