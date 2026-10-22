import type { Product } from '@/lib/auth/rbac'
import type { ProductHealth, SourceResult } from '@/lib/integrations/types'
import type { GiftCardSummary } from '@/lib/integrations/gift-cards/contract'
import type { DesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import type { MetricsSnapshot } from '@/lib/integrations/website/contract'

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
}

const HREF: Record<Product, string> = {
  website: '/website',
  gift_cards: '/gift-cards',
  furniture: '/furniture',
  design_agent: '/design-agent',
  map: '/map',
}

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
      out.push({ id: 'gift:unmatched', severity: 'critical', product: 'gift_cards', title: `${d.unmatchedPayments} payment(s) matched no gift card`, detail: 'A payment callback arrived but no card was issued for it.', href: HREF.gift_cards })
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

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
  return out.sort((x, y) => rank[x.severity] - rank[y.severity])
}
