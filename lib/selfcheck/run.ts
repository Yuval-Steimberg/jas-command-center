import 'server-only'
import { allHealth } from '@/lib/integrations/registry'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import {
  listWebsiteCampaigns,
  listWebsiteContent,
  listWebsiteDiscounts,
  listWebsiteInquiries,
  listWebsiteOrders,
  listWebsitePosts,
  getWebsiteProductMeta,
  listWebsiteProducts,
  listWebsiteReviews,
} from '@/lib/integrations/website/manage'
import { getGiftCardSales, getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getFurnitureKpis } from '@/lib/integrations/furniture/field'
import { getDesignAgentActivity, getDesignAgentOs, getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { getMapData } from '@/lib/integrations/map/adapter'
import { getMapTraffic } from '@/lib/integrations/map/ga4'
import { listPlacePullRequests } from '@/lib/integrations/map/github'
import { getDeployments } from '@/lib/integrations/vercel/deployments'
import { listStaff } from '@/lib/staff/store'
import { notificationStore } from '@/lib/notifications/store'
import { listAudit } from '@/lib/audit/audit'
import { emailConfigured } from '@/lib/email/send'
import { env } from '@/lib/env'
import { addDays, israelDate } from '@/lib/time'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { syncStatus } from '@/lib/sync/run'
import { listIntakeCandidates } from '@/lib/integrations/furniture/intake'
import { listWebsiteOrdersSince } from '@/lib/integrations/website/manage'
import { getSupplierStore } from '@/lib/suppliers/store'
import { OpsSetupError } from '@/lib/ops/store'
import { OPEN_PO, isOverdue } from '@/lib/suppliers/model'
import { fromCall, fromSource, summarise, type Probe } from './probe'

/**
 * Every read a Command Center page depends on, run once against production.
 * Read-only: nothing here writes to a source. Called by /api/cron/selfcheck
 * (GitHub workflow "Production check"), which is how anyone without access to
 * the live hosts can see which sections work.
 */
export async function runSelfCheck(now = new Date()) {
  const to = israelDate(now)
  const week = { from: addDays(to, -6), to }

  const [health, projects] = await Promise.all([allHealth(), getFurnitureProjects()])
  const firstProject = projects.state === 'ok' ? projects.data[0] : undefined

  const probes: Probe[] = await Promise.all([
    // Website & shop
    getWebsiteSnapshot(week).then((r) => fromSource('website', 'Analytics snapshot (7 days)', r, () => 'snapshot returned')),
    listWebsiteOrders('').then((r) => fromSource('website', 'Orders', r, (d) => `${d.length} listed`)),
    listWebsiteProducts('').then((r) => fromSource('website', 'Products', r, (d) => `${d.length} listed`)),
    getWebsiteProductMeta().then((r) => fromSource('website', 'Product categories', r, () => 'returned')),
    listWebsiteContent().then((r) => fromSource('website', 'Site content', r, () => 'returned')),
    listWebsiteReviews('').then((r) => fromSource('website', 'Reviews', r, (d) => `${d.length} listed`)),
    listWebsitePosts().then((r) => fromSource('website', 'Blog', r, (d) => `${d.length} posts`)),
    listWebsiteDiscounts().then((r) => fromSource('website', 'Discount codes', r, (d) => `${d.length} codes`)),
    listWebsiteCampaigns().then((r) => fromSource('website', 'Campaigns', r, (d) => `${d.length} campaigns`)),
    listWebsiteInquiries('open').then((r) => fromSource('website', 'Messages', r, (d) => `${d.inquiries.length} open`)),
    // Gift cards: the delivery breakdown is what the health line sums into one number.
    getGiftCardSummary().then((r) =>
      fromSource('gift_cards', 'Summary + delivery health', r, (d) => {
        const h = d.deliveryHealth
        const by = Object.entries(h.undeliveredByStatus).map(([k, v]) => `${k} ${v}`).join(', ')
        return `${h.windowDays}d: unmatched payments ${h.unmatchedPayments} (₪${(h.unmatchedPaymentsMinor / 100).toFixed(2)}), paid not activated ${h.paidNotActivated}, undelivered ${h.undelivered}${by ? ` [${by}]` : ''}`
      }),
    ),
    getGiftCardSales(week).then((r) => fromSource('gift_cards', 'Sales (7 days)', r, (d) => `${d.current.totals.cardsSold} cards sold`)),
    // Furniture
    Promise.resolve(fromSource('furniture', 'Projects', projects, (d) => `${d.length} projects`)),
    firstProject
      ? getFurnitureKpis(firstProject.id).then((r) => fromSource('furniture', 'Impact KPIs (field app endpoint)', r, () => 'returned'))
      : Promise.resolve<Probe>({ section: 'furniture', name: 'Impact KPIs (field app endpoint)', state: 'not_configured', latencyMs: null, detail: 'no project to read' }),
    // Design agent
    getDesignAgentStatus().then((r) => fromSource('design_agent', 'Jobs and failures', r, (d) => `${d.dead.length} dead jobs, ${d.outbound_failed.length} failed sends`)),
    getDesignAgentActivity(week).then((r) => fromSource('design_agent', 'Activity (7 days)', r, (d) => `${d.totals.jobs} jobs`)),
    getDesignAgentOs().then((r) =>
      fromSource('design_agent', 'Approvals, automations, AI cost', r, (d) =>
        d.available ? `${d.approvals.pending.length} approvals waiting, ${d.automations.list.length} automations, $${d.costs.total_usd.toFixed(2)} this month` : 'business OS not set up',
      ),
    ),
    // Map
    getMapData().then((r) => fromSource('map', 'Places', r, (d) => `${d.places.length} places`)),
    getMapTraffic(7).then((r) => fromSource('map', 'Visitors (GA4, 7 days)', r, () => 'returned')),
    env().map.githubToken
      ? fromCall('map', 'Place edit pull requests (GITHUB_TOKEN)', async () => `${(await listPlacePullRequests()).length} open`)
      : Promise.resolve<Probe>({ section: 'map', name: 'Place edit pull requests (GITHUB_TOKEN)', state: 'not_configured', latencyMs: null, detail: 'needs GITHUB_TOKEN' }),
    // Operations (the command center's own records, migration 0003) and the reads its sync depends on
    getOpsSnapshot().then((r) =>
      fromSource('ops', 'Inventory, customers, tasks (migration 0003)', r, (d) => `${d.items.available} available, ${d.items.awaitingDelivery} awaiting delivery, ${d.crm.openLeads} open leads, ${d.tasks.open} open tasks (${d.tasks.doubleSale} double-sale checks)`),
    ),
    getOpsSnapshot().then((snap) =>
      snap.state !== 'ok'
        ? Promise.resolve<Probe>({ section: 'ops', name: 'Website sync', state: 'not_configured', latencyMs: null, detail: 'needs migration 0003' })
        : fromCall('ops', 'Website sync', async () => {
            const st = await syncStatus()
            const errors = Object.entries(st).filter(([, c]) => c.lastError).map(([k, c]) => `${k}: ${c.lastError}`)
            if (errors.length) throw new Error(errors.join(' · '))
            return Object.entries(st).map(([k, c]) => `${k} ${c.lastSuccessAt ? `ok ${c.lastSuccessAt}` : 'never run'}`).join(', ')
          }),
    ),
    listWebsiteOrdersSince(new Date(now.getTime() - 86_400_000).toISOString()).then((r) => fromSource('ops', 'Website orders changed in 24h (orders-list since)', r, (d) => `${d.length} orders`)),
    listIntakeCandidates().then((r) => fromSource('ops', 'Collected items ready for intake', r, (d) => `${d.length} candidates`)),
    // Purchasing (migration 0004): not set up until it runs, which is reported, never failed.
    getSupplierStore()
      .listOrders({ statuses: OPEN_PO, limit: 2000 })
      .then(
        (orders): Probe => ({ section: 'ops', name: 'Purchase orders (migration 0004)', state: 'ok', latencyMs: null, detail: `${orders.length} open, ${orders.filter((o) => isOverdue(o)).length} late` }),
        (e): Probe =>
          e instanceof OpsSetupError
            ? { section: 'ops', name: 'Purchase orders (migration 0004)', state: 'not_configured', latencyMs: null, detail: 'run 0004_suppliers.sql' }
            : { section: 'ops', name: 'Purchase orders (migration 0004)', state: 'error', latencyMs: null, detail: e instanceof Error ? e.message : String(e) },
      ),
    // Platform
    getDeployments().then((r) => fromSource('platform', 'Vercel deployments', r, (d) => `${d.length} projects`)),
    fromCall('platform', 'Staff', async () => {
      const staff = await listStaff()
      return `${staff.filter((s) => s.active).length} active of ${staff.length}`
    }),
    fromCall('platform', 'Notification tracking (migration 0002)', async () => ((await notificationStore().unemailed()) === null ? Promise.reject(new Error('run 0002_notification_prefs.sql')) : 'present')),
    fromCall('platform', 'Audit log', async () => `${(await listAudit(1)).length ? 'has entries' : 'empty'}`),
    fromCall('platform', 'Alert email', async () => (emailConfigured() ? 'configured' : Promise.reject(new Error('SENDGRID_API_KEY / ALERT_EMAIL_FROM missing')))),
  ])

  return {
    generatedAt: now.toISOString(),
    health: health.map((h) => ({ product: h.product, status: h.status, checks: h.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail.slice(0, 160) })) })),
    probes,
    summary: summarise(probes),
  }
}
