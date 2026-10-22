/**
 * Money. The gift card system stores integer agorot; the website stores ₪ as
 * numeric(10,2). Everything is normalised to integer agorot before it is
 * compared or summed, and rounding happens exactly once, here.
 */
export type Agorot = number & { readonly __agorot?: true }

export function shekelsToAgorot(shekels: number): Agorot {
  if (!Number.isFinite(shekels)) throw new Error('not a finite amount')
  return Math.round(shekels * 100) as Agorot
}

const fmt = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2, minimumFractionDigits: 0 })
const fmtWhole = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

export function formatAgorot(a: number, opts: { whole?: boolean } = {}): string {
  return (opts.whole ? fmtWhole : fmt).format(a / 100)
}
