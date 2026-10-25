/**
 * The shop's item categories, in the owner's order (2026-10-25). The form
 * picks from this list and the photo AI must answer with one of them, so the
 * same piece is never filed as "כורסא" on one card and "כורסה" on the next.
 * An older item keeps whatever category it already has until someone edits it.
 */
export const ITEM_CATEGORIES = ['כלי בית', 'כיסא', 'ספסל', 'שולחן סלון', 'שולחן אוכל', 'תמונה', 'ספה', 'כורסה', 'שידה', 'מזנון', 'ארונית', 'שולחן צד', 'קונסולה', 'אחר'] as const
export type ItemCategory = (typeof ITEM_CATEGORIES)[number]

const norm = (s: string) => s.replace(/[֑-ׇ]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').trim()
const ALIASES: Record<string, ItemCategory> = { כורסא: 'כורסה', כסא: 'כיסא', ארון: 'ארונית', מדף: 'ארונית', 'שולחן קפה': 'שולחן סלון', מראה: 'תמונה', 'כלי מטבח': 'כלי בית' }

/** The list entry a free-text category means, or null (the AI said something off the list). */
export function toItemCategory(raw: string | null | undefined): ItemCategory | null {
  const s = norm(raw ?? '')
  if (!s) return null
  const hit = ITEM_CATEGORIES.find((c) => norm(c) === s)
  return hit ?? ALIASES[s] ?? null
}
