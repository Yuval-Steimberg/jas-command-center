import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ShoppingBag } from 'lucide-react'
import { PayChip } from '@/components/shop/bits'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { recentSales } from '@/lib/sales/views'
import { formatAgorot } from '@/lib/money'
import { formatDayTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

/** מכירות: start a sale, and the newest sales with what is still owed or still to hand over. */
export default async function ShopSalesPage() {
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  if (!may('inventory:financial')) redirect('/shop')
  const res = await loadOps(() => recentSales({ crm: may('crm:read'), pii: may('crm:read_pii'), limit: 100 }, 'לקוח/ה'))
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-ink">מכירות</h1>
      <Link href="/shop/sell" className="flex min-h-16 items-center gap-4 rounded-lg bg-brand px-5 text-forest shadow-card transition-colors duration-150 hover:bg-brand-pressed hover:text-cream active:scale-[0.99]">
        <ShoppingBag aria-hidden className="h-7 w-7 shrink-0" />
        <span className="flex-1 text-lg font-bold">מכירה חדשה</span>
        <ChevronLeft aria-hidden className="h-6 w-6 shrink-0" />
      </Link>
      {!res.ok ? <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p> : res.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">עוד לא נרשמה מכירה.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-surface">
          {res.data.map(({ sale, money, units, openLines, customer }) => (
            <li key={sale.id}>
              <Link href={`/shop/sales/${sale.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2 text-sm hover:bg-sunken">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 whitespace-nowrap font-semibold text-ink" dir="ltr">{sale.number}</span>
                    <span className="truncate text-muted" dir="auto">{customer ?? 'לקוח/ה מזדמן/ת'}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    <span className="num" dir="ltr">{formatDayTime(sale.createdAt)}</span> · {units === 1 ? 'פריט אחד' : `${units} פריטים`}
                  </span>
                  {openLines ? <span className="mt-0.5 block text-xs text-warn">{openLines === 1 ? 'ממתין למסירה' : `${openLines} ממתינים למסירה`}</span> : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num font-semibold text-ink">{formatAgorot(money.dueMinor)}</span>
                  <PayChip state={money.state} />
                </span>
                <ChevronLeft aria-hidden className="h-5 w-5 shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
