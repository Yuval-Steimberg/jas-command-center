import 'server-only'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import { getGiftCardSales, getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getDesignAgentActivity, getDesignAgentHealthz } from '@/lib/integrations/design-agent/adapter'
import { previousPeriod, type DateRange } from '@/lib/time'
import { crmSection, inventorySection, type OpsRead } from './ops'
import { getOpsStore, OpsSetupError } from '@/lib/ops'
import { volunteersSection, type VolunteerRead } from './volunteers'
import { loadVolunteerWindow } from '@/lib/volunteer-store'
import { designAgentSection, furnitureSection, giftCardsSection, websiteSection, type AnalyticsReport, type Section } from './model'

/**
 * Reads every source the user may see, in parallel, and builds the report.
 * A product the user cannot read is not fetched at all (not fetched, then hidden).
 */
export async function loadAnalytics(range: DateRange, canRead: (p: Section['product']) => boolean): Promise<AnalyticsReport> {
  const previous = previousPeriod(range)
  const jobs: Promise<Section>[] = []
  if (canRead('website')) jobs.push(getWebsiteSnapshot(range).then(websiteSection))
  if (canRead('gift_cards')) jobs.push(Promise.all([getGiftCardSales(range), getGiftCardSummary()]).then(([a, b]) => giftCardsSection(a, b)))
  if (canRead('furniture')) jobs.push(getFurnitureProjects().then((r) => furnitureSection(r, range, previous)))
  if (canRead('design_agent'))
    jobs.push(Promise.all([getDesignAgentActivity(range), getDesignAgentActivity(previous), getDesignAgentHealthz()]).then(([a, b, c]) => designAgentSection(a, b, c)))
  if (canRead('inventory') || canRead('crm')) {
    const ops = readOps(previous.from)
    if (canRead('inventory')) jobs.push(ops.then((r) => inventorySection(r, range, previous)))
    if (canRead('crm')) jobs.push(ops.then((r) => crmSection(r, range, previous)))
  }
  if (canRead('volunteers')) jobs.push(readVolunteers().then((r) => volunteersSection(r, range, previous)))
  return { range, previous, generatedAt: new Date().toISOString(), sections: await Promise.all(jobs) }
}

const CAP = 5000

export async function readOps(since: string): Promise<OpsRead> {
  try {
    const store = getOpsStore()
    const [items, movements, deals, contacts, locations] = await Promise.all([
      store.listItems({ limit: CAP }),
      store.recentMovements(CAP, `${since}T00:00:00+02:00`),
      store.listDeals({ limit: CAP }),
      store.listContacts({ limit: CAP }),
      store.listLocations(),
    ])
    // PostgREST caps a response (often at 1000 rows): a full page means there may be more.
    const truncated = [items, movements, deals, contacts].some((x) => x.length >= 1000)
    return { state: 'ok', data: { items, movements, deals, contacts, locations, truncated }, checkedAt: new Date().toISOString() }
  } catch (e) {
    return e instanceof OpsSetupError ? { state: 'not_configured', detail: 'run migration 0003_crm_inventory.sql' } : { state: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

/** All volunteer history: "first-time" and "active in 90 days" need more than the selected window. */
export async function readVolunteers(): Promise<VolunteerRead> {
  try {
    const d = await loadVolunteerWindow('2000-01-01T00:00:00Z', new Date(Date.now() + 400 * 86_400_000).toISOString())
    return { state: 'ok', data: { volunteers: d.volunteers, activities: d.activities, shifts: d.shifts, signups: d.signups }, checkedAt: new Date().toISOString() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return /0005_volunteers/.test(msg) ? { state: 'not_configured', detail: 'run migration 0005_volunteers.sql' } : { state: 'error', detail: msg }
  }
}
