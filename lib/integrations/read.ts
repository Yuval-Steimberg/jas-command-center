import 'server-only'
import { cached, invalidate } from './cache'
import { SourceError } from './http'
import type { SourceResult } from './types'

/**
 * Run one source read and turn it into a SourceResult. Successes are cached
 * for `ttlMs`; failures are not (cached() drops rejected promises), so a
 * transient error is retried on the next view instead of sticking around.
 */
export async function readSource<T>(
  key: string,
  ttlMs: number,
  source: string,
  load: () => Promise<{ data: T; latencyMs: number }>,
): Promise<SourceResult<T>> {
  try {
    const { data, latencyMs, checkedAt } = await cached(key, ttlMs, async () => ({ ...(await load()), checkedAt: new Date().toISOString() }))
    return { state: 'ok', data, latencyMs, checkedAt, source }
  } catch (e) {
    return {
      state: 'error',
      error: e instanceof Error ? e.message : String(e),
      checkedAt: new Date().toISOString(),
      latencyMs: e instanceof SourceError ? e.latencyMs : null,
    }
  }
}

export const notConfigured = (missing: string[], note?: string): SourceResult<never> => ({ state: 'not_configured', missing, note })

/** A read a person is waiting on: never served from, or left in, the shared cache. */
export async function readOnce<T>(key: string, source: string, load: () => Promise<{ data: T; latencyMs: number }>): Promise<SourceResult<T>> {
  invalidate(key)
  try {
    return await readSource(key, 0, source, load)
  } finally {
    invalidate(key)
  }
}
