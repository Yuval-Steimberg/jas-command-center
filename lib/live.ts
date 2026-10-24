import 'server-only'
import { cache } from 'react'
import { allHealth } from '@/lib/integrations/registry'
import { getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import { deriveAlerts, type Alert } from '@/lib/alerts'
import { getDeployments } from '@/lib/integrations/vercel/deployments'
import { rangeFor } from '@/lib/time'
import { cached, invalidate } from '@/lib/integrations/cache'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { getSession } from '@/lib/auth/session'
import { shownTo } from '@/lib/notifications/prefs'
import { can } from '@/lib/auth/rbac'
import { family } from '@/lib/notifications/plan'
import { notificationStore, syncNotifications, type NotificationRow } from '@/lib/notifications/store'

/** Per-request memo: the top bar, the overview and the notifications page share one fan-out. */
export const liveHealth = cache(() => allHealth())

/**
 * The sweep reads every source, so it is shared across requests for a minute:
 * the top bar runs it on every page, and without this each click fanned out to
 * all five systems and rewrote the notification history.
 */
export const SWEEP_TTL_MS = 60_000
const SWEEP_KEY = 'live:sweep'

const liveSweep = cache(() => cached(SWEEP_KEY, SWEEP_TTL_MS, sweepNow))

/** Live alerts persisted to cc_notifications, at most once per sweep. */
const syncedSweep = cache(() =>
  cached(`${SWEEP_KEY}:synced`, SWEEP_TTL_MS, async () => {
    const s = await liveSweep()
    await syncNotifications(s.alerts, s.observed)
    return s
  }),
)

async function sweepNow() {
  const [health, giftSummary, agentStatus, website, deployments, ops] = await Promise.all([
    liveHealth(),
    getGiftCardSummary(),
    getDesignAgentStatus(),
    // Alerts always look at the last 7 days, independent of the page's selected range.
    getWebsiteSnapshot(rangeFor('7d')),
    getDeployments(),
    getOpsSnapshot(),
  ])
  const alerts = deriveAlerts({ health, giftSummary, agentStatus, website, deployments, ops })
  // Which alert families this sweep could actually see (see planSync).
  const seen = new Set(['health', ...(giftSummary.state === 'ok' ? ['gift'] : []), ...(agentStatus.state === 'ok' ? ['agent'] : []), ...(website.state === 'ok' ? ['web'] : []), ...(deployments.state === 'ok' ? ['deploy'] : []), ...(ops.state === 'ok' ? ['ops'] : [])])
  return { alerts, observed: (key: string) => seen.has(family(key)) }
}

export const liveAlerts = cache(async () => (await liveSweep()).alerts)

/** Alerts the signed-in user may see: one per product they can read. */
export const visibleAlerts = cache(async () => {
  const [alerts, s] = await Promise.all([liveAlerts(), getSession()])
  if (!s) return []
  return alerts.filter((a) => can(s.user.role, `${a.product}:read`, s.overrides))
})

export interface NotificationState {
  /** Open notifications the user may see, each with when it started and whether they have read it. */
  open: (NotificationRow & { unread: boolean })[]
  /** Set when history could not be read or written; the live alerts still show. */
  error: string | null
  live: Alert[]
}

/** Live alerts, remembered: syncs cc_notifications, then reads this user's view of it. */
export const notificationState = cache(async (): Promise<NotificationState> => {
  const [s, live] = await Promise.all([getSession(), visibleAlerts()])
  if (!s) return { open: [], error: null, live: [] }
  try {
    await syncedSweep()
    const store = notificationStore()
    const [{ prefs }, all] = await Promise.all([store.getPrefs(s.user.id), store.listOpen()])
    // Muted products and the severity floor are this person's own view; critical always shows (prefs.ts).
    const open = all.filter((n) => can(s.user.role, `${n.product}:read`, s.overrides) && shownTo(prefs, n))
    const read = await store.readIds(s.user.id, open.map((n) => n.id))
    const rank = { critical: 0, warning: 1, info: 2 }
    return {
      open: open.map((n) => ({ ...n, unread: !read.has(n.id) })).sort((a, b) => rank[a.severity] - rank[b.severity] || b.firstSeenAt.localeCompare(a.firstSeenAt)),
      error: null,
      live,
    }
  } catch (e) {
    console.error('notification history unavailable', e instanceof Error ? e.message : e)
    return { open: [], error: e instanceof Error ? e.message : String(e), live }
  }
})

/** For the cron sweep: read every source and persist alert history, with nobody signed in. */
export async function runSweep(): Promise<{ alerts: number }> {
  invalidate(SWEEP_KEY)
  const { alerts, observed } = await liveSweep()
  await syncNotifications(alerts, observed)
  return { alerts: alerts.length }
}
