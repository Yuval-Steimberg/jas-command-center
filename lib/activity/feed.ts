import 'server-only'
import type { Permission } from '@/lib/auth/rbac'
import { listAudit } from '@/lib/audit/audit'
import { getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { notificationStore } from '@/lib/notifications/store'
import type { SourceResult } from '@/lib/integrations/types'
import { buildActivity, type ActivityItem } from './build'

export interface ActivityFeed {
  items: ActivityItem[]
  /** Sources that could not contribute, and why. Shown under the feed so a quiet feed is never mistaken for a quiet business. */
  gaps: string[]
}

export async function activityFeed(can: (p: Permission) => boolean, limit = 30): Promise<ActivityFeed> {
  const gaps: string[] = []
  const settle = async <T>(label: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    } catch (e) {
      gaps.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }
  const source = async <T>(label: string, read: () => Promise<SourceResult<T>>): Promise<T | null> => {
    const r = await read()
    if (r.state === 'ok') return r.data
    gaps.push(`${label}: ${r.state === 'not_configured' ? 'not connected' : r.error}`)
    return null
  }

  const [notifications, audit, agent, furniture] = await Promise.all([
    settle('Alert history', () => notificationStore().history(100)),
    can('audit:read') ? settle('Audit log', () => listAudit(100)) : null,
    can('design_agent:read') ? source('Design agent', getDesignAgentStatus) : null,
    can('furniture:read') ? source('Furniture', getFurnitureProjects) : null,
  ])
  const visible = (notifications ?? []).filter((n) => can(`${n.product}:read`))
  gaps.push('Website orders and gift card sales: the sources expose totals only, not individual events')
  return { items: buildActivity({ notifications: visible, audit, agent, furniture }, limit), gaps }
}
