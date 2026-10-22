import type { Product } from '@/lib/auth/rbac'

/**
 * The outcome of one read from a source system. There is deliberately no
 * "empty success": a source that is not configured, or that failed, says so —
 * a dashboard must never render a failure as a zero.
 */
export type SourceResult<T> =
  | { state: 'not_configured'; missing: string[]; note?: string }
  | { state: 'error'; error: string; checkedAt: string; latencyMs: number | null }
  | { state: 'ok'; data: T; checkedAt: string; latencyMs: number; source: string }

/**
 * `unknown` = we could not check (not configured). A service is never
 * `operational` unless a live probe of the running service succeeded — a
 * reachable GitHub repository says nothing about production.
 */
export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unknown'

export interface HealthCheck {
  name: string
  status: HealthStatus
  detail: string
  checkedAt: string | null
  latencyMs: number | null
}

export interface ProductHealth {
  product: Product
  status: HealthStatus
  checks: HealthCheck[]
}

export interface Capability {
  id: string
  label: string
  kind: 'read' | 'write'
  /** Matches the inventory classification in docs/INTEGRATION_INVENTORY.md. */
  status: 'available' | 'needs_credentials' | 'needs_source_change' | 'unsupported' | 'not_built'
  note?: string
}

export interface IntegrationAdapter {
  product: Product
  name: string
  description: string
  /** Env vars this adapter needs, and which are missing right now. */
  config(): { required: string[]; missing: string[]; optional: string[] }
  capabilities(): Capability[]
  health(): Promise<ProductHealth>
}

/** Worst status wins; `unknown` only when nothing could be checked at all. */
export function rollup(checks: HealthCheck[]): HealthStatus {
  const known = checks.filter((c) => c.status !== 'unknown')
  if (!known.length) return 'unknown'
  if (known.some((c) => c.status === 'down')) return known.every((c) => c.status === 'down') ? 'down' : 'degraded'
  if (known.some((c) => c.status === 'degraded')) return 'degraded'
  // Some checks could not run: we can't call the whole product operational.
  if (known.length < checks.length) return 'degraded'
  return 'operational'
}
