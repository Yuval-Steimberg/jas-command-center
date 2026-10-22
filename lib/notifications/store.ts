import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import type { Alert, Severity } from '@/lib/alerts'
import type { Product } from '@/lib/auth/rbac'
import { planSync, type Observed, type OpenNotification } from './plan'

export interface NotificationRow {
  id: string
  alertKey: string
  product: Product
  severity: Severity
  title: string
  detail: string
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
}

/**
 * Persistence for the attention list (cc_notifications + cc_notification_reads):
 * when each alert started, when it ended, and who has seen it. The alerts
 * themselves are still DERIVED live from the sources; this only remembers them.
 * Dev mode (no database) keeps the same shape in memory.
 */
interface Store {
  listOpen(): Promise<(OpenNotification & NotificationRow)[]>
  raise(a: Alert, now: string): Promise<void>
  touch(id: string, a: Alert, now: string): Promise<void>
  resolve(ids: string[], now: string): Promise<void>
  history(limit: number): Promise<NotificationRow[]>
  readIds(profileId: string, ids: string[]): Promise<Set<string>>
  markRead(profileId: string, ids: string[], now: string): Promise<void>
}

const g = globalThis as unknown as { __ccDevNotifications?: { rows: NotificationRow[]; reads: Set<string> }; __ccNotificationSyncAt?: number }

const memory: Store = {
  async listOpen() {
    return mem().rows.filter((r) => !r.resolvedAt)
  },
  async raise(a, now) {
    mem().rows.unshift({ id: crypto.randomUUID(), alertKey: a.id, product: a.product, severity: a.severity, title: a.title, detail: a.detail, firstSeenAt: now, lastSeenAt: now, resolvedAt: null })
  },
  async touch(id, a, now) {
    const r = mem().rows.find((x) => x.id === id)
    if (r) Object.assign(r, { title: a.title, detail: a.detail, severity: a.severity, lastSeenAt: now })
  },
  async resolve(ids, now) {
    for (const r of mem().rows) if (ids.includes(r.id)) r.resolvedAt = now
  },
  async history(limit) {
    return mem().rows.slice(0, limit)
  },
  async readIds(profileId, ids) {
    return new Set(ids.filter((id) => mem().reads.has(`${profileId}:${id}`)))
  },
  async markRead(profileId, ids) {
    for (const id of ids) mem().reads.add(`${profileId}:${id}`)
  },
}
const mem = () => (g.__ccDevNotifications ??= { rows: [], reads: new Set() })

const fromDb = (r: Record<string, unknown>): NotificationRow & OpenNotification => ({
  id: r.id as string,
  alertKey: r.alert_key as string,
  product: r.product as Product,
  severity: r.severity as Severity,
  title: r.title as string,
  detail: (r.detail as string) ?? '',
  firstSeenAt: r.first_seen_at as string,
  lastSeenAt: r.last_seen_at as string,
  resolvedAt: (r.resolved_at as string | null) ?? null,
})

const db: Store = {
  async listOpen() {
    const { data, error } = await supabaseAdmin().from('cc_notifications').select('*').is('resolved_at', null)
    if (error) throw new Error(`notifications: ${error.message}`)
    return (data ?? []).map(fromDb)
  },
  async raise(a, now) {
    const { error } = await supabaseAdmin()
      .from('cc_notifications')
      .insert({ alert_key: a.id, product: a.product, severity: a.severity, title: a.title, detail: a.detail, first_seen_at: now, last_seen_at: now })
    // 23505: another request raised the same alert a moment ago (one open row per key) — that row stands.
    if (error && error.code !== '23505') throw new Error(`notifications: ${error.message}`)
  },
  async touch(id, a, now) {
    const { error } = await supabaseAdmin().from('cc_notifications').update({ title: a.title, detail: a.detail, severity: a.severity, last_seen_at: now }).eq('id', id)
    if (error) throw new Error(`notifications: ${error.message}`)
  },
  async resolve(ids, now) {
    if (!ids.length) return
    const { error } = await supabaseAdmin().from('cc_notifications').update({ resolved_at: now }).in('id', ids).is('resolved_at', null)
    if (error) throw new Error(`notifications: ${error.message}`)
  },
  async history(limit) {
    const { data, error } = await supabaseAdmin().from('cc_notifications').select('*').order('last_seen_at', { ascending: false }).limit(limit)
    if (error) throw new Error(`notifications: ${error.message}`)
    return (data ?? []).map(fromDb)
  },
  async readIds(profileId, ids) {
    if (!ids.length) return new Set()
    const { data, error } = await supabaseAdmin().from('cc_notification_reads').select('notification_id').eq('profile_id', profileId).in('notification_id', ids)
    if (error) throw new Error(`notifications: ${error.message}`)
    return new Set((data ?? []).map((r) => r.notification_id as string))
  },
  async markRead(profileId, ids, now) {
    if (!ids.length) return
    const { error } = await supabaseAdmin()
      .from('cc_notification_reads')
      .upsert(ids.map((id) => ({ notification_id: id, profile_id: profileId, read_at: now })), { onConflict: 'notification_id,profile_id', ignoreDuplicates: true })
    if (error) throw new Error(`notifications: ${error.message}`)
  },
}

export const notificationStore = (): Store => (authMode().kind === 'dev' ? memory : db)

/** Writes are throttled per server instance: every page view reads alerts, but history needs a write at most every 30 s. */
const SYNC_EVERY_MS = 30_000

export async function syncNotifications(alerts: readonly Alert[], observed: Observed, now = new Date()): Promise<void> {
  if (g.__ccNotificationSyncAt && now.getTime() - g.__ccNotificationSyncAt < SYNC_EVERY_MS) return
  g.__ccNotificationSyncAt = now.getTime()
  const store = notificationStore()
  const at = now.toISOString()
  try {
    const plan = planSync(await store.listOpen(), alerts, observed)
    await Promise.all([...plan.raise.map((a) => store.raise(a, at)), ...plan.touch.map((t) => store.touch(t.id, t.alert, at)), store.resolve(plan.resolve, at)])
  } catch (e) {
    g.__ccNotificationSyncAt = undefined // try again on the next view
    throw e
  }
}
