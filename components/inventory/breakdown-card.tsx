import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'
import { BREAKDOWNS, BREAKDOWN_LABEL, breakdownTotals, type Breakdown, type BreakdownRow } from '@/lib/inventory/breakdown'

export const BREAKDOWN_DAYS = ['30', '90', '365', 'all'] as const
type Days = (typeof BREAKDOWN_DAYS)[number]
const DAYS_LABEL: Record<Days, string> = { '30': 'Last 30 days', '90': 'Last 90 days', '365': 'Last 12 months', all: 'All time' }

const chip = (on: boolean) => cn('inline-flex min-h-9 items-center rounded-full border px-3 text-sm', on ? 'border-forest bg-forest font-medium text-cream' : 'border-line text-muted hover:bg-sunken hover:text-ink')

/** /inventory: stock now and sales in a period, per category / main colour / renewal level (`lib/inventory/breakdown.ts`). */
export function BreakdownCard({ rows, by, days, shopKnown, capped, keep }: { rows: BreakdownRow[]; by: Breakdown; days: Days; shopKnown: boolean; capped: boolean; keep: Record<string, string> }) {
  const href = (next: { by?: Breakdown; days?: Days }) => {
    const p = new URLSearchParams(Object.entries({ ...keep, by: next.by ?? by, days: next.days ?? days }).filter(([, v]) => v))
    return `/inventory?${p}#by-group`
  }
  const t = breakdownTotals(rows)
  return (
    <Card className="mb-4">
      <span id="by-group" className="block scroll-mt-20" />
      <CardHeader title="Stock and sales by group" meta={`Stock is now · sales are ${DAYS_LABEL[days].toLowerCase()}`} />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <nav aria-label="Group by" className="flex flex-wrap gap-2">
            {BREAKDOWNS.map((b) => <Link key={b} href={href({ by: b })} aria-current={b === by ? 'true' : undefined} className={chip(b === by)}>{BREAKDOWN_LABEL[b]}</Link>)}
          </nav>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <nav aria-label="Sales period" className="flex flex-wrap gap-2">
            {BREAKDOWN_DAYS.map((d) => <Link key={d} href={href({ days: d })} aria-current={d === days ? 'true' : undefined} className={chip(d === days)}>{DAYS_LABEL[d]}</Link>)}
          </nav>
        </div>
        {!rows.length ? (
          <p className="text-sm text-muted">No stock and no sales yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 pe-3 text-start font-medium">{BREAKDOWN_LABEL[by]}</th>
                  <th className="py-2 ps-3 text-end font-medium">In stock</th>
                  <th className="py-2 ps-3 text-end font-medium">In the shop</th>
                  <th className="py-2 ps-3 text-end font-medium">Sold in shop</th>
                  <th className="py-2 ps-3 text-end font-medium">Shop sales</th>
                  <th className="py-2 ps-3 text-end font-medium">Sold online</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-line/60">
                {rows.map((r) => (
                  <tr key={r.group}>
                    <td className="py-2 pe-3 text-start"><bdi>{r.group}</bdi></td>
                    <td className="py-2 ps-3 text-end font-medium">{formatCount(r.stock)}</td>
                    <td className="py-2 ps-3 text-end text-muted">{shopKnown ? formatCount(r.inShop) : '—'}</td>
                    <td className="py-2 ps-3 text-end">{formatCount(r.soldInShop)}</td>
                    <td className="py-2 ps-3 text-end">{r.shopValueMinor ? formatAgorot(r.shopValueMinor, { whole: true }) : '—'}</td>
                    <td className="py-2 ps-3 text-end text-muted">{formatCount(r.soldOnline)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="num border-t border-line font-semibold">
                <tr>
                  <td className="py-2 pe-3 text-start">Total</td>
                  <td className="py-2 ps-3 text-end">{formatCount(t.stock)}</td>
                  <td className="py-2 ps-3 text-end">{shopKnown ? formatCount(t.inShop) : '—'}</td>
                  <td className="py-2 ps-3 text-end">{formatCount(t.soldInShop)}</td>
                  <td className="py-2 ps-3 text-end">{t.shopValueMinor ? formatAgorot(t.shopValueMinor, { whole: true }) : '—'}</td>
                  <td className="py-2 ps-3 text-end">{formatCount(t.soldOnline)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Units. In stock = in storage or listed, wherever it is; in the shop = of those, the ones at the shop location{shopKnown ? '' : ' (no location named חנות yet, so not shown)'}. Shop sales are what customers paid, after discounts and returns. Online sales are counted only: their money is in the website&apos;s revenue. A sale is grouped by what the item says now; colour is the main (first) colour with spellings merged. Website-only products that never came into inventory are not here.
          {capped ? ' More records than one read returns: numbers may be low.' : ''}
        </p>
      </CardBody>
    </Card>
  )
}
