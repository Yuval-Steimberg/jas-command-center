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

export const BREAKDOWNS = ['category', 'colour', 'renewal', 'price'] as const
export type Breakdown = (typeof BREAKDOWNS)[number]
export const BREAKDOWN_LABEL: Record<Breakdown, string> = { category: 'Category', colour: 'Main colour', renewal: 'Renewal level', price: 'Price range' }
export const isBreakdown = (v: unknown): v is Breakdown => typeof v === 'string' && (BREAKDOWNS as readonly string[]).includes(v)

export const NO_CATEGORY = 'ללא קטגוריה'
export const NO_COLOUR = 'ללא צבע'
export const NO_LEVEL = 'ללא רמה'
const UNKNOWN_ITEM = 'פריט לא נמצא'
export const NO_PRICE = 'ללא מחיר'

/**
 * Price ranges, per UNIT, in agorot (owner's ranges, 2026-11-02). Upper bound inclusive:
 * ₪100.00 is "up to 100", ₪100.50 is "101–500". Kept in this order on every screen (a scale, never sorted by count).
 * - Stock is banded by the item's asking price (`priceMinor`) now.
 * - A shop sale is banded by what the customer paid per unit, after the sale discount (the movement's `priceMinor` / units),
 *   so an item listed at ₪120 and sold for ₪90 is a sale "up to 100". A website sale by its order line per unit.
 */
export const PRICE_BANDS = [
  { label: 'עד 100 ₪', maxMinor: 10_000 },
  { label: '101–500 ₪', maxMinor: 50_000 },
  { label: '501–1,000 ₪', maxMinor: 100_000 },
  { label: 'מעל 1,000 ₪', maxMinor: Infinity },
] as const
export const PRICE_BAND_LABELS: readonly string[] = PRICE_BANDS.map((b) => b.label)
export function priceBand(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor) || minor <= 0) return NO_PRICE
  return PRICE_BANDS.find((b) => minor <= b.maxMinor)!.label
}

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
  if (by === 'price') return priceBand(item.priceMinor)
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
/** Per-unit price a sale (or its return) was made at, or null when the movement does not say. */
function unitPaid(x: Movement): number | null {
  const total = Number(x.detail.priceMinor ?? x.detail.soldPriceMinor ?? x.detail.lineTotalMinor)
  return Number.isFinite(total) && total > 0 ? Math.round(total / units(x)) : null
}
/** The group a sale/return movement counts in: for price, what was paid per unit (else the item's price now). */
function movementGroup(x: Movement, item: Item | undefined, by: Breakdown): string {
  if (by !== 'price') return groupOf(item, by)
  const paid = unitPaid(x)
  if (paid != null) return priceBand(paid)
  return item ? priceBand(item.soldPriceMinor != null ? Math.round(item.soldPriceMinor / Math.max(1, units(x))) : item.priceMinor) : UNKNOWN_ITEM
}
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
    if (x.type !== 'sell' && x.type !== 'return') continue
    if (channel !== 'in_store' && channel !== 'website') continue
    const r = row(movementGroup(x, byId.get(x.itemId), by))
    const sign = x.type === 'sell' ? 1 : -1
    if (channel === 'in_store') {
      r.soldInShop += sign * units(x)
      r.shopValueMinor += sign * price(x)
    } else r.soldOnline += sign * units(x)
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
    if (by === 'price') {
      const k = PRICE_BAND_LABELS.indexOf(g)
      return k >= 0 ? k : 99
    }
    return 0
  }
  const last = (g: string) => g === NO_CATEGORY || g === NO_COLOUR || g === NO_LEVEL || g === NO_PRICE || g === UNKNOWN_ITEM
  const weight = (r: BreakdownRow) => r.stock + r.soldInShop + r.soldOnline
  return [...rows.values()].sort((a, b) => Number(last(a.group)) - Number(last(b.group)) || order(a.group) - order(b.group) || weight(b) - weight(a) || a.group.localeCompare(b.group, 'he'))
}

