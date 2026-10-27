import 'server-only'
import { getOpsStore } from '@/lib/ops'
import { addDays, israelDate, type DateRange } from '@/lib/time'
import { matchPlace } from './places'
import { BREAKDOWNS, isBreakdown, stockAndSales, type Breakdown, type BreakdownRow } from './breakdown'

export const BREAKDOWN_DAYS = ['30', '90', '365', 'all'] as const
export type BreakdownDays = (typeof BREAKDOWN_DAYS)[number]
export const isBreakdownDays = (v: unknown): v is BreakdownDays => typeof v === 'string' && (BREAKDOWN_DAYS as readonly string[]).includes(v)

export interface BreakdownView {
  rows: BreakdownRow[]
  by: Breakdown
  days: BreakdownDays
  shopKnown: boolean
  capped: boolean
  /** False = the reader may not see sales (`inventory:reports`): every sales field is 0 and was never read. */
  sales: boolean
}

export function breakdownParams(sp: { by?: string; days?: string } | undefined): { by: Breakdown; days: BreakdownDays } {
  return {
    by: isBreakdown(sp?.by) ? sp.by : 'category',
    days: isBreakdownDays(sp?.days) ? sp.days : '30',
  }
}

/**
 * Every item, the period's movements (only when sales may be seen: otherwise
 * none are read, so no sales figure can leave the server) and the shop location.
 */
async function readSources(days: BreakdownDays, sales: boolean) {
  const today = israelDate()
  const period: DateRange | null = days === 'all' ? null : { from: addDays(today, -(Number(days) - 1)), to: today }
  const store = getOpsStore()
  const [items, movements, locations] = await Promise.all([
    store.listItems({ limit: 5000 }),
    sales ? store.recentMovements(5000, period ? `${period.from}T00:00:00+02:00` : undefined) : Promise.resolve([]),
    store.listLocations(),
  ])
  const shop = matchPlace('shop', locations)
  return { items, movements, period, shopIds: new Set(shop ? [shop.id] : []), shopKnown: !!shop, capped: items.length >= 1000 || movements.length >= 1000 }
}

/** The "stock and sales by group" card on /inventory: one grouping at a time. */
export async function loadBreakdown(by: Breakdown, days: BreakdownDays, { sales }: { sales: boolean }): Promise<BreakdownView> {
  const r = await readSources(days, sales)
  return { rows: stockAndSales(r.items, r.movements, by, r.period, r.shopIds), by, days, shopKnown: r.shopKnown, capped: r.capped, sales }
}

/** Shop mode's home: all three groupings from one read. */
export async function loadAllBreakdowns(days: BreakdownDays, { sales }: { sales: boolean }): Promise<{ rows: Record<Breakdown, BreakdownRow[]>; days: BreakdownDays; capped: boolean; sales: boolean }> {
  const r = await readSources(days, sales)
  const rows = Object.fromEntries(BREAKDOWNS.map((b) => [b, stockAndSales(r.items, r.movements, b, r.period, r.shopIds)])) as Record<Breakdown, BreakdownRow[]>
  return { rows, days, capped: r.capped, sales }
}
