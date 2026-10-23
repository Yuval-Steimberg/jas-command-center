import type { SourceResult } from '@/lib/integrations/types'

/**
 * One line of the production self-check. `detail` is counts and states only:
 * the result is printed in a GitHub Actions log, so it must never carry a
 * name, an email address, a code, a token or a URL with a key in it.
 */
export interface Probe {
  section: string
  name: string
  state: 'ok' | 'not_configured' | 'error'
  latencyMs: number | null
  detail: string
}

const cut = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s)

/** Turns a source read into a probe; `describe` sees only successful data. */
export function fromSource<T>(section: string, name: string, r: SourceResult<T>, describe: (data: T) => string): Probe {
  if (r.state === 'ok') return { section, name, state: 'ok', latencyMs: r.latencyMs, detail: cut(describe(r.data)) }
  if (r.state === 'not_configured') return { section, name, state: 'not_configured', latencyMs: null, detail: `needs ${r.missing.join(', ')}` }
  return { section, name, state: 'error', latencyMs: r.latencyMs, detail: cut(r.error) }
}

/** A probe whose read throws instead of returning a SourceResult. */
export async function fromCall(section: string, name: string, run: () => Promise<string>): Promise<Probe> {
  const started = Date.now()
  try {
    const detail = await run()
    return { section, name, state: 'ok', latencyMs: Date.now() - started, detail: cut(detail) }
  } catch (e) {
    return { section, name, state: 'error', latencyMs: Date.now() - started, detail: cut(e instanceof Error ? e.message : String(e)) }
  }
}

export interface SelfCheckSummary {
  ok: boolean
  counts: { ok: number; not_configured: number; error: number }
  failing: string[]
}

/** `ok` = nothing errored. Not configured is reported, never counted as a pass or a failure. */
export function summarise(probes: readonly Probe[]): SelfCheckSummary {
  const counts = { ok: 0, not_configured: 0, error: 0 }
  for (const p of probes) counts[p.state]++
  return { ok: counts.error === 0, counts, failing: probes.filter((p) => p.state === 'error').map((p) => `${p.section}: ${p.name}`) }
}
