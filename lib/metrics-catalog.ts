/**
 * Every metric the command center shows, with where it comes from. A number
 * that is not in this list should not be on a screen.
 */
export interface MetricDef {
  id: string
  label: string
  definition: string
  source: string
  refresh: string
}

export const METRICS: MetricDef[] = [
  { id: 'web.revenue', label: 'Website revenue', definition: 'Sum of order totals in paid/processing/shipped/delivered, bucketed by paid_at (Israel time). Verified = confirmed by signed Grow webhook.', source: 'Website MetricsSnapshot → orders', refresh: 'On view, cached 5 min' },
  { id: 'web.orders', label: 'Website paid orders', definition: 'Orders in a paid status in the period. Checkout events are never counted as orders.', source: 'Website MetricsSnapshot → orders', refresh: 'On view, cached 5 min' },
  { id: 'web.sessions', label: 'Website sessions / visitors', definition: 'First-party tracked sessions and anonymous browsers, bots excluded. "partial"/"n/a" before tracking started.', source: 'Website MetricsSnapshot → analytics_events', refresh: 'On view, cached 5 min' },
  { id: 'web.conversion', label: 'Website conversion', definition: 'Sessions with a paid order ÷ sessions (website definition).', source: 'Website MetricsSnapshot', refresh: 'On view, cached 5 min' },
  { id: 'web.paymentFailures', label: 'Payment failures', definition: 'payment_failed events reported by checkout.', source: 'Website MetricsSnapshot', refresh: 'On view, cached 5 min' },
  { id: 'gift.sold', label: 'Gift cards sold', definition: 'Paid cards (active, partially/fully redeemed, expired, suspended) plus originals of reissues; never reissue replacements or unpaid checkouts. Rolling 24 h / 7 d / 30 d by issue time.', source: 'Gift Card System getAdminStats()', refresh: 'On view, cached 60 s' },
  { id: 'gift.faceValue', label: 'Gift card face value sold', definition: 'Sum of initial amounts of sold cards. Not revenue after refunds; not liability.', source: 'Gift Card System getAdminStats()', refresh: 'On view, cached 60 s' },
  { id: 'gift.liability', label: 'Gift card liability', definition: 'Remaining balance on active, partially redeemed and suspended cards.', source: 'Gift Card System getAdminStats()', refresh: 'On view, cached 60 s' },
  { id: 'gift.redeemed', label: 'Gift card redeemed value', definition: 'Initial − remaining balance on paid cards. A redemption is never a sale.', source: 'Gift Card System getAdminStats()', refresh: 'On view, cached 60 s' },
  { id: 'gift.stuck', label: 'Paid, not delivered', definition: 'Unmatched payments + paid-not-activated + active-but-undelivered in the last 14 days.', source: 'Gift Card System getDeliveryHealth()', refresh: 'On view, cached 60 s' },
  { id: 'furn.apartments', label: 'Apartments completed', definition: 'Apartments with status COMPLETED ÷ all apartments, per project.', source: 'Furniture-Collect project_summary_counts', refresh: 'On view, cached 60 s' },
  { id: 'furn.collected', label: 'Items collected', definition: 'Items marked for collection that are ticked collected ÷ items marked for collection. Third-party handovers are not "collected".', source: 'Furniture-Collect project_summary_counts', refresh: 'On view, cached 60 s' },
  { id: 'agent.jobs', label: 'Design-agent jobs', definition: 'Job queue counts by status; stuck = queued and due for over 10 minutes.', source: 'Design agent /healthz', refresh: 'On view, cached 30 s' },
  { id: 'map.places', label: 'Map places', definition: 'Entries in LOCS in places-data.js on the published branch.', source: 'GitHub Interactive-map', refresh: 'On view, cached 5 min' },
]
