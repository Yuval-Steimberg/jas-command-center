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
import { searchGiftCards, getGiftCard, getGiftCardHealth } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProject } from '@/lib/integrations/furniture/manage'
import { searchEverything } from '@/lib/search/search'
import { activityFeed } from '@/lib/activity/feed'
import { loadAnalytics } from '@/lib/analytics/load'
import { supabaseAdmin } from '@/lib/supabase'
import { fromCall, fromSource, summarise, type Probe } from './probe'
import { probeAdminRowsPrivate, probePrerenderedPages, probeSitemap } from './public'
import { probeVolunteers } from './volunteers'

/**
 * Every read a Command Center page depends on, run once against production.
 * Read-only: nothing here writes to a source. Called by /api/cron/selfcheck
 * (GitHub workflow "Production check"), which is how anyone without access to
 * the live hosts can see which sections work.
 */
export async function runSelfCheck(now = new Date()) {
  const to = israelDate(now)
  const week = { from: addDays(to, -6), to }

  const [health, projects, deployments] = await Promise.all([allHealth(), getFurnitureProjects(), getDeployments()])
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
    // Public website (what visitors and crawlers get)
    probePrerenderedPages(env().website.url),
    probeAdminRowsPrivate(env().website.url),
    // Deeper reads behind the detail pages
    listWebsiteContent().then((r) => fromSource('website', 'Editable lists (menu, footer, team…)', r, (d) => `${d.items.filter((i) => i.list).length} list keys, ${d.items.length} keys in ${d.sections.length} sections`)),
    listWebsiteInquiries('all').then((r) => fromSource('website', 'Messages (all, site_inquiries)', r, (d) => `${d.inquiries.length} total`)),
    getGiftCardHealth().then((r) => fromSource('gift_cards', 'Deployed build', r, (d) => `commit ${String(d.commit ?? 'unknown')} branch ${String(d.branch ?? 'unknown')}`)),
    fromCall('gift_cards', 'Card search + card detail', async () => {
      const r = await searchGiftCards('')
      if (r.state !== 'ok') throw new Error(r.state === 'error' ? r.error : `needs ${r.missing.join(', ')}`)
      const first = r.data.items[0]
      if (!first) return `${r.data.total} cards (no card to open)`
      const d = await getGiftCard(first.id)
      if (!d || d.state !== 'ok') throw new Error(`detail: ${!d ? 'not found' : d.state === 'error' ? d.error : 'not configured'}`)
      return `${r.data.total} cards; detail opens (${d.data.delivery.length} delivery jobs)`
    }),
    firstProject
      ? getFurnitureProject(firstProject.id).then((r) =>
          r ? fromSource('furniture', 'Project page (apartments + items)', r, (d) => `${d.apartments.length} apartments, ${d.items.length} items${d.itemsCapped ? ' (capped)' : ''}`) : ({ section: 'furniture', name: 'Project page (apartments + items)', state: 'error', latencyMs: null, detail: 'first project not found' } as Probe),
        )
      : Promise.resolve<Probe>({ section: 'furniture', name: 'Project page (apartments + items)', state: 'not_configured', latencyMs: null, detail: 'no project to read' }),
    // Cross-cutting pages, read as an owner would
    fromCall('platform', 'Search (every source)', async () => {
      const groups = await searchEverything('a', () => true)
      const bad = groups.filter((g) => g.state === 'error')
      if (bad.length) throw new Error(bad.map((g) => `${g.label}: ${g.note ?? 'error'}`).join(' · '))
      return groups.map((g) => `${g.key} ${g.state}`).join(', ')
    }),
    fromCall('platform', 'Activity feed', async () => {
      const f = await activityFeed(() => true)
      // The standing note that two sources expose totals only is by design; a source that failed to read is not.
      const failed = f.gaps.filter((g) => !g.includes('expose totals only'))
      if (failed.length) throw new Error(`could not read: ${failed.join(' · ')}`)
      return `${f.items.length} items, every source read`
    }),
    fromCall('platform', 'Analytics (7 days)', async () => {
      const rep = await loadAnalytics(week, () => true)
      const sources = rep.sections.flatMap((x) => x.sources.map((src) => ({ product: x.product, ...src })))
      const bad = sources.filter((x) => x.state === 'error')
      if (bad.length) throw new Error(bad.map((x) => `${x.product} ${x.label}: ${x.detail}`).join(' · '))
      return `${rep.sections.length} sections, ${sources.length} sources, ${sources.filter((x) => x.state === 'not_configured').length} not connected`
    }),
    fromCall('platform', 'Assistant model key', async () => (env().assistant.apiKey ? `configured (${env().assistant.model})` : Promise.reject(new Error('ANTHROPIC_API_KEY missing')))),
    fromCall('platform', 'Scheduled report emails', async () => {
      const { data, error } = await supabaseAdmin().from('cc_sync_state').select('source,cursor,last_error').like('source', 'report:%')
      if (error) throw new Error(error.message)
      const failed = (data ?? []).filter((r) => r.last_error)
      if (failed.length) throw new Error(failed.map((r) => `${r.source}: ${r.last_error}`).join(' · '))
      // /api/cron/reports runs daily at 18:00 UTC and records report:daily even when nobody opted in.
      const daily = (data ?? []).find((r) => r.source === 'report:daily')
      if (daily && String(daily.cursor) < addDays(to, -2)) throw new Error(`daily report last ran for ${daily.cursor}: the Vercel cron /api/cron/reports is not running`)
      return data?.length ? data.map((r) => `${String(r.source).slice(7)} last ${r.cursor}`).join(', ') : 'none sent yet (Vercel cron 18:00 UTC)'
    }),
  ])
  probes.push(...(await probeSitemap(env().website.url)))
  probes.push(...(await probeVolunteers(now)))
  if (deployments.state === 'ok') {
    for (const p of deployments.data) {
      probes.push({
        section: 'platform',
        name: `Vercel · ${p.project}`,
        state: p.latestFailed ? 'error' : 'ok',
        latencyMs: null,
        detail: `live ${p.live?.sha ?? 'none'} (${p.live?.branch ?? '?'})${p.latestFailed ? `, newest deploy FAILED (${p.latest.sha ?? '?'})` : ''}`,
      })
    }
  }

  return {
    generatedAt: now.toISOString(),
    health: health.map((h) => ({ product: h.product, status: h.status, checks: h.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail.slice(0, 160) })) })),
    probes,
    summary: summarise(probes),
  }
}
