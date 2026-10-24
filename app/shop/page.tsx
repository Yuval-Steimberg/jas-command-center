import Link from 'next/link'
import { Suspense } from 'react'
import { ChevronLeft, PackagePlus, ScanLine, Search, ShoppingBag, Store, Truck } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can, ROLE_LABELS_HE, type Permission } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { getSalesStore } from '@/lib/sales/store'
import { saleMoney } from '@/lib/sales/model'
import { PayChip, Thumb } from '@/components/shop/bits'
import { formatAgorot } from '@/lib/money'
import { israelDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

export default async function ShopHome() {
  const s = (await getSession())!
  const may = (p: Permission) => can(s.user.role, p, s.overrides)

  const sell = may('inventory:financial')
  const tiles = [
    may('inventory:write') ? { href: '/shop/new', label: 'הוספת פריט', icon: PackagePlus } : null,
    { href: '/shop/scan', label: 'סריקת תווית', icon: ScanLine },
    { href: '/shop/items', label: 'חיפוש פריט', icon: Search },
  ].filter((x): x is NonNullable<typeof x> => !!x)

  // The tiles are what a seller came for: they render at once, and today's lists stream in after.
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">שלום, {s.user.name}</h1>
        <p className="text-sm text-muted">{ROLE_LABELS_HE[s.user.role]}</p>
      </div>
      <nav aria-label="פעולות" className="flex flex-col gap-3">
        {/* Selling is the counter's main job: the one full-width, orange action on the screen. */}
        {sell ? (
          <Link href="/shop/sell" className="flex min-h-20 items-center gap-4 rounded-lg bg-brand px-5 text-forest shadow-card transition-colors duration-150 hover:bg-brand-pressed hover:text-cream active:scale-[0.99]">
            <ShoppingBag aria-hidden className="h-8 w-8 shrink-0" />
            <span className="flex-1 text-lg font-bold">מכירה חדשה</span>
            <ChevronLeft aria-hidden className="h-6 w-6 shrink-0" />
          </Link>
        ) : null}
        <div className={`grid gap-3 ${tiles.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface p-3 text-center text-sm font-semibold text-ink transition-colors duration-150 hover:bg-sunken active:scale-[0.98]">
              <t.icon aria-hidden className="h-7 w-7 text-forest" strokeWidth={1.75} />{t.label}
            </Link>
          ))}
        </div>
      </nav>
      <Suspense fallback={<ShopListsSkeleton />}>
        <ShopToday money={sell} />
      </Suspense>
    </div>
  )
}

function ShopListsSkeleton() {
  return (
    <>
      <div className="h-24 animate-pulse rounded-lg border border-line bg-surface" />
      <div className="h-24 animate-pulse rounded-lg border border-line bg-surface" />
    </>
  )
}

function SectionHead({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-bold text-ink">
      {title}
      <span className="num inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sunken px-2 text-xs font-semibold text-muted">{count}</span>
    </h2>
  )
}

const israelTime = (iso: string) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

async function ShopToday({ money }: { money: boolean }) {
  const res = await loadOps(async () => {
    const st = getSalesStore()
    const day = israelDate()
    const [open, recent] = await Promise.all([st.openLines(100), st.listSales({ since: new Date(Date.now() - 36 * 3_600_000).toISOString(), limit: 300 })])
    const today = recent.filter((x) => israelDate(new Date(x.createdAt)) === day)
    const ids = [...new Set([...open.map((l) => l.saleId), ...today.map((x) => x.id)])]
    const itemIds = [...new Set(open.map((l) => l.itemId))]
    const [sales, lines, payments, items] = await Promise.all([
      st.listSales({ ids }),
      st.linesOf(today.map((x) => x.id)),
      st.paymentsOf(today.map((x) => x.id)),
      itemIds.length ? getOpsStore().listItems({ ids: itemIds, limit: itemIds.length }) : [],
    ])
    return { open, today, sales: new Map(sales.map((x) => [x.id, x])), lines, payments, items: new Map(items.map((i) => [i.id, i])) }
  })

  return (
    <>
      {!res.ok ? (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad" dir="auto">הרשימות של היום לא נטענו: {res.message}</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <SectionHead title="ממתין למסירה" count={res.data.open.length} />
            {res.data.open.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">אין פריטים שממתינים לאיסוף או למשלוח.</p> : (
              <ul className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-surface">
                {res.data.open.map((l) => {
                  const it = res.data.items.get(l.itemId)
                  const sale = res.data.sales.get(l.saleId)
                  return (
                    <li key={l.id}>
                      <Link href={`/shop/sales/${l.saleId}`} className="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-sunken">
                        <Thumb src={it?.photoUrl} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink" dir="auto">{it?.title ?? 'פריט'}{l.quantity > 1 ? ` ×${l.quantity}` : ''}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                            {l.fulfilment === 'delivery' ? <Truck aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <Store aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                            {l.fulfilment === 'delivery' ? `משלוח${l.scheduledFor ? ` · ${l.scheduledFor}` : ''}` : 'איסוף מהחנות'} · <span dir="ltr">{sale?.number}</span>
                          </span>
                        </span>
                        <ChevronLeft aria-hidden className="h-5 w-5 shrink-0 text-faint" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <SectionHead title="מכירות היום" count={res.data.today.length} />
            {res.data.today.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">עוד לא נרשמה מכירה היום.</p> : (
              <ul className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-surface">
                {res.data.today.map((sale) => {
                  const m = saleMoney(sale, res.data.lines.filter((l) => l.saleId === sale.id), res.data.payments.filter((p) => p.saleId === sale.id))
                  return (
                    <li key={sale.id}>
                      <Link href={`/shop/sales/${sale.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 text-sm hover:bg-sunken">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-ink" dir="ltr">{sale.number}</span>
                          <span className="text-xs text-muted">{israelTime(sale.createdAt)}</span>
                        </span>
                        <PayChip state={m.state} />
                        {money ? <span className="num w-20 text-end font-semibold text-ink">{formatAgorot(m.dueMinor)}</span> : null}
                        <ChevronLeft aria-hidden className="h-5 w-5 shrink-0 text-faint" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  )
}
