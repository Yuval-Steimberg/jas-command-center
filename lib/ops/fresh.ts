import { invalidate } from '@/lib/integrations/cache'

/**
 * The command center's own records are read through a short process cache
 * (the inventory/CRM snapshot behind the overview, the top bar and the
 * inventory page). Any write through a store drops it, so the person who
 * changed something sees the change on the next page. A method that is not a
 * known read counts as a write: a new method can only make the cache emptier.
 */
export const OPS_CACHE = 'ops:'
const READ = /^(list|get|find|movements$|photoHashes$|recentMovements$|ruleSettings$|lines|paymentsOf$|openLines$|itemsFrom$|check)/

export function dropsCacheOnWrite<T extends object>(store: T): T {
  return new Proxy(store, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver) as unknown
      if (typeof v !== 'function' || typeof key !== 'string' || READ.test(key)) return v
      return (...args: unknown[]) => {
        const out = (v as (...a: unknown[]) => unknown).apply(target, args)
        // Dropped before and after: a read racing the write cannot re-fill the cache with the old rows.
        invalidate(OPS_CACHE)
        return out instanceof Promise ? out.finally(() => invalidate(OPS_CACHE)) : out
      }
    },
  })
}
