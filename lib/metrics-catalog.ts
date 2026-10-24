import type { Product } from '@/lib/auth/rbac'

/**
 * Every metric the command center shows, with its formula and where it comes
 * from. A number that is not in this list should not be on a screen —
 * tests/unit/analytics.test.ts fails if the analytics report carries an id
 * that is missing here. "Formula" describes what the SOURCE computes; the
 * command center only ever divides two source figures (stated where it does).
 */
export interface MetricDef {
  id: string
  product: Product
  label: string
  /** period = in the selected range, compared with the period before; now = current state. */
  basis: 'period' | 'now'
  formula: string
  source: string
  refresh: string
}

const WEB = 'Website MetricsSnapshot (POST /api/analytics)'
const WEB_R = 'On view, cached 5 min'
const GIFT_SALES = 'Gift Card System GET /api/integration/v1/sales'
const GIFT_SUM = 'Gift Card System GET /api/integration/v1/summary'
const GIFT_R = 'On view, cached 60 s'
const FURN = 'Furniture-Collect Supabase: projects + project_summary_counts'
const AGENT = 'Design agent GET /admin/activity'
const AGENT_H = 'Design agent GET /healthz'
const OPS = 'Command center Supabase: cc_inventory_* and cc_contacts / cc_deals (migration 0003)'
const OPS_R = 'On view'
const VOL = 'Command center Supabase: cc_volunteers, cc_vol_shifts, cc_vol_signups (migration 0005), via volunteerStats'

