import 'server-only'
import { can, type Product, type Role } from '@/lib/auth/rbac'
import { loadOverrides } from '@/lib/auth/session'
import { authMode } from '@/lib/auth/mode'
import { env } from '@/lib/env'
import { emailConfigured, sendEmail } from '@/lib/email/send'
import { supabaseAdmin } from '@/lib/supabase'
import { listStaff } from '@/lib/staff/store'
import { reportMarkdown, REPORT_KINDS, type ReportKind } from '@/lib/reports/business'
import { loadBusinessReport } from '@/lib/reports/load'
import { notificationStore } from './store'
import { emailedTo } from './prefs'
import { reportsDue } from './schedule'

/**
 * Email delivery for alerts and the scheduled business report. Recipients are
 * active staff who opted in (cc_notification_prefs), and each gets only what
 * their role may read — the same rule as the pages.
 *
 * Nothing is sent until SENDGRID_API_KEY + ALERT_EMAIL_FROM are set; until then
 * these return `skipped`, they never pretend to have sent.
 */
interface Recipient { id: string; email: string; role: Role; canRead: (p: Product) => boolean }

async function recipients(): Promise<{ list: Recipient[]; prefs: Awaited<ReturnType<ReturnType<typeof notificationStore>['allPrefs']>> }> {
  const [staff, overrides, prefs] = await Promise.all([listStaff(), loadOverrides(), notificationStore().allPrefs()])
  const list = staff
    .filter((s) => s.active && s.role)
    .map((s) => ({ id: s.id, email: s.email, role: s.role!, canRead: (p: Product) => can(s.role, `${p}:read`, overrides) }))
  return { list, prefs }
}

export type DeliveryOutcome = { state: 'skipped'; reason: string } | { state: 'done'; sent: number; failed: string[] }

export async function emailNewAlerts(now = new Date()): Promise<DeliveryOutcome> {
  if (authMode().kind !== 'supabase') return { state: 'skipped', reason: 'no staff database (dev login)' }
  const store = notificationStore()
  const pending = await store.unemailed()
  if (pending === null) return { state: 'skipped', reason: 'run 0002_notification_prefs.sql to track sent alerts' }
  if (!pending.length) return { state: 'done', sent: 0, failed: [] }
  if (!emailConfigured()) return { state: 'skipped', reason: 'email not configured' }
  const { list, prefs } = await recipients()
  const base = env().cc.appUrl
  let sent = 0
  const failed: string[] = []
  for (const r of list) {
    const p = prefs.get(r.id)
    if (!p) continue
    const mine = pending.filter((n) => r.canRead(n.product) && emailedTo(p, n))
    if (!mine.length) continue
    const top = mine.some((n) => n.severity === 'critical') ? 'Critical' : 'Warning'
    const subject = mine.length === 1 ? `[JAS] ${top}: ${mine[0]!.title}` : `[JAS] ${top}: ${mine.length} new alerts`
    const text = [
      ...mine.map((n) => `- ${n.severity.toUpperCase()} · ${n.title}${n.detail ? `\n  ${n.detail}` : ''}`),
      '',
      `Open: ${base}/notifications`,
      `Change what you receive: ${base}/settings/notifications`,
    ].join('\n')
    const res = await sendEmail(r.email, subject, text)
    if (res.ok) sent++
    else failed.push(`${r.email}: ${res.error}`)
  }
  // Marked even when nobody opted in, so turning email on later does not deliver a backlog.
  // A recipient whose send FAILED is reported, not retried: a retry could duplicate the others' mail.
  await store.markEmailed(pending.map((n) => n.id), now.toISOString())
  return { state: 'done', sent, failed }
}

async function lastSent(kind: ReportKind): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from('cc_sync_state').select('cursor').eq('source', `report:${kind}`).maybeSingle()
  if (error) throw new Error(`report state: ${error.message}`)
  return (data?.cursor as string | undefined) ?? null
}
async function markSent(kind: ReportKind, day: string, error: string | null) {
  const at = new Date().toISOString()
  const { error: e } = await supabaseAdmin().from('cc_sync_state').upsert({ source: `report:${kind}`, cursor: day, last_success_at: at, last_error: error, last_error_at: error ? at : null, updated_at: at })
  if (e) throw new Error(`report state: ${e.message}`)
}

/** Sends the reports due today (Israel time), each at most once per day. */
export async function emailScheduledReports(now = new Date()): Promise<Record<string, DeliveryOutcome>> {
  if (authMode().kind !== 'supabase') return { all: { state: 'skipped', reason: 'no staff database (dev login)' } }
  if (!emailConfigured()) return { all: { state: 'skipped', reason: 'email not configured' } }
  const { day, kinds } = reportsDue(now)
  const { list, prefs } = await recipients()
  const base = env().cc.appUrl
  const out: Record<string, DeliveryOutcome> = {}
  for (const kind of kinds) {
    if ((await lastSent(kind)) === day) {
      out[kind] = { state: 'skipped', reason: `already sent for ${day}` }
      continue
    }
    const to = list.filter((r) => prefs.get(r.id)?.emailReport === kind)
    let sent = 0
    const failed: string[] = []
    // One report per distinct permission set, not per person.
    const byAccess = new Map<string, Awaited<ReturnType<typeof loadBusinessReport>>>()
    for (const r of to) {
      const key = (['website', 'gift_cards', 'furniture', 'design_agent', 'map'] as Product[]).map((p) => (r.canRead(p) ? '1' : '0')).join('')
      if (!byAccess.has(key)) byAccess.set(key, await loadBusinessReport(kind, r.canRead))
      const report = byAccess.get(key)!
      const res = await sendEmail(r.email, `[JAS] ${REPORT_KINDS[kind].label} report · ${report.period}`, `${reportMarkdown(report, base)}\n\nChange what you receive: ${base}/settings/notifications\n`)
      if (res.ok) sent++
      else failed.push(`${r.email}: ${res.error}`)
    }
    await markSent(kind, day, failed.length ? failed.join('; ').slice(0, 500) : null)
    out[kind] = { state: 'done', sent, failed }
  }
  return out
}
