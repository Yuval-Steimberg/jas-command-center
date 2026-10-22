import type { Product } from '@/lib/auth/rbac'
import type { AuditEntry } from '@/lib/audit/audit'
import type { DesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import type { FurnitureProject } from '@/lib/integrations/furniture/adapter'
import type { NotificationRow } from '@/lib/notifications/store'

export interface ActivityItem {
  id: string
  at: string
  product: Product | null
  tone: 'good' | 'bad' | 'neutral'
  title: string
  detail: string | null
  href: string | null
}

export interface ActivityInputs {
  notifications?: NotificationRow[] | null
  audit?: AuditEntry[] | null
  agent?: DesignAgentStatus | null
  furniture?: FurnitureProject[] | null
}

const HREF: Record<Product, string> = { website: '/website', gift_cards: '/gift-cards', furniture: '/furniture', design_agent: '/design-agent', map: '/map' }
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * One timeline from records that already carry their own timestamp: alerts
 * starting and ending (cc_notifications), actions people took here
 * (cc_audit_log), and the timestamped rows the sources expose. Nothing is
 * invented: a source that was not read contributes nothing, and the caller
 * lists it as a gap.
 */
export function buildActivity(i: ActivityInputs, limit = 30): ActivityItem[] {
  const out: ActivityItem[] = []

  for (const n of i.notifications ?? []) {
    out.push({ id: `n:${n.id}:open`, at: n.firstSeenAt, product: n.product, tone: n.severity === 'info' ? 'neutral' : 'bad', title: `Alert raised: ${n.title}`, detail: n.detail || null, href: HREF[n.product] })
    if (n.resolvedAt) out.push({ id: `n:${n.id}:resolved`, at: n.resolvedAt, product: n.product, tone: 'good', title: `Resolved: ${n.title}`, detail: null, href: HREF[n.product] })
  }

  for (const a of i.audit ?? []) {
    // A lookup the assistant made is noise next to the question that caused it; "requested" is followed by its outcome.
    if (a.action === 'assistant.tool' || a.outcome === 'requested') continue
    out.push({
      id: `a:${a.id}`,
      at: a.at,
      product: isProduct(a.product) ? a.product : null,
      tone: a.outcome === 'succeeded' ? 'neutral' : 'bad',
      title: `${a.actorEmail} · ${a.action}${a.outcome === 'succeeded' ? '' : ` (${a.outcome})`}`,
      detail: a.via === 'assistant' ? 'via the AI assistant' : a.target,
      href: null,
    })
  }

  if (i.agent) {
    for (const p of i.agent.projects) out.push({ id: `dp:${p.id}:${p.updated_at}`, at: iso(p.updated_at), product: 'design_agent', tone: 'neutral', title: `Design updated: ${p.title || `project #${p.id}`}`, detail: [p.kind, p.status, p.current_version ? `v${p.current_version}` : null].filter(Boolean).join(' · ') || null, href: HREF.design_agent })
    for (const d of i.agent.dead) out.push({ id: `dj:${d.id}`, at: iso(d.updated_at), product: 'design_agent', tone: 'bad', title: `Job failed permanently: ${d.type}`, detail: d.err ? d.err.slice(0, 160) : null, href: HREF.design_agent })
    for (const o of i.agent.outbound_failed) out.push({ id: `do:${o.id}`, at: iso(o.created_at), product: 'design_agent', tone: 'bad', title: `Message failed to send: ${o.kind}`, detail: o.error ? o.error.slice(0, 160) : null, href: HREF.design_agent })
  }

  for (const p of i.furniture ?? []) out.push({ id: `fp:${p.id}`, at: p.created_at, product: 'furniture', tone: 'neutral', title: `Furniture project added: ${p.name}`, detail: [p.city, p.developer_name].filter(Boolean).join(' · ') || null, href: HREF.furniture })

  return out.filter((x) => !Number.isNaN(Date.parse(x.at))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

const isProduct = (p: string | null): p is Product => p !== null && p in HREF
