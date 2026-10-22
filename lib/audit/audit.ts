import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import type { CurrentUser } from '@/lib/auth/session'

export type AuditOutcome = 'requested' | 'succeeded' | 'failed' | 'denied'

export interface AuditEntry {
  id: string
  at: string
  actorId: string
  actorEmail: string
  actorRole: string
  /** 'user' for a person clicking, 'assistant' for an AI-initiated action. */
  via: 'user' | 'assistant' | 'system'
  action: string
  product: string | null
  target: string | null
  outcome: AuditOutcome
  detail: Record<string, unknown>
}

// Dev mode only (no database). Production always writes to cc_audit_log.
const g = globalThis as unknown as { __ccDevAudit?: AuditEntry[] }

/**
 * Append one audit row. Throws when the write fails: an action whose audit
 * record cannot be written must not be reported as done. Callers write
 * `requested` BEFORE calling a source system and the outcome AFTER.
 */
export async function audit(
  user: Pick<CurrentUser, 'id' | 'email' | 'role'>,
  entry: Omit<AuditEntry, 'id' | 'at' | 'actorId' | 'actorEmail' | 'actorRole' | 'via'> & { via?: AuditEntry['via'] },
): Promise<void> {
  const row: AuditEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    via: entry.via ?? 'user',
    action: entry.action,
    product: entry.product,
    target: entry.target,
    outcome: entry.outcome,
    detail: redact(entry.detail),
  }
  if (authMode().kind === 'dev') {
    ;(g.__ccDevAudit ??= []).unshift(row)
    g.__ccDevAudit.length = Math.min(g.__ccDevAudit.length, 500)
    return
  }
  const { error } = await supabaseAdmin().from('cc_audit_log').insert({
    id: row.id,
    at: row.at,
    actor_profile_id: row.actorId,
    actor_email: row.actorEmail,
    actor_role: row.actorRole,
    via: row.via,
    action: row.action,
    product: row.product,
    target: row.target,
    outcome: row.outcome,
    detail: row.detail,
  })
  if (error) throw new Error(`Audit write failed: ${error.message}`)
}

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  if (authMode().kind === 'dev') return (g.__ccDevAudit ?? []).slice(0, limit)
  const { data, error } = await supabaseAdmin().from('cc_audit_log').select('*').order('at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id,
    at: r.at,
    actorId: r.actor_profile_id,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    via: r.via,
    action: r.action,
    product: r.product,
    target: r.target,
    outcome: r.outcome,
    detail: r.detail ?? {},
  }))
}

const SECRETISH = /(token|secret|password|key|authorization|cookie)/i
export function redact(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(detail ?? {})) out[k] = SECRETISH.test(k) ? '[redacted]' : v
  return out
}
