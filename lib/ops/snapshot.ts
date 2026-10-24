import 'server-only'
import * as React from 'react'
import { getOpsStore, OpsSetupError } from '@/lib/ops'
import type { SourceResult } from '@/lib/integrations/types'
import { summarise, type OpsSnapshot } from './summary'
import { getSupplierStore } from '@/lib/suppliers/store'
import { OPEN_PO } from '@/lib/suppliers/model'
import { cached } from '@/lib/integrations/cache'
import { OPS_CACHE } from './fresh'

export type { OpsSnapshot }

const SOURCE = 'Command center database (inventory, customers, tasks)'

/**
 * Current state of the command center's own modules, for the overview, the
 * attention list, the assistant and analytics. Built by the pure summarise()
 * from the rows themselves. "Not set up" (0003 not run) is reported as such,
 * never as zeros.
 */
// React's per-request cache exists only in the server build; plain Node (tests, scripts) calls through.
const cache: <T extends (...a: never[]) => unknown>(fn: T) => T = (React as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn)

/** Seconds a snapshot is reused across requests; any write through a store drops it at once (fresh.ts). */
export const SNAPSHOT_TTL_MS = 20_000

export const getOpsSnapshot = cache(async (): Promise<SourceResult<OpsSnapshot>> => {
  const t0 = Date.now()
  try {
    const { data, checkedAt } = await cached(`${OPS_CACHE}snapshot`, SNAPSHOT_TTL_MS, readSnapshot)
    return { state: 'ok', data, checkedAt, latencyMs: Date.now() - t0, source: SOURCE }
  } catch (e) {
    if (e instanceof OpsSetupError) return { state: 'not_configured', missing: ['migration 0003_crm_inventory.sql'], note: e.message }
    return { state: 'error', error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), latencyMs: Date.now() - t0 }
  }
})

async function readSnapshot(): Promise<{ data: OpsSnapshot; checkedAt: string }> {
  const store = getOpsStore()
  // One round trip: every list at once. Purchasing is migration 0004: until it runs, the rest still loads and purchasing says "not set up".
  const [items, deals, tasks, deliveries, rules, contacts, orders] = await Promise.all([
    store.listItems({ limit: 5000 }),
    store.listDeals({ limit: 5000 }),
    store.listTasks({ status: 'open', limit: 5000 }),
    store.listDeliveries({ statuses: ['planned', 'out'], limit: 2000 }),
    store.ruleSettings(),
    store.listContacts({ limit: 5000 }),
    getSupplierStore().listOrders({ statuses: OPEN_PO, limit: 2000 }).catch((e) => {
      if (e instanceof OpsSetupError) return null
      throw e
    }),
  ])
  return { data: summarise({ items, deals, tasks, deliveries, contacts, rules, orders }), checkedAt: new Date().toISOString() }
}
