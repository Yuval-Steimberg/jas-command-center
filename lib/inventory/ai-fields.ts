import { z } from 'zod'

/** What the photo AI returns. Pure (no SDK), so tests pin the parsing. */
export interface PhotoFields {
  title: string
  category: string
  colors: string[]
  material: string
  description: string
  /** Whole shekels; a rough estimate a person always confirms or overrides. */
  suggestedPriceIls: number | null
}

export const PHOTO_PROMPT = [
  'You help a Tel Aviv creative-reuse shop (Just A Second) take second-hand and upcycled furniture into inventory.',
  'You get ONE photo of ONE piece. Every piece is one of a kind.',
  'Answer in Hebrew, except numbers:',
  '- title: a short name for the piece (2–5 words), e.g. "כורסת עור וינטג׳".',
  '- category: one short category, e.g. ספה, כורסא, שולחן אוכל, כיסא, שידה, ארון, מדף, מנורה, אחר.',
  '- colors: the main colour first, at most three.',
  '- material: the main material, e.g. עץ אלון, עץ מלא, סנדוויץ׳, בד, עור, מתכת, ראטן.',
  '- description: one or two plain sentences a buyer would find useful. No exclamation marks, no emoji, no claims you cannot see (age, brand, provenance).',
  '- suggested_price_ils: a realistic second-hand shop price in whole shekels for Tel Aviv, or null if the photo does not show a piece of furniture.',
].join('\n')

export const PHOTO_FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'category', 'colors', 'material', 'description', 'suggested_price_ils'],
  properties: {
    title: { type: 'string' },
    category: { type: 'string' },
    colors: { type: 'array', items: { type: 'string' } },
    material: { type: 'string' },
    description: { type: 'string' },
    suggested_price_ils: { type: ['integer', 'null'] },
  },
} as const

const shape = z.object({
  title: z.string(),
  category: z.string(),
  colors: z.array(z.string()),
  material: z.string(),
  description: z.string(),
  suggested_price_ils: z.number().nullable(),
})

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

/** Defensive: tolerates stray fences or text around the JSON; null when it cannot be read. */
export function parsePhotoFields(text: string): PhotoFields | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const p = shape.safeParse(raw)
  if (!p.success) return null
  const price = p.data.suggested_price_ils
  return {
    title: clip(p.data.title, 200),
    category: clip(p.data.category, 100),
    colors: p.data.colors.map((c) => clip(c, 40)).filter(Boolean).slice(0, 3),
    material: clip(p.data.material, 200),
    description: clip(p.data.description, 2000),
    suggestedPriceIls: price != null && Number.isFinite(price) && price > 0 && price < 1_000_000 ? Math.round(price) : null,
  }
}
