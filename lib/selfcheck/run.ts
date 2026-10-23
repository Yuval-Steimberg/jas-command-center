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
