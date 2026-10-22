import 'server-only'
import { cache } from 'react'
import { allHealth } from '@/lib/integrations/registry'
import { getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import { deriveAlerts } from '@/lib/alerts'
import { rangeFor } from '@/lib/time'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'

/** Per-request memo: the top bar, the overview and the notifications page share one fan-out. */
export const liveHealth = cache(() => allHealth())

export const liveAlerts = cache(async () => {
  const [health, giftSummary, agentStatus, website] = await Promise.all([
    liveHealth(),
    getGiftCardSummary(),
    getDesignAgentStatus(),
    // Alerts always look at the last 7 days, independent of the page's selected range.
    getWebsiteSnapshot(rangeFor('7d')),
  ])
  return deriveAlerts({ health, giftSummary, agentStatus, website })
})

/** Alerts the signed-in user may see: one per product they can read. */
export const visibleAlerts = cache(async () => {
  const [alerts, s] = await Promise.all([liveAlerts(), getSession()])
  if (!s) return []
  return alerts.filter((a) => can(s.user.role, `${a.product}:read`, s.overrides))
})
