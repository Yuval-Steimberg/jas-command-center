/**
 * Fixed-window attempt limiter (10 per 15 min per key). Process-local: on
 * serverless it limits per instance, which slows guessing but is not a wall —
 * Supabase Auth applies its own server-side rate limits behind it.
 */
const WINDOW_MS = 15 * 60_000
const MAX = 10
const g = globalThis as unknown as { __ccAttempts?: Map<string, { n: number; t: number }> }
const m = () => (g.__ccAttempts ??= new Map())

export function allowAttempt(key: string, now = Date.now()): boolean {
  const e = m().get(key)
  if (!e || now - e.t > WINDOW_MS) {
    m().set(key, { n: 1, t: now })
    return true
  }
  e.n++
  return e.n <= MAX
}

export function clearAttempts(key: string) {
  m().delete(key)
}
