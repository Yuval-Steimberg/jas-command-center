import { z } from 'zod'
import { PRODUCTS, type Product } from '@/lib/auth/rbac'
import type { Severity } from '@/lib/alerts'

/** One person's notification settings. Pure: parsing and filtering, no database. */
export const SEVERITIES = ['info', 'warning', 'critical'] as const
export const EMAIL_ALERTS = ['off', 'warning', 'critical'] as const
export const EMAIL_REPORTS = ['off', 'daily', 'weekly', 'monthly'] as const

export const prefsSchema = z.object({
  mutedProducts: z.array(z.enum(PRODUCTS)).max(PRODUCTS.length),
  minSeverity: z.enum(SEVERITIES),
  emailAlerts: z.enum(EMAIL_ALERTS),
  emailReport: z.enum(EMAIL_REPORTS),
})
export type NotificationPrefs = z.infer<typeof prefsSchema>

/** Everything shown, nothing emailed: email is opt-in. */
export const DEFAULT_PREFS: NotificationPrefs = { mutedProducts: [], minSeverity: 'info', emailAlerts: 'off', emailReport: 'off' }

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }
export const atLeast = (s: Severity, min: Severity) => RANK[s] >= RANK[min]

/**
 * Whether an alert belongs in this person's inbox. A CRITICAL alert is never
 * hidden by a mute: muting is for noise, and critical means money or customers.
 */
export function shownTo(p: NotificationPrefs, n: { product: Product; severity: Severity }): boolean {
  if (n.severity === 'critical') return true
  return !p.mutedProducts.includes(n.product) && atLeast(n.severity, p.minSeverity)
}

/** Whether a newly opened alert is emailed to this person. Mutes do not apply to critical, as above. */
export function emailedTo(p: NotificationPrefs, n: { product: Product; severity: Severity }): boolean {
  if (p.emailAlerts === 'off' || !atLeast(n.severity, p.emailAlerts)) return false
  return n.severity === 'critical' || !p.mutedProducts.includes(n.product)
}

export function fromRow(r: Record<string, unknown> | null | undefined): NotificationPrefs {
  if (!r) return DEFAULT_PREFS
  const parsed = prefsSchema.safeParse({ mutedProducts: r.muted_products ?? [], minSeverity: r.min_severity, emailAlerts: r.email_alerts, emailReport: r.email_report })
  return parsed.success ? parsed.data : DEFAULT_PREFS
}