export const METRICS: MetricDef[] = [
  { id: 'web.revenue', product: 'website', label: 'Website revenue', basis: 'period', formula: 'Amount charged on orders paid/processing/shipped/delivered, after discounts, by payment date (Israel day). Not profit. Includes gift cards sold as cart lines.', source: WEB, refresh: WEB_R },
  { id: 'web.orders', product: 'website', label: 'Paid orders', basis: 'period', formula: 'Count of orders in a paid status. Checkout events are never orders.', source: WEB, refresh: WEB_R },
  { id: 'web.aov', product: 'website', label: 'Average order', basis: 'period', formula: 'Revenue ÷ paid orders.', source: WEB, refresh: WEB_R },
  { id: 'web.conversion', product: 'website', label: 'Conversion', basis: 'period', formula: 'Paid orders ÷ sessions in the same period (website definition). Change shown in percentage points.', source: WEB, refresh: WEB_R },
  { id: 'web.visitors', product: 'website', label: 'Visitors', basis: 'period', formula: 'Unique browsers (anonymous id) that visited; browsers with privacy signals count once per session. "partial" before tracking started.', source: WEB, refresh: WEB_R },
  { id: 'web.sessions', product: 'website', label: 'Sessions', basis: 'period', formula: 'A run of activity by one visitor; a new session starts after 30 minutes of inactivity.', source: WEB, refresh: WEB_R },
  { id: 'web.pageviews', product: 'website', label: 'Page views', basis: 'period', formula: 'page_view events.', source: WEB, refresh: WEB_R },
  { id: 'web.productViews', product: 'website', label: 'Product views', basis: 'period', formula: 'product_view events.', source: WEB, refresh: WEB_R },
  { id: 'web.addToCarts', product: 'website', label: 'Add to cart', basis: 'period', formula: 'add_to_cart events.', source: WEB, refresh: WEB_R },
  { id: 'web.checkouts', product: 'website', label: 'Checkouts started', basis: 'period', formula: 'Sessions that reached the checkout page.', source: WEB, refresh: WEB_R },
  { id: 'web.checkoutCompletion', product: 'website', label: 'Checkout completion', basis: 'period', formula: 'Sessions linked to a paid order ÷ sessions that reached checkout.', source: WEB, refresh: WEB_R },
  { id: 'web.cartAbandonment', product: 'website', label: 'Cart abandonment', basis: 'period', formula: 'Sessions with an add-to-cart that did not end in a paid order ÷ sessions with an add-to-cart.', source: WEB, refresh: WEB_R },
  { id: 'web.paymentFailures', product: 'website', label: 'Payment failures', basis: 'period', formula: 'payment_failed events reported by checkout.', source: WEB, refresh: WEB_R },
  { id: 'web.verifiedRevenue', product: 'website', label: 'Verified revenue', basis: 'period', formula: 'Revenue on orders confirmed by a signed Grow webhook.', source: WEB, refresh: WEB_R },
  { id: 'web.unverifiedRevenue', product: 'website', label: 'Unverified revenue', basis: 'period', formula: 'Revenue on paid orders without a signed Grow confirmation.', source: WEB, refresh: WEB_R },
  { id: 'web.pendingStale', product: 'website', label: 'Stuck in pending', basis: 'period', formula: 'Orders created in the period still pending payment more than an hour later.', source: WEB, refresh: WEB_R },

  { id: 'gift.sold', product: 'gift_cards', label: 'Gift cards sold', basis: 'period', formula: 'salesCards(): paid cards plus originals of reissues, never replacements, unpaid checkouts or refunds; by Israel day of issuedAt.', source: GIFT_SALES, refresh: GIFT_R },
  { id: 'gift.faceValue', product: 'gift_cards', label: 'Face value sold', basis: 'period', formula: 'Σ initial amount of cards sold. Not revenue, not liability; never added to website revenue.', source: GIFT_SALES, refresh: GIFT_R },
  { id: 'gift.averageCard', product: 'gift_cards', label: 'Average card', basis: 'period', formula: 'Face value sold ÷ cards sold.', source: GIFT_SALES, refresh: GIFT_R },
  { id: 'gift.redemptions', product: 'gift_cards', label: 'Redemptions', basis: 'period', formula: 'In-store redemptions created in the period, excluding ones later reversed.', source: GIFT_SALES, refresh: GIFT_R },
  { id: 'gift.redeemedPeriod', product: 'gift_cards', label: 'Value redeemed', basis: 'period', formula: 'Σ amount of those redemptions. A redemption is never a sale.', source: GIFT_SALES, refresh: GIFT_R },
  { id: 'gift.reversed', product: 'gift_cards', label: 'Reversed redemptions', basis: 'period', formula: 'Σ amount of redemptions in the period that were later reversed.', source: GIFT_SALES, refresh: GIFT_R },
  { id: 'gift.liability', product: 'gift_cards', label: 'Outstanding liability', basis: 'now', formula: 'Σ balance on active, partially redeemed and suspended cards.', source: GIFT_SUM, refresh: GIFT_R },
  { id: 'gift.active', product: 'gift_cards', label: 'Cards with balance', basis: 'now', formula: 'Active + partially redeemed cards.', source: GIFT_SUM, refresh: GIFT_R },
  { id: 'gift.redemptionRate', product: 'gift_cards', label: 'Redeemed share of value sold', basis: 'now', formula: 'All-time redeemed value ÷ all-time face value sold (divided here; both figures from the summary).', source: GIFT_SUM, refresh: GIFT_R },
  { id: 'gift.expiringSoon', product: 'gift_cards', label: 'Expiring within 30 days', basis: 'now', formula: 'Active or partially redeemed cards whose expiry is in the next 30 days.', source: GIFT_SUM, refresh: GIFT_R },
  { id: 'gift.failedDeliveries', product: 'gift_cards', label: 'Failed deliveries', basis: 'now', formula: 'Cards whose latest delivery failed or was rejected and was not followed by a delivery.', source: GIFT_SUM, refresh: GIFT_R },
  { id: 'gift.stuck', product: 'gift_cards', label: 'Paid, not delivered', basis: 'now', formula: 'Unmatched payments + paid-not-activated + active-but-undelivered, last 14 days.', source: GIFT_SUM, refresh: GIFT_R },

  { id: 'furn.newProjects', product: 'furniture', label: 'Projects started', basis: 'period', formula: 'Projects whose created_at falls in the period (Israel day), archived included.', source: FURN, refresh: GIFT_R },
  { id: 'furn.activeProjects', product: 'furniture', label: 'Active projects', basis: 'now', formula: 'Projects not archived.', source: FURN, refresh: GIFT_R },
  { id: 'furn.apartments', product: 'furniture', label: 'Apartments completed', basis: 'now', formula: 'Σ completed_count over active projects.', source: FURN, refresh: GIFT_R },
  { id: 'furn.apartmentRate', product: 'furniture', label: 'Apartments completed (share)', basis: 'now', formula: 'Σ completed_count ÷ Σ apartment_count over active projects.', source: FURN, refresh: GIFT_R },
  { id: 'furn.items', product: 'furniture', label: 'Items recorded', basis: 'now', formula: 'Σ items_total over active projects.', source: FURN, refresh: GIFT_R },
  { id: 'furn.collected', product: 'furniture', label: 'Items collected', basis: 'now', formula: 'Σ items_collected over active projects. Third-party handovers are not “collected”.', source: FURN, refresh: GIFT_R },
  { id: 'furn.collectionRate', product: 'furniture', label: 'Collection progress', basis: 'now', formula: 'Σ items_collected ÷ Σ items_to_collect over active projects.', source: FURN, refresh: GIFT_R },

  { id: 'agent.ownerMessages', product: 'design_agent', label: 'Messages from the owner', basis: 'period', formula: 'Inbound messages received (allowlisted owner numbers only).', source: AGENT, refresh: GIFT_R },
  { id: 'agent.projects', product: 'design_agent', label: 'Design projects started', basis: 'period', formula: 'Projects created.', source: AGENT, refresh: GIFT_R },
  { id: 'agent.versions', product: 'design_agent', label: 'Design versions produced', basis: 'period', formula: 'Versions created.', source: AGENT, refresh: GIFT_R },
  { id: 'agent.versionsApproved', product: 'design_agent', label: 'Versions approved', basis: 'period', formula: 'Versions created in the period that are approved now.', source: AGENT, refresh: GIFT_R },
  { id: 'agent.jobs', product: 'design_agent', label: 'Jobs run', basis: 'period', formula: 'Jobs created.', source: AGENT, refresh: GIFT_R },
  { id: 'agent.jobsDead', product: 'design_agent', label: 'Jobs that died', basis: 'period', formula: 'Jobs created in the period that are dead now (retries exhausted).', source: AGENT, refresh: GIFT_R },
  { id: 'agent.messagesSent', product: 'design_agent', label: 'Messages sent', basis: 'period', formula: 'Outbound messages created.', source: AGENT, refresh: GIFT_R },
  { id: 'agent.messagesFailed', product: 'design_agent', label: 'Sends failed', basis: 'period', formula: 'Outbound messages in the period whose status is failed.', source: AGENT, refresh: GIFT_R },
  { id: 'agent.queued', product: 'design_agent', label: 'Jobs queued now', basis: 'now', formula: 'Jobs with status queued.', source: AGENT_H, refresh: 'On view, cached 30 s' },
  { id: 'agent.stuck', product: 'design_agent', label: 'Stuck jobs', basis: 'now', formula: 'Queued and due for over 10 minutes.', source: AGENT_H, refresh: 'On view, cached 30 s' },

  { id: 'inv.intake', product: 'inventory', label: 'Items taken in', basis: 'period', formula: 'Intake movements (from collections or added by hand) in the period, Israel day.', source: OPS, refresh: OPS_R },
  { id: 'inv.inStoreSales', product: 'inventory', label: 'Sold in the shop', basis: 'period', formula: 'Sell movements with channel in_store.', source: OPS, refresh: OPS_R },
  { id: 'inv.inStoreValue', product: 'inventory', label: 'In-store sales value', basis: 'period', formula: 'Σ price recorded on those sell movements. Never added to website revenue.', source: OPS, refresh: OPS_R },
  { id: 'inv.inStoreReturns', product: 'inventory', label: 'Returned to the shop', basis: 'period', formula: 'Σ price on return movements of shop-sale units (channel in_store) in the period.', source: OPS, refresh: OPS_R },
  { id: 'inv.inStoreNet', product: 'inventory', label: 'In-store sales after returns', basis: 'period', formula: 'In-store sales value − returned to the shop, same period.', source: OPS, refresh: OPS_R },
  { id: 'inv.avgSalePrice', product: 'inventory', label: 'Average in-store price per unit', basis: 'period', formula: 'Σ in-store sale value ÷ Σ units sold in the period.', source: OPS, refresh: OPS_R },
  { id: 'inv.margin', product: 'inventory', label: 'In-store margin (items with a cost)', basis: 'period', formula: 'Σ (sale value − units × unit cost) over in-store sales whose item records a cost. Sales without a cost are left out and counted in the note.', source: OPS, refresh: OPS_R },
  { id: 'inv.soldOnline', product: 'inventory', label: 'Inventory items sold online', basis: 'period', formula: 'Sell movements written by the website order sync. Counted, never valued: the money is in website revenue.', source: OPS, refresh: OPS_R },
  { id: 'inv.diverted', product: 'inventory', label: 'Donated or recycled', basis: 'period', formula: 'Donate + recycle movements.', source: OPS, refresh: OPS_R },
  { id: 'inv.daysToSell', product: 'inventory', label: 'Days from intake to sale', basis: 'period', formula: 'Mean of (sold at − taken in) for items whose sale is in the period and was not returned.', source: OPS, refresh: OPS_R },
  { id: 'inv.available', product: 'inventory', label: 'Available now', basis: 'now', formula: 'Items in storage or listed.', source: OPS, refresh: OPS_R },
  { id: 'inv.unlisted', product: 'inventory', label: 'In storage, not listed', basis: 'now', formula: 'Items with status in_storage.', source: OPS, refresh: OPS_R },
  { id: 'inv.aging', product: 'inventory', label: 'Unlisted 60+ days', basis: 'now', formula: 'In storage and taken in 60 or more days ago.', source: OPS, refresh: OPS_R },
  { id: 'inv.awaitingDelivery', product: 'inventory', label: 'Sold, not delivered', basis: 'now', formula: 'Items with status sold.', source: OPS, refresh: OPS_R },

  { id: 'crm.newContacts', product: 'crm', label: 'New contacts', basis: 'period', formula: 'Contacts created in the period (by hand or by the website sync).', source: OPS, refresh: OPS_R },
  { id: 'crm.newLeads', product: 'crm', label: 'New leads', basis: 'period', formula: 'Leads created in the period.', source: OPS, refresh: OPS_R },
  { id: 'crm.won', product: 'crm', label: 'Leads won', basis: 'period', formula: 'Leads moved to won, by the day they closed.', source: OPS, refresh: OPS_R },
  { id: 'crm.openLeads', product: 'crm', label: 'Open leads', basis: 'now', formula: 'Leads in new, contacted, qualified or proposal.', source: OPS, refresh: OPS_R },
  { id: 'crm.staleLeads', product: 'crm', label: 'New leads waiting 3+ days', basis: 'now', formula: 'Leads still new whose last contact (or creation) is 3 or more days ago.', source: OPS, refresh: OPS_R },
  { id: 'crm.customers', product: 'crm', label: 'Customers', basis: 'now', formula: 'Contacts with the customer role.', source: OPS, refresh: OPS_R },

  { id: 'vol.signedUp', product: 'volunteers', label: 'Signed up (expected)', basis: 'period', formula: 'Confirmed sign-ups on live shifts that start in the period (Israel day). Expected participants, never counted as attended.', source: VOL, refresh: OPS_R },
  { id: 'vol.attended', product: 'volunteers', label: 'Attended (actual)', basis: 'period', formula: 'Confirmed sign-ups with attendance recorded as present.', source: VOL, refresh: OPS_R },
  { id: 'vol.hours', product: 'volunteers', label: 'Volunteer hours', basis: 'period', formula: 'Σ recorded minutes of present attendance ÷ 60. Registering or being confirmed adds no hours.', source: VOL, refresh: OPS_R },
  { id: 'vol.attendees', product: 'volunteers', label: 'Volunteers who came', basis: 'period', formula: 'Distinct volunteers with at least one present attendance.', source: VOL, refresh: OPS_R },
  { id: 'vol.firstTime', product: 'volunteers', label: 'First-time volunteers', basis: 'period', formula: 'Attendees whose first-ever present attendance falls in the period.', source: VOL, refresh: OPS_R },
  { id: 'vol.attendanceRate', product: 'volunteers', label: 'Showed up', basis: 'period', formula: 'Attended ÷ (attended + absent). Excused and not recorded are excluded.', source: VOL, refresh: OPS_R },
  { id: 'vol.cancellations', product: 'volunteers', label: 'Cancellations', basis: 'period', formula: 'Sign-ups cancelled on shifts in the period.', source: VOL, refresh: OPS_R },
  { id: 'vol.newRegistrations', product: 'volunteers', label: 'New registrations', basis: 'period', formula: 'Volunteers registered in the period (not deleted).', source: VOL, refresh: OPS_R },
  { id: 'vol.unrecorded', product: 'volunteers', label: 'Attendance not recorded', basis: 'period', formula: 'Confirmed on a shift that has ended with no attendance recorded.', source: VOL, refresh: OPS_R },
  { id: 'vol.registered', product: 'volunteers', label: 'Registered volunteers', basis: 'now', formula: 'Volunteers not deleted (any status).', source: VOL, refresh: OPS_R },
  { id: 'vol.active90', product: 'volunteers', label: 'Active in the last 90 days', basis: 'now', formula: 'Distinct volunteers with a present attendance in the last 90 days.', source: VOL, refresh: OPS_R },

  { id: 'map.places', product: 'map', label: 'Map places', basis: 'now', formula: 'Entries in LOCS in places-data.js on the published branch.', source: 'GitHub Interactive-map', refresh: 'On view, cached 5 min' },
]

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]))
