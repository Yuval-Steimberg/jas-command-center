import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import { OpsSetupError } from '@/lib/ops/store'
import { fail } from '@/lib/ops/supabase'
import type { Use } from './today'

/**
 * Which portal buttons each person uses (migration 0018), so their most used
 * ones come first and link management can see what nobody opens. One counter
 * per person and button; nothing else is kept (no times of day, no history).
 * A failure here never stops anyone from opening a link: callers catch it.
 */
export interface UsageStore {
  record(profileId: string, actionId: string): Promise<void>
  forProfile(profileId: string): Promise<Use[]>
  /** Total uses per button across everyone, for link management. */
  totals(): Promise<Map<string, number>>
}

const setup = () => new OpsSetupError('0018_portal_usage.sql', 'Portal button usage')

export function memoryUsageStore(rows: Map<string, Use & { profileId: string }>, now = () => new Date().toISOString()): UsageStore {
  return {
    async record(profileId, actionId) {
      const k = `${profileId}|${actionId}`
      const r = rows.get(k)
      rows.set(k, { profileId, actionId, uses: (r?.uses ?? 0) + 1, lastUsedAt: now() })
    },
    async forProfile(profileId) {
      return [...rows.values()].filter((r) => r.profileId === profileId).map(({ actionId, uses, lastUsedAt }) => ({ actionId, uses, lastUsedAt }))
    },
    async totals() {
      const t = new Map<string, number>()
      for (const r of rows.values()) t.set(r.actionId, (t.get(r.actionId) ?? 0) + r.uses)
      return t
    },
  }
}

const g = globalThis as unknown as { __ccPortalUsage?: Map<string, Use & { profileId: string }> }

export function getUsageStore(): UsageStore {
  if (authMode().kind !== 'supabase') return memoryUsageStore((g.__ccPortalUsage ??= new Map()))
  const db = supabaseAdmin()
  return {
    async record(profileId, actionId) {
      // One atomic increment in SQL (cc_portal_use), so two taps at once both count.
      const { error } = await db.rpc('cc_portal_use', { p_profile: profileId, p_action: actionId })
      if (error) fail(error, setup)
    },
    async forProfile(profileId) {
      const { data, error } = await db.from('cc_portal_usage').select('action_id, uses, last_used_at').eq('profile_id', profileId)
      if (error) fail(error, setup)
      return (data ?? []).map((r: { action_id: string; uses: number; last_used_at: string }) => ({ actionId: r.action_id, uses: r.uses, lastUsedAt: r.last_used_at }))
    },
    async totals() {
      const t = new Map<string, number>()
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('cc_portal_usage').select('action_id, uses').range(from, from + 999)
        if (error) fail(error, setup)
        for (const r of (data ?? []) as { action_id: string; uses: number }[]) t.set(r.action_id, (t.get(r.action_id) ?? 0) + r.uses)
        if (!data || data.length < 1000) break
      }
      return t
    },
  }
}
