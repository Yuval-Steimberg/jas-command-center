import type { Product } from '@/lib/auth/rbac'
import { PRODUCT_HREF } from '@/lib/products'
import type { ProductHealth, SourceResult } from '@/lib/integrations/types'
import type { GiftCardSummary } from '@/lib/integrations/gift-cards/contract'
import type { DesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import type { MetricsSnapshot } from '@/lib/integrations/website/contract'
import { productForProject, type ProjectDeployments } from '@/lib/integrations/vercel/summarise'
import type { OpsSnapshot } from '@/lib/ops/summary'

export type Severity = 'critical' | 'warning' | 'info'
export interface Alert {
  id: string
  severity: Severity
  product: Product
  title: string
  detail: string
  href: string
}

export interface AlertInputs {
  health: ProductHealth[]
  giftSummary?: SourceResult<GiftCardSummary>
  agentStatus?: SourceResult<DesignAgentStatus>
  website?: SourceResult<MetricsSnapshot>
  deployments?: SourceResult<ProjectDeployments[]>
  ops?: SourceResult<OpsSnapshot>
}

const HREF: Record<Product, string> = PRODUCT_HREF

/**
 * Turns live source state into the attention list. Pure, so every rule is
 * tested. Rules are deliberately few: an alert has to mean "a person should
 * look", or nobody reads them (the gift card system's own lesson, gotcha #19).
 * Money already taken from a customer is always critical.
 */
export function deriveAlerts(i: AlertInputs): Alert[] {
  const out: Alert[] = []
  for (const h of i.health) {
    if (h.status === 'down') {
      const failing = h.checks.filter((c) => c.status === 'down').map((c) => `${c.name}: ${c.detail}`)
      out.push({ id: `health:${h.product}`, severity: 'critical', product: h.product, title: 'Service unavailable', detail: failing.join(' · '), href: '/integrations' })
    }
  }

  const g = i.giftSummary
  if (g?.state === 'ok') {
    const d = g.data.deliveryHealth
    if (d.paidNotActivated)
      out.push({ id: 'gift:paid-not-activated', severity: 'critical', product: 'gift_cards', title: `${d.paidNotActivated} paid gift card(s) never activated`, detail: `Customer was charged; card is not active. Last ${d.windowDays} days.`, href: HREF.gift_cards })
    if (d.undelivered)
      out.push({ id: 'gift:undelivered', severity: 'critical', product: 'gift_cards', title: `${d.undelivered} active gift card(s) not delivered`, detail: Object.entries(d.undeliveredByStatus).map(([k, v]) => `${k}: ${v}`).join(', ') || `Last ${d.windowDays} days.`, href: HREF.gift_cards })
    if (d.unmatchedPayments)
      out.push({ id: 'gift:unmatched', severity: 'critical', product: 'gift_cards', title: `${d.unmatchedPayments} payment(s) matched no gift card`, detail: 'A payment callback arrived but no card was issued for it. If the amounts match website shop orders, Grow’s all-transactions webhook is sending shop payments to the gift card app.', href: HREF.gift_cards })
    if (g.data.stats.expiringSoon)
      out.push({ id: 'gift:expiring', severity: 'info', product: 'gift_cards', title: `${g.data.stats.expiringSoon} gift card(s) expire within 30 days`, detail: 'Still holding a balance.', href: HREF.gift_cards })
  }

  const a = i.agentStatus
  if (a?.state === 'ok') {
    if (a.data.dead.length)
      out.push({ id: 'agent:dead', severity: 'warning', product: 'design_agent', title: `${a.data.dead.length} design-agent job(s) failed permanently`, detail: a.data.dead[0]?.err ? `Latest: ${a.data.dead[0].err.slice(0, 140)}` : 'Retry from the design agent page.', href: HREF.design_agent })
    if (a.data.outbound_failed.length)
      out.push({ id: 'agent:outbound', severity: 'warning', product: 'design_agent', title: `${a.data.outbound_failed.length} message(s) failed to send`, detail: a.data.outbound_failed[0]?.error?.slice(0, 140) ?? '', href: HREF.design_agent })
  }

  const w = i.website
  if (w?.state === 'ok') {
    const k = w.data.kpis
    if (k.paymentFailures.status !== 'unavailable' && (k.paymentFailures.value ?? 0) > 0)
      out.push({ id: 'web:payment-failures', severity: 'warning', product: 'website', title: `${k.paymentFailures.value} failed payment attempt(s)`, detail: `${w.data.range.from} – ${w.data.range.to}`, href: HREF.website })
    if (w.data.sales.pendingStale > 0)
      out.push({ id: 'web:pending-stale', severity: 'warning', product: 'website', title: `${w.data.sales.pendingStale} order(s) stuck in pending`, detail: 'Checkout started a payment that never confirmed. Verify in Grow.', href: HREF.website })
    if (w.data.sales.unverifiedRevenue > 0)
      out.push({ id: 'web:unverified', severity: 'info', product: 'website', title: 'Some revenue is not webhook-verified', detail: 'Orders marked paid without a verified Grow callback.', href: HREF.website })
  }

  const dep = i.deployments
  if (dep?.state === 'ok') {
    for (const d of dep.data) {
      const product = productForProject(d.project)
      if (!product || !d.latestFailed) continue
      out.push({
        id: `deploy:${d.project}`,
        severity: 'warning',
        product,
        title: `Latest deploy of ${d.project} failed`,
        detail: `${d.live ? `Production still serves the deploy from ${d.live.createdAt.slice(0, 16).replace('T', ' ')} UTC.` : 'No successful production deploy in the recent list.'}${d.latest.commit ? ` Failed commit: ${d.latest.commit}` : ''}`,
        href: '/integrations#deployments',
      })
    }
  }

  // The command center's own modules. A rule switched off on /tasks raises nothing.
  const o = i.ops
  if (o?.state === 'ok') {
    const on = (rule: string) => o.data.rules[rule] !== false
    if (o.data.tasks.doubleSale)
      out.push({ id: 'ops:double-sale', severity: 'critical', product: 'inventory', title: `${o.data.tasks.doubleSale} possible double sale(s) to check`, detail: 'A website order paid for an item that was already reserved, sold or gone here. Check before shipping.', href: '/tasks' })
    if (on('stale_leads') && o.data.crm.staleLeads)
      out.push({ id: 'ops:stale-leads', severity: 'warning', product: 'crm', title: `${o.data.crm.staleLeads} new lead(s) not contacted for 3+ days`, detail: 'From the website forms or added here.', href: '/crm/pipeline' })
    if (on('overdue_tasks') && o.data.tasks.overdue)
      out.push({ id: 'ops:overdue-tasks', severity: 'warning', product: 'crm', title: `${o.data.tasks.overdue} task(s) past their due date`, detail: 'Open tasks whose due date has passed.', href: '/tasks' })
    if (o.data.purchasing?.late)
      out.push({ id: 'ops:po-late', severity: 'warning', product: 'inventory', title: `${o.data.purchasing.late} purchase order(s) past their expected date`, detail: 'Ordered from a supplier and not fully received. Chase the supplier or close the order.', href: '/suppliers' })
    if (on('aging_stock') && o.data.items.agingUnlisted)
      out.push({ id: 'ops:aging-stock', severity: 'info', product: 'inventory', title: `${o.data.items.agingUnlisted} item(s) in storage 60+ days, not listed`, detail: 'List them, donate them, or recycle them.', href: '/inventory?status=in_storage' })
    if (o.data.items.reservedExpiringSoon)
      out.push({ id: 'ops:reservations-expiring', severity: 'info', product: 'inventory', title: `${o.data.items.reservedExpiringSoon} reservation(s) end within 24 hours`, detail: 'They go back on sale automatically unless sold or extended.', href: '/inventory?status=reserved' })
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
  return out.sort((x, y) => rank[x.severity] - rank[y.severity])
}
