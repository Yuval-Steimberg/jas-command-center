import 'server-only'
import type { Product } from '@/lib/auth/rbac'
import type { IntegrationAdapter, ProductHealth } from './types'
import { websiteAdapter } from './website/adapter'
import { giftCardsAdapter } from './gift-cards/adapter'
import { furnitureAdapter } from './furniture/adapter'
import { designAgentAdapter } from './design-agent/adapter'
import { mapAdapter } from './map/adapter'

/**
 * Every connected product, in navigation order. Adding a product = writing an
 * adapter (see docs/ADDING_AN_INTEGRATION.md) and listing it here.
 */
export const ADAPTERS: readonly IntegrationAdapter[] = [websiteAdapter, giftCardsAdapter, furnitureAdapter, designAgentAdapter, mapAdapter]

export function adapterFor(product: Product): IntegrationAdapter {
  const a = ADAPTERS.find((x) => x.product === product)
  if (!a) throw new Error(`No adapter for ${product}`)
  return a
}

/**
 * Health for every product, in parallel. A product whose check throws is
 * reported as down — it never takes the other products with it.
 */
export async function allHealth(): Promise<ProductHealth[]> {
  const results = await Promise.allSettled(ADAPTERS.map((a) => a.health()))
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          product: ADAPTERS[i]!.product,
          status: 'down',
          checks: [{ name: 'Health check', status: 'down', detail: r.reason instanceof Error ? r.reason.message : String(r.reason), checkedAt: new Date().toISOString(), latencyMs: null }],
        },
  )
}
