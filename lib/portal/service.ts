import 'server-only'
import { cache } from 'react'
import { env } from '@/lib/env'
import { OpsSetupError } from '@/lib/ops/store'
import type { AppUrls, PortalData } from './model'
import { getPortalStore } from './store'
import { seedData } from './seed'

/** The JAS apps' addresses, from the settings this deployment already has. */
export function appUrls(): AppUrls {
  const e = env()
  return {
    furniture: e.furniture.appUrl,
    volunteers: e.volunteers.appUrl,
    website: e.website.url,
    map: e.map.siteUrl,
    gift_cards: e.giftCards.url,
  }
}

export interface PortalLoad {
  data: PortalData
  /**
   * Set when the registry could not be read. Until migration 0014 runs, the
   * portal shows the built-in first set (so the home page never breaks) and
   * link management says what to run; any other failure is said as it is.
   */
  problem: { kind: 'setup' | 'error'; message: string } | null
}

/** One read per request, shared by the layout, the page and the search. */
export const loadPortal = cache(async (): Promise<PortalLoad> => {
  try {
    return { data: await getPortalStore().load(), problem: null }
  } catch (e) {
    if (e instanceof OpsSetupError) return { data: seedData(), problem: { kind: 'setup', message: e.message } }
    console.error('portal registry read failed', e)
    return { data: seedData(), problem: { kind: 'error', message: e instanceof Error ? e.message : String(e) } }
  }
})
