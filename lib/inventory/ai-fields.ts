import { z } from 'zod'
import { ITEM_CATEGORIES, toItemCategory } from './categories'

/** What the photo AI returns. Pure (no SDK), so tests pin the parsing. */
export interface PhotoFields {
  title: string
  category: string
  colors: string[]
  material: string
  description: string
  /** Whole shekels; a rough estimate a person always confirms or overrides. */
  suggestedPriceIls: number | null
  /** Whole cm, estimated from the photo (no tape measure): a person measures before trusting them. */
  dimensionsCm: { length: number | null; width: number | null; height: number | null; diameter: number | null }
}

export const PHOTO_PROMPT = [
  'You help a Tel Aviv creative-reuse shop (Just A Second) take second-hand and upcycled furniture into inventory.',
  'You get ONE photo of ONE piece. Every piece is one of a kind.',
  'Answer in Hebrew, except numbers:',
  '- title: a short name for the piece (2–5 words), e.g. "כורסת עור וינטג׳".',
  `- category: exactly one of: ${ITEM_CATEGORIES.join(', ')}. Use אחר when none fits.`,
  '- colors: the main colour first, at most three.',
  '- material: the main material, e.g. עץ אלון, עץ מלא, סנדוויץ׳, בד, עור, מתכת, ראטן.',
  '- description: one or two plain sentences a buyer would find useful. No exclamation marks, no emoji, no claims you cannot see (age, brand, provenance).',
  '- length_cm, width_cm, height_cm, diameter_cm: your best estimate in whole centimetres from the photo and typical sizes of such a piece. Use diameter_cm only for a round piece (round table, lamp shade, mirror), and then leave length_cm/width_cm null. null for any measure that does not apply or that you cannot estimate.',
  '- suggested_price_ils: a realistic second-hand shop price in whole shekels for Tel Aviv, or null if the photo does not show a piece of furniture.',
].join('\n')

export const PHOTO_FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'category', 'colors', 'material', 'description', 'length_cm', 'width_cm', 'height_cm', 'diameter_cm', 'suggested_price_ils'],
  properties: {
    title: { type: 'string' },
    category: { type: 'string', enum: [...ITEM_CATEGORIES] },
    colors: { type: 'array', items: { type: 'string' } },
    material: { type: 'string' },
    description: { type: 'string' },
    length_cm: { type: ['integer', 'null'] },
    width_cm: { type: ['integer', 'null'] },
    height_cm: { type: ['integer', 'null'] },
    diameter_cm: { type: ['integer', 'null'] },
    suggested_price_ils: { type: ['integer', 'null'] },
  },
} as const

const shape = z.object({
  title: z.string(),
  category: z.string(),
  colors: z.array(z.string()),
  material: z.string(),
  description: z.string(),
  // Optional so an answer from before these fields existed still parses.
  length_cm: z.number().nullable().optional(),
  width_cm: z.number().nullable().optional(),
  height_cm: z.number().nullable().optional(),
  diameter_cm: z.number().nullable().optional(),
  suggested_price_ils: z.number().nullable(),
})

const cm = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 && n < 10_000 ? Math.round(n) : null)

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
    category: toItemCategory(p.data.category) ?? 'אחר',
    colors: p.data.colors.map((c) => clip(c, 40)).filter(Boolean).slice(0, 3),
    material: clip(p.data.material, 200),
    description: clip(p.data.description, 2000),
    suggestedPriceIls: price != null && Number.isFinite(price) && price > 0 && price < 1_000_000 ? Math.round(price) : null,
    dimensionsCm: { length: cm(p.data.length_cm), width: cm(p.data.width_cm), height: cm(p.data.height_cm), diameter: cm(p.data.diameter_cm) },
  }
}
