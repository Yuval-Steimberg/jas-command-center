import type { Item } from '@/lib/ops/types'
import type { WebsiteProduct } from '@/lib/integrations/website/manage'

/**
 * Products created on the website itself (the phone studio at /manager/quick,
 * or the old desktop manager) are physical items too, so inventory must hold
 * them. Pure, so the rules are tested; lib/sync/run.ts applies the plan.
 *
 * - The cursor is the highest website product id already considered. Website
 *   ids are a serial, so "new" means "id above the cursor".
 * - First run: nothing is adopted. Products that existed before this sync are
 *   brought in by a person on /inventory/website, because only they know which
 *   of them are still on the shelf.
 * - A product is adopted only once it has been quiet for ADOPT_AFTER_MS. The
 *   command center's own "List on website" creates a product and links it a
 *   moment later; the wait keeps the sync from adopting that draft in between.
 *   The cursor stops below a product that is still waiting, so it is not skipped.
 * - Nothing left to sell (stock 0 or marked sold) is not adopted.
 */
export const ADOPT_AFTER_MS = 10 * 60_000
export const CC_SLUG = /^jas-\d{6}$/

/** What the website would sell right now (same rule as inventory/service websiteQuantity). */
export const websiteQty = (p: Pick<WebsiteProduct, 'quantity' | 'in_stock'>) => (p.in_stock === false ? 0 : Math.max(0, p.quantity ?? 1))

export function planProductAdoption(products: readonly WebsiteProduct[], linked: ReadonlySet<number>, cursor: number | null, now = Date.now()): { adopt: WebsiteProduct[]; cursor: number } {
  const top = products.reduce((m, p) => Math.max(m, p.id), cursor ?? 0)
  if (cursor == null) return { adopt: [], cursor: top }
  // jas-NNNNNN is the slug of a listing the command center created itself: never adopt it, even unlinked.
  const fresh = products.filter((p) => p.id > cursor && !linked.has(p.id) && websiteQty(p) > 0 && !CC_SLUG.test(p.slug)).sort((a, b) => a.id - b.id)
  const settled = (p: WebsiteProduct) => now - Date.parse(p.updated_at) >= ADOPT_AFTER_MS
  const waiting = fresh.filter((p) => !settled(p))
  return { adopt: fresh.filter(settled), cursor: waiting.length ? Math.max(cursor, waiting[0]!.id - 1) : top }
}

export type StockDrift = { item: Item; websiteQty: number | null }

/**
 * A listed item whose website stock no longer matches: someone changed it on
 * the website (the studio's "סימון כנמכר", a quantity edit) or deleted the
 * product. Run after the order sync, so a paid order has already been applied.
 * Reported, never auto-corrected: only a person knows whether it was sold in
 * the shop, given away or miscounted.
 */
export function planStockDrift(listed: readonly Item[], byId: ReadonlyMap<number, WebsiteProduct>): StockDrift[] {
  const out: StockDrift[] = []
  for (const item of listed) {
    if (item.status !== 'listed' || item.websiteProductId == null) continue
    const p = byId.get(item.websiteProductId)
    const q = p ? websiteQty(p) : null
    if (q !== item.quantity) out.push({ item, websiteQty: q })
  }
  return out
}

export function driftTask(d: StockDrift): { title: string; detail: string; dedupeKey: string } {
  const { item, websiteQty: q } = d
  const title =
    q == null ? `Website product #${item.websiteProductId} of ${item.sku} was deleted on the website`
      : q === 0 ? `${item.sku} was marked sold on the website: record what happened to it`
        : `${item.sku}: website stock is ${q}, inventory says ${item.quantity}`
  const detail =
    q == null ? `${item.title}. Return the item to storage here (it is no longer for sale online), or list it again.`
      : q === 0 ? `${item.title}. No website order seen so far sold it (an order paid in the last few minutes shows on the next sync; then close this). If it was sold in the shop, take it off sale and record a shop sale; if it is still here, put the stock back on the website.`
        : `${item.title}. Count it, then correct the quantity here or on the website.`
  return { title, detail, dedupeKey: `website_stock:${item.id}:${q ?? 'deleted'}:${item.version}` }
}
