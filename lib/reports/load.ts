import 'server-only'
import { loadAnalytics } from '@/lib/analytics/load'
import { liveAlerts, liveHealth } from '@/lib/live'
import { ADAPTERS } from '@/lib/integrations/registry'
import { rangeFor } from '@/lib/time'
import type { Product } from '@/lib/auth/rbac'
import { buildBusinessReport, REPORT_KINDS, type ReportKind } from './business'

/** Reads the same sources as /analytics and the alert sweep, filtered to what the person may see. */
export async function loadBusinessReport(kind: ReportKind, canRead: (p: Product) => boolean) {
  // canRead, not the session: the scheduled email builds one report per recipient, with no one signed in.
  const [analytics, all, health] = await Promise.all([loadAnalytics(rangeFor(REPORT_KINDS[kind].preset), canRead), liveAlerts(), liveHealth()])
  const alerts = all.filter((a) => canRead(a.product))
  const systems = health
    .filter((h) => canRead(h.product))
    .map((h) => ({
      name: ADAPTERS.find((a) => a.product === h.product)?.name ?? h.product,
      status: h.status,
      detail: h.checks.filter((c) => c.status !== 'operational').map((c) => `${c.name}: ${c.detail}`).join(' · ') || null,
    }))
  return buildBusinessReport(kind, analytics, alerts, systems)
}
