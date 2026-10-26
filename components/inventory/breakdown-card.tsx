import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'
import { BREAKDOWNS, breakdownTotals, type Breakdown } from '@/lib/inventory/breakdown'
import { BREAKDOWN_DAYS, type BreakdownDays, type BreakdownView } from '@/lib/inventory/breakdown-view'

const COPY = {
  en: {
    title: 'Stock and sales by group',
    meta: (d: string) => `Stock is now · sales are ${d.toLowerCase()}`,
    groups: { category: 'Category', colour: 'Main colour', renewal: 'Renewal level' } as Record<Breakdown, string>,
    days: { '30': 'Last 30 days', '90': 'Last 90 days', '365': 'Last 12 months', all: 'All time' } as Record<BreakdownDays, string>,
    groupBy: 'Group by', period: 'Sales period',
    cols: ['In stock', 'In the shop', 'Sold in shop', 'Shop sales', 'Sold online'],
    total: 'Total', empty: 'No stock and no sales yet.',
    note: (shopKnown: boolean) => `Units. In stock = in storage or listed, wherever it is; in the shop = of those, the ones at the shop location${shopKnown ? '' : ' (no location named חנות yet, so not shown)'}. Shop sales are what customers paid, after discounts and returns. Online sales are counted only: their money is in the website's revenue. A sale is grouped by what the item says now; colour is the main (first) colour with spellings merged. Website-only products that never came into inventory are not here.`,
    capped: ' More records than one read returns: numbers may be low.',
  },
  he: {
    title: 'מלאי ומכירות לפי קבוצה',
    meta: (d: string) => `מלאי נכון לעכשיו · מכירות ב${d}`,
    groups: { category: 'קטגוריה', colour: 'צבע', renewal: 'רמת חידוש' } as Record<Breakdown, string>,
    days: { '30': '30 ימים', '90': '90 ימים', '365': '12 חודשים', all: 'מאז ומעולם' } as Record<BreakdownDays, string>,
    groupBy: 'קיבוץ לפי', period: 'תקופת מכירות',
    cols: ['במלאי', 'בחנות', 'נמכרו בחנות', 'סכום בחנות', 'נמכרו באתר'],
    total: 'סה״כ', empty: 'עוד אין מלאי ואין מכירות.',
    note: (shopKnown: boolean) => `ביחידות. במלאי = במחסן או באתר, בכל מקום; בחנות = מתוכן, אלה שהמיקום שלהן הוא החנות${shopKnown ? '' : ' (אין עדיין מיקום בשם חנות)'}. סכום בחנות = מה שהלקוחות שילמו, אחרי הנחות והחזרות. מכירות באתר נספרות בלבד: הכסף שלהן בהכנסות האתר. מכירה משויכת לפי מה שכתוב על הפריט עכשיו; צבע = הצבע הראשון, כתיבים שונים מאוחדים.`,
    capped: ' יש יותר רשומות ממה שנקרא בבת אחת: המספרים עשויים להיות נמוכים.',
  },
}

const chip = (on: boolean) => cn('inline-flex min-h-11 items-center rounded-full border px-3 text-sm', on ? 'border-forest bg-forest font-medium text-cream' : 'border-line text-muted hover:bg-sunken hover:text-ink')

/** Stock now and sales in a period, per category / main colour / renewal level (`lib/inventory/breakdown.ts`). /inventory in English, /shop/items in Hebrew. */
export function BreakdownCard({ view, path, keep = {}, lang = 'en', className }: { view: BreakdownView; path: string; keep?: Record<string, string>; lang?: 'en' | 'he'; className?: string }) {
  const { rows, by, days, shopKnown, capped } = view
  const t = COPY[lang]
  const href = (next: { by?: Breakdown; days?: BreakdownDays }) => {
    const p = new URLSearchParams(Object.entries({ ...keep, by: next.by ?? by, days: next.days ?? days }).filter(([, v]) => v))
    return `${path}?${p}#by-group`
  }
  const sum = breakdownTotals(rows)
  const num = cn('py-2 text-end', lang === 'en' ? 'ps-3' : 'ps-1.5')
  const money = (m: number) => (m ? formatAgorot(m, { whole: true }) : '—')
  return (
    <Card className={className}>
      <span id="by-group" className="block scroll-mt-20" />
      <CardHeader title={t.title} meta={t.meta(t.days[days])} />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <nav aria-label={t.groupBy} className="flex flex-wrap gap-2">
            {BREAKDOWNS.map((b) => <Link key={b} href={href({ by: b })} aria-current={b === by ? 'true' : undefined} className={chip(b === by)}>{t.groups[b]}</Link>)}
          </nav>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <nav aria-label={t.period} className="flex flex-wrap gap-2">
            {BREAKDOWN_DAYS.map((d) => <Link key={d} href={href({ days: d })} aria-current={d === days ? 'true' : undefined} className={chip(d === days)}>{t.days[d]}</Link>)}
          </nav>
        </div>
        {!rows.length ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full text-sm', lang === 'en' && 'min-w-[560px]')}>
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 pe-3 text-start font-medium">{t.groups[by]}</th>
                  {t.cols.map((c) => <th key={c} className={cn('py-2 text-end align-bottom font-medium', lang === 'en' ? 'ps-3' : 'ps-1.5 leading-tight')}>{c}</th>)}
                </tr>
              </thead>
              <tbody className="num divide-y divide-line/60">
                {rows.map((r) => (
                  <tr key={r.group}>
                    <td className="py-2 pe-3 text-start"><bdi>{r.group}</bdi></td>
                    <td className={cn(num, 'font-medium')}>{formatCount(r.stock)}</td>
                    <td className={cn(num, 'text-muted')}>{shopKnown ? formatCount(r.inShop) : '—'}</td>
                    <td className={num}>{formatCount(r.soldInShop)}</td>
                    <td className={num}>{money(r.shopValueMinor)}</td>
                    <td className={cn(num, 'text-muted')}>{formatCount(r.soldOnline)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="num border-t border-line font-semibold">
                <tr>
                  <td className="py-2 pe-3 text-start">{t.total}</td>
                  <td className={num}>{formatCount(sum.stock)}</td>
                  <td className={num}>{shopKnown ? formatCount(sum.inShop) : '—'}</td>
                  <td className={num}>{formatCount(sum.soldInShop)}</td>
                  <td className={num}>{money(sum.shopValueMinor)}</td>
                  <td className={num}>{formatCount(sum.soldOnline)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">{t.note(shopKnown)}{capped ? t.capped : ''}</p>
      </CardBody>
    </Card>
  )
}
