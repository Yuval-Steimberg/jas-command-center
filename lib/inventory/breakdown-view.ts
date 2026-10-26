import 'server-only'
import { getOpsStore } from '@/lib/ops'
import { addDays, israelDate } from '@/lib/time'
import { matchPlace } from './places'
import { isBreakdown, stockAndSales, type Breakdown, type BreakdownRow } from './breakdown'

export const BREAKDOWN_DAYS = ['30', '90', '365', 'all'] as const
export type BreakdownDays = (typeof BREAKDOWN_DAYS)[number]

export interface BreakdownView {
  rows: BreakdownRow[]
  by: Breakdown
  days: BreakdownDays
  shopKnown: boolean
  capped: boolean
}

export function breakdownParams(sp: { by?: string; days?: string } | undefined): { by: Breakdown; days: BreakdownDays } {
  return {
    by: isBreakdown(sp?.by) ? sp.by : 'category',
    days: (BREAKDOWN_DAYS as readonly string[]).includes(sp?.days ?? '') ? (sp!.days as BreakdownDays) : '30',
  }
}

/** The reads behind the "stock and sales by group" card on /inventory and /shop/items: every item, the period's movements, the shop location. */
export async function loadBreakdown(by: Breakdown, days: BreakdownDays): Promise<BreakdownView> {
  const today = israelDate()
  const period = days === 'all' ? null : { from: addDays(today, -(Number(days) - 1)), to: today }
  const store = getOpsStore()
  const [items, movements, locations] = await Promise.all([
    store.listItems({ limit: 5000 }),
    store.recentMovements(5000, period ? `${period.from}T00:00:00+02:00` : undefined),
    store.listLocations(),
  ])
  const shop = matchPlace('shop', locations)
  return {
    rows: stockAndSales(items, movements, by, period, new Set(shop ? [shop.id] : [])),
    by,
    days,
    shopKnown: !!shop,
    capped: items.length >= 1000 || movements.length >= 1000,
  }
}
