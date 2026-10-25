/**
 * An item's measurements as four numbers (cm) in the form, one text column in
 * the database. The column stays text on purpose: the website, the field app's
 * intake and every existing row already speak it. `formatDimensions` writes
 * one canonical line; `parseDimensions` reads it back, and keeps whatever it
 * cannot place (an old free-text "120x60", "approx.") in `note`, so nothing an
 * existing item says is lost by opening and saving it.
 */
export interface Dimensions {
  length: string
  width: string
  height: string
  diameter: string
  note: string
}

export const DIMENSION_KEYS = ['length', 'width', 'height', 'diameter'] as const
export type DimensionKey = (typeof DIMENSION_KEYS)[number]

export const DIMENSION_LABELS: Record<DimensionKey, { he: string; en: string }> = {
  length: { he: 'אורך', en: 'Length' },
  width: { he: 'רוחב', en: 'Width' },
  height: { he: 'גובה', en: 'Height' },
  diameter: { he: 'קוטר', en: 'Diameter' },
}

export const EMPTY_DIMENSIONS: Dimensions = { length: '', width: '', height: '', diameter: '', note: '' }

const UNIT = 'ס״מ'
const NUM = /^\d{1,5}(?:\.\d{1,2})?$/

/** A typed measurement, normalised ("120,5" → "120.5"); '' when blank or not a positive number. */
export function cleanMeasure(raw: string): string {
  const s = raw.trim().replace(',', '.')
  if (!NUM.test(s)) return ''
  const n = Number(s)
  return n > 0 ? String(n) : ''
}

export function formatDimensions(d: Dimensions): string {
  const parts = DIMENSION_KEYS.flatMap((k) => (cleanMeasure(d[k]) ? [`${DIMENSION_LABELS[k].he} ${cleanMeasure(d[k])}`] : []))
  const main = parts.length ? `${parts.join(' · ')} ${UNIT}` : ''
  const note = d.note.replace(/\s+/g, ' ').trim()
  return [main, note].filter(Boolean).join(' · ').slice(0, 200)
}

export function parseDimensions(text: string | null | undefined): Dimensions {
  const out: Dimensions = { ...EMPTY_DIMENSIONS }
  let rest = (text ?? '').trim()
  if (!rest) return out
  for (const k of DIMENSION_KEYS) {
    const re = new RegExp(`${DIMENSION_LABELS[k].he}\\s*:?\\s*(\\d{1,5}(?:[.,]\\d{1,2})?)`)
    const m = rest.match(re)
    if (m) {
      out[k] = cleanMeasure(m[1] ?? '')
      rest = rest.replace(m[0], ' ')
    }
  }
  // Nothing labelled (an old "120x60x75"): keep it exactly as written. Guessing which number is which would be worse.
  if (!DIMENSION_KEYS.some((k) => out[k])) return { ...out, note: rest.slice(0, 200) }
  out.note = rest.replace(new RegExp(`${UNIT}|ס"מ|ס''מ`, 'g'), ' ').replace(/^[\s·•|,]+|[\s·•|,]+$/g, '').replace(/\s*·\s*(·\s*)+/g, ' · ').replace(/\s+/g, ' ').trim()
  return out
}
