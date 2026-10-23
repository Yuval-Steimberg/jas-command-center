import type { Product } from '@/lib/auth/rbac'
import { PRODUCT_HREF } from '@/lib/products'
import type { AuditEntry } from '@/lib/audit/audit'
import type { DesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import type { FurnitureProject } from '@/lib/integrations/furniture/adapter'
import type { NotificationRow } from '@/lib/notifications/store'
import type { Interaction, Movement } from '@/lib/ops/types'
import { CHANNEL_LABEL } from '@/lib/crm/model'

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
  /** Inventory movements with the item's "SKU · title". */
  movements?: { m: Movement; item: string }[] | null
  /** Contact timeline entries; the contents are never shown here (personal data). */
  interactions?: Interaction[] | null
}

const MOVEMENT_TITLE: Partial<Record<Movement['type'], string>> = {
  intake: 'Taken into inventory', list: 'Listed on the website', reserve: 'Reserved', release: 'Reservation ended', sell: 'Sold', deliver: 'Delivered',
  return: 'Returned to stock', donate: 'Donated', recycle: 'Sent to recycling', dispose: 'Disposed', conflict: 'Needs checking (possible double sale)',
}

const HREF: Record<Product, string> = PRODUCT_HREF
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

  for (const { m, item } of i.movements ?? []) {
    const title = MOVEMENT_TITLE[m.type]
    if (!title) continue // moves, edits and quantity changes are routine and stay on the item's own history
    out.push({ id: `im:${m.id}`, at: m.at, product: 'inventory', tone: m.type === 'conflict' ? 'bad' : 'neutral', title: `${title}: ${item}`, detail: m.detail.channel === 'website' ? `website order ${String(m.detail.orderNumber ?? '')}`.trim() : m.actorEmail, href: `/inventory/${m.itemId}` })
  }

  for (const x of i.interactions ?? []) {
    if (x.channel === 'website_order') continue // already an inventory sale or a website order
    out.push({ id: `ci:${x.id}`, at: x.at, product: 'crm', tone: 'neutral', title: `${CHANNEL_LABEL[x.channel]} ${x.direction === 'in' ? 'from' : x.direction === 'out' ? 'to' : 'about'} a contact`, detail: x.actorEmail.startsWith('system:') ? 'recorded by the sync' : x.actorEmail, href: `/crm/${x.contactId}` })
  }

  return out.filter((x) => !Number.isNaN(Date.parse(x.at))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

const isProduct = (p: string | null): p is Product => p !== null && p in HREF
