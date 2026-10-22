/**
 * Pure matching for cross-system search. Hebrew and English: case, Hebrew
 * niqqud/cantillation, Latin accents and geresh/quote marks are ignored, and
 * every word of the query must appear somewhere in the entry.
 */
export interface SearchDoc {
  title: string
  subtitle?: string | null
  href: string
  /** Extra text that can match but is not shown (city, category, address…). */
  text?: (string | null | undefined)[]
}

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-֑ͯ-ׇ]/g, '')
    .replace(/[׳״'"`׳״]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export const MIN_QUERY = 2
export const MAX_QUERY = 100

export function matchDocs<T extends SearchDoc>(docs: readonly T[], query: string, limit = 10): T[] {
  const q = normalize(query)
  if (q.length < MIN_QUERY) return []
  const words = q.split(' ')
  const scored: { doc: T; score: number }[] = []
  for (const doc of docs) {
    const title = normalize(doc.title)
    const all = normalize([doc.title, doc.subtitle, ...(doc.text ?? [])].filter(Boolean).join(' '))
    if (!words.every((w) => all.includes(w))) continue
    const score = title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : words.every((w) => title.includes(w)) ? 3 : 4
    scored.push({ doc, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.doc.title.localeCompare(b.doc.title)).slice(0, limit).map((s) => s.doc)
}
