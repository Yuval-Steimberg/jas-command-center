import 'server-only'

/**
 * Short-lived, process-wide cache for source reads, so a dashboard with ten
 * cards and three people looking at it does not fan out into thirty identical
 * requests. Kept on globalThis: Next.js bundles route handlers, actions and
 * pages separately, and a module-level Map would be one cache per bundle
 * (the same trap as gift_card_system gotcha #13).
 *
 * In-flight requests are shared too, so concurrent callers never duplicate a fetch.
 */
type Entry = { at: number; value: Promise<unknown> }
const g = globalThis as unknown as { __ccSourceCache?: Map<string, Entry> }
const store = () => (g.__ccSourceCache ??= new Map())

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const m = store()
  const hit = m.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
  const value = load()
  m.set(key, { at: Date.now(), value })
  // Never cache a rejection: the next caller should try again.
  value.catch(() => {
    if (m.get(key)?.value === value) m.delete(key)
  })
  return value
}

export function invalidate(prefix: string) {
  for (const k of store().keys()) if (k.startsWith(prefix)) store().delete(k)
}
