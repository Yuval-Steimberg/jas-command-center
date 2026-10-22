import 'server-only'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import { getGiftCardSales, getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getDesignAgentActivity, getDesignAgentHealthz } from '@/lib/integrations/design-agent/adapter'
import { previousPeriod, type DateRange } from '@/lib/time'
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
  return { range, previous, generatedAt: new Date().toISOString(), sections: await Promise.all(jobs) }
}
