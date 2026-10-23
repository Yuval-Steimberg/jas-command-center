import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import type { Alert, Severity } from '@/lib/alerts'
import type { Product } from '@/lib/auth/rbac'
import { planSync, type Observed, type OpenNotification } from './plan'
import { DEFAULT_PREFS, fromRow, type NotificationPrefs } from './prefs'

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
  /** cc_profiles.id of the person who owns this alert, or null. */
  assignedTo: string | null
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
  assign(id: string, profileId: string | null): Promise<boolean>
  getPrefs(profileId: string): Promise<{ prefs: NotificationPrefs; available: boolean }>
  savePrefs(profileId: string, prefs: NotificationPrefs): Promise<void>
  /** Open alerts not yet emailed; null when the database cannot track it (0002 not run). */
  unemailed(): Promise<NotificationRow[] | null>
  markEmailed(ids: string[], now: string): Promise<void>
  /** Every saved settings row; [] when the table is missing. */
  allPrefs(): Promise<Map<string, NotificationPrefs>>
}

const g = globalThis as unknown as { __ccDevNotifications?: { rows: NotificationRow[]; reads: Set<string>; prefs: Map<string, NotificationPrefs>; emailed: Set<string> }; __ccNotificationSyncAt?: number }

const memory: Store = {
  async listOpen() {
    return mem().rows.filter((r) => !r.resolvedAt)
  },
  async raise(a, now) {
    mem().rows.unshift({ id: crypto.randomUUID(), alertKey: a.id, product: a.product, severity: a.severity, title: a.title, detail: a.detail, firstSeenAt: now, lastSeenAt: now, resolvedAt: null, assignedTo: null })
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
  async assign(id, profileId) {
    const r = mem().rows.find((x) => x.id === id && !x.resolvedAt)
    if (r) r.assignedTo = profileId
    return Boolean(r)
  },
  async getPrefs(profileId) {
    return { prefs: mem().prefs.get(profileId) ?? DEFAULT_PREFS, available: true }
  },
  async savePrefs(profileId, prefs) {
    mem().prefs.set(profileId, prefs)
  },
  async unemailed() {
    return mem().rows.filter((r) => !r.resolvedAt && !mem().emailed.has(r.id))
  },
  async markEmailed(ids) {
    for (const id of ids) mem().emailed.add(id)
  },
  async allPrefs() {
    return new Map(mem().prefs)
  },
}
type Mem = NonNullable<typeof g.__ccDevNotifications>
const mem = (): Mem => (g.__ccDevNotifications ??= { rows: [], reads: new Set(), prefs: new Map(), emailed: new Set() })

/** 0002_notification_prefs.sql not run yet: the table is missing (42P01 / PGRST205). */
const missingTable = (e: { code?: string; message?: string }) => e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '')

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
  assignedTo: (r.assigned_to as string | null) ?? null,
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
  async assign(id, profileId) {
    const { data, error } = await supabaseAdmin().from('cc_notifications').update({ assigned_to: profileId }).eq('id', id).is('resolved_at', null).select('id')
    if (error) throw new Error(`notifications: ${error.message}`)
    return Boolean(data?.length)
  },
  async getPrefs(profileId) {
    const { data, error } = await supabaseAdmin().from('cc_notification_prefs').select('*').eq('profile_id', profileId).maybeSingle()
    if (error) {
      if (missingTable(error)) return { prefs: DEFAULT_PREFS, available: false }
      throw new Error(`notification settings: ${error.message}`)
    }
    return { prefs: fromRow(data), available: true }
  },
  async savePrefs(profileId, p) {
    const { error } = await supabaseAdmin()
      .from('cc_notification_prefs')
      .upsert({ profile_id: profileId, muted_products: p.mutedProducts, min_severity: p.minSeverity, email_alerts: p.emailAlerts, email_report: p.emailReport, updated_at: new Date().toISOString() })
    if (error) throw new Error(missingTable(error) ? 'Notification settings need the 0002_notification_prefs.sql migration (Supabase → SQL Editor).' : `notification settings: ${error.message}`)
  },
  async unemailed() {
    const { data, error } = await supabaseAdmin().from('cc_notifications').select('*').is('resolved_at', null).is('emailed_at', null)
    if (error) {
      if (missingTable(error) || /emailed_at/.test(error.message)) return null
      throw new Error(`notifications: ${error.message}`)
    }
    return (data ?? []).map(fromDb)
  },
  async markEmailed(ids, now) {
    if (!ids.length) return
    const { error } = await supabaseAdmin().from('cc_notifications').update({ emailed_at: now }).in('id', ids)
    if (error) throw new Error(`notifications: ${error.message}`)
  },
  async allPrefs() {
    const { data, error } = await supabaseAdmin().from('cc_notification_prefs').select('*')
    if (error) {
      if (missingTable(error)) return new Map()
      throw new Error(`notification settings: ${error.message}`)
    }
    return new Map((data ?? []).map((r) => [r.profile_id as string, fromRow(r)]))
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
