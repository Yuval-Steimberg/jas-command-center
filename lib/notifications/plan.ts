import type { Alert } from '@/lib/alerts'

export interface OpenNotification {
  id: string
  alertKey: string
}

export interface SyncPlan {
  /** Alerts with no open row: a new notification starts now. */
  raise: Alert[]
  /** Alerts that are still open: refresh last_seen, title and detail. */
  touch: { id: string; alert: Alert }[]
  /** Open rows whose alert is gone AND whose source was read successfully. */
  resolve: string[]
}

/**
 * Which alert families this sweep could actually see. An alert that vanished
 * because its source failed to load is NOT resolved — "we could not look" is
 * not "it is fixed". Families are the alert id's prefix (gift:, agent:, web:, health:).
 */
export type Observed = (alertKey: string) => boolean

export function planSync(open: readonly OpenNotification[], alerts: readonly Alert[], observed: Observed): SyncPlan {
  const byKey = new Map(open.map((o) => [o.alertKey, o]))
  const current = new Set(alerts.map((a) => a.id))
  return {
    raise: alerts.filter((a) => !byKey.has(a.id)),
    touch: alerts.flatMap((a) => (byKey.has(a.id) ? [{ id: byKey.get(a.id)!.id, alert: a }] : [])),
    resolve: open.filter((o) => !current.has(o.alertKey) && observed(o.alertKey)).map((o) => o.id),
  }
}

export const family = (alertKey: string) => alertKey.split(':')[0] ?? ''