export function breakdownTotals(rows: BreakdownRow[]): Omit<BreakdownRow, 'group'> {
  return rows.reduce((t, r) => ({ stock: t.stock + r.stock, inShop: t.inShop + r.inShop, soldInShop: t.soldInShop + r.soldInShop, shopValueMinor: t.shopValueMinor + r.shopValueMinor, soldOnline: t.soldOnline + r.soldOnline }), { stock: 0, inShop: 0, soldInShop: 0, shopValueMinor: 0, soldOnline: 0 })
}

/** Items sold in the period, shop and website together, net of returns: the count shop mode shows. */
export const soldUnits = (r: BreakdownRow) => r.soldInShop + r.soldOnline

export interface BandItem {
  id: string
  sku: string
  title: string
  /** Units in stock now, or sold in the period net of returns. */
  units: number
  /** Stock: the asking price per unit. Sales: what was paid per unit, after discount (null for a website sale with no line total). */
  unitPriceMinor: number | null
}
export interface PriceBandView {
  band: string
  units: number
  /** Share of all units in this view, whole percent; the ranges add up to 100 (0 everywhere when there are none). */
  percent: number
  items: BandItem[]
}

/**
 * Price ranges with the items in each: "what share of what we have / sold is up to ₪100, and which items".
 * Same rules as `stockAndSales(…, 'price', …)`, so a range's units always equal that row's stock or soldUnits.
 * Every range is returned, empty ones too (a scale reads wrong with gaps); "no price" only when it has units.
 */
export function priceBands(items: Item[], movements: Movement[], view: 'stock' | 'sales', period: DateRange | null): PriceBandView[] {
  const bands = new Map<string, Map<string, BandItem>>()
  const add = (band: string, it: Item | undefined, id: string, n: number, unitPrice: number | null) => {
    let m = bands.get(band)
    if (!m) bands.set(band, (m = new Map()))
    const e = m.get(id) ?? { id, sku: it?.sku ?? '', title: it?.title ?? UNKNOWN_ITEM, units: 0, unitPriceMinor: unitPrice }
    e.units += n
    if (e.unitPriceMinor == null) e.unitPriceMinor = unitPrice
    m.set(id, e)
  }
  if (view === 'stock') {
    for (const i of items) if (AVAILABLE.includes(i.status) && i.quantity > 0) add(priceBand(i.priceMinor), i, i.id, i.quantity, i.priceMinor ?? null)
  } else {
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const x of movements) {
      if (!inPeriod(x.at, period) || (x.type !== 'sell' && x.type !== 'return')) continue
      const channel = channelOf(x)
      if (channel !== 'in_store' && channel !== 'website') continue
      const it = byId.get(x.itemId)
      const band = movementGroup(x, it, 'price')
      // One entry per item and price range: a return lands on the range its sale was made in, because it carries the same price.
      add(band, it, x.itemId, (x.type === 'sell' ? 1 : -1) * units(x), x.type === 'sell' ? unitPaid(x) : null)
    }
  }
  const labels = [...PRICE_BAND_LABELS, ...[...bands.keys()].filter((b) => !PRICE_BAND_LABELS.includes(b)).sort((a, b) => Number(a === NO_PRICE) - Number(b === NO_PRICE) || a.localeCompare(b, 'he'))]
  const rows = labels.map((band) => {
    const list = [...(bands.get(band)?.values() ?? [])].filter((e) => e.units > 0)
      .sort((a, b) => (b.unitPriceMinor ?? 0) - (a.unitPriceMinor ?? 0) || a.title.localeCompare(b.title, 'he'))
    return { band, units: list.reduce((a, e) => a + e.units, 0), items: list }
  }).filter((r) => PRICE_BAND_LABELS.includes(r.band) || r.units > 0)
  const total = rows.reduce((a, r) => a + r.units, 0)
  // Whole percents that add up to exactly 100 (largest remainder), so the screen never shows 101%.
  const shares = rows.map((r, k) => {
    const raw = total ? (r.units / total) * 100 : 0
    return { k, raw, pct: Math.floor(raw) }
  })
  let left = total ? 100 - shares.reduce((a, x) => a + x.pct, 0) : 0
  for (const x of [...shares].sort((a, b) => b.raw - b.pct - (a.raw - a.pct) || a.k - b.k)) if (left-- > 0) x.pct++
  return rows.map((r, k) => ({ ...r, percent: shares[k]!.pct }))
}
