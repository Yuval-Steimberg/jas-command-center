import type { Condition, RenewalLevel } from '@/lib/ops/types'
import { RENEWAL_LEVELS } from '@/lib/ops/types'

/** The shop's renewal scale (רמת חידוש), labelled the way the shop says it. */
export const RENEWAL_LABEL_HE: Record<RenewalLevel, string> = { 0: 'גראז׳', 1: 'As is', 2: 'שיפוץ קל', 3: 'חידוש משמעותי', 4: 'קומבינציה' }
export const RENEWAL_LABEL: Record<RenewalLevel, string> = { 0: 'Garage', 1: 'As is', 2: 'Light refurbishment', 3: 'Major refurbishment', 4: 'Combination' }

export function isRenewalLevel(v: unknown): v is RenewalLevel {
  return typeof v === 'number' && (RENEWAL_LEVELS as readonly number[]).includes(v)
}

/** "2" → 2; anything else (blank, "x", "7") → null. */
export function parseRenewalLevel(raw: unknown): RenewalLevel | null {
  const s = String(raw ?? '').trim()
  if (!/^\d$/.test(s)) return null
  const n = Number(s)
  return isRenewalLevel(n) ? n : null
}

/**
 * The item's `condition` follows its renewal level, because the website's
 * condition and the reports still read `condition`. A garage piece is sold
 * as found (website "fair"), a major refurbishment is as good as new
 * (website "excellent"), everything else is "good".
 */
export const CONDITION_OF_RENEWAL: Record<RenewalLevel, Condition> = { 0: 'needs_repair', 1: 'good', 2: 'good', 3: 'as_new', 4: 'good' }

export function renewalLabel(level: RenewalLevel | null | undefined, lang: 'he' | 'en'): string | null {
  if (level == null || !isRenewalLevel(level)) return null
  return `${level} · ${(lang === 'he' ? RENEWAL_LABEL_HE : RENEWAL_LABEL)[level]}`
}
