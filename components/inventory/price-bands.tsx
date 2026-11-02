import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'
import type { PriceBandView } from '@/lib/inventory/breakdown'

const COPY = {
  en: { units: (n: number) => `${formatCount(n)} ${n === 1 ? 'unit' : 'units'}`, each: (n: number) => `×${formatCount(n)}`, none: 'No items in this range.', empty: 'Nothing to show yet.', items: 'Items' },
  he: { units: (n: number) => (n === 1 ? 'פריט אחד' : `${formatCount(n)} פריטים`), each: (n: number) => `${formatCount(n)} יח׳`, none: 'אין פריטים בטווח הזה.', empty: 'אין עדיין מה להציג.', items: 'פריטים' },
}

/**
 * Price ranges (`priceBands` in `lib/inventory/breakdown.ts`): share of units, count, and the items
 * in each range behind a disclosure. Ranges stay in price order (a scale, never sorted by count).
 * `showPrice` = print each item's price; shop mode's sales view leaves it off (count-only).
 */
export function PriceBands({ bands, itemHref, lang = 'he', showPrice = true, className }: { bands: PriceBandView[]; itemHref: (id: string) => string; lang?: 'en' | 'he'; showPrice?: boolean; className?: string }) {
  const t = COPY[lang]
  const total = bands.reduce((a, b) => a + b.units, 0)
  if (!total) return <p className={cn('rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted', className)}>{t.empty}</p>
  return (
    <ul className={cn('flex flex-col divide-y divide-line/60 rounded-lg border border-line bg-surface', className)}>
      {bands.map((b) => (
        <li key={b.band}>
          <details className="group">
            {/* `!grid` and `after:!hidden`: shop mode styles every summary as a flex row with its own chevron (globals.css). */}
            <summary className="!grid min-h-12 after:!hidden cursor-pointer list-none grid-cols-[6.5rem_1fr_auto_auto] items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
              <span className="font-medium text-ink" dir="rtl"><bdi>{b.band}</bdi></span>
              <span className="h-3 overflow-hidden rounded-full bg-sunken" aria-hidden><span className="block h-full rounded-full bg-sage" style={{ width: `${b.units ? Math.max(4, b.percent) : 0}%` }} /></span>
              <span className="num min-w-[7.5rem] text-end"><span className="font-semibold text-ink">{b.percent}%</span> <span className="text-muted">· {t.units(b.units)}</span></span>
              <ChevronDown aria-hidden className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            {b.items.length === 0 ? <p className="px-3 pb-3 text-sm text-muted">{t.none}</p> : (
              <ul aria-label={`${t.items} · ${b.band}`} className="flex flex-col gap-1 px-3 pb-3 text-sm">
                {b.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3">
                    <Link href={itemHref(i.id)} className="min-w-0 truncate text-ink underline-offset-2 hover:underline" dir="auto">
                      {i.sku ? <span className="font-mono text-xs text-muted">{i.sku} · </span> : null}{i.title}
                    </Link>
                    <span className="num flex shrink-0 gap-2 text-muted">
                      {i.units > 1 ? <span>{t.each(i.units)}</span> : null}
                      {showPrice && i.unitPriceMinor ? <span dir="ltr">{formatAgorot(i.unitPriceMinor, { whole: true })}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </li>
      ))}
    </ul>
  )
}
