import Link from 'next/link'
import { PackagePlus, ScanLine, Search, ShoppingBag } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can, type Permission } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { getSalesStore } from '@/lib/sales/store'
import { saleMoney } from '@/lib/sales/model'
import { PAYMENT_STATE_HE } from '@/components/sales/copy'
import { formatAgorot } from '@/lib/money'
import { israelDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

export default async function ShopHome() {
  const s = (await getSession())!
  const may = (p: Permission) => can(s.user.role, p, s.overrides)
  const res = await loadOps(async () => {
    const st = getSalesStore()
    const day = israelDate()
    const [open, recent] = await Promise.all([st.openLines(100), st.listSales({ since: new Date(Date.now() - 36 * 3_600_000).toISOString(), limit: 300 })])
    const today = recent.filter((x) => israelDate(new Date(x.createdAt)) === day)
    const ids = [...new Set([...open.map((l) => l.saleId), ...today.map((x) => x.id)])]
    const [sales, lines, payments, items] = await Promise.all([
      st.listSales({ ids }),
      st.linesOf(today.map((x) => x.id)),
      st.paymentsOf(today.map((x) => x.id)),
      Promise.all([...new Set(open.map((l) => l.itemId))].map((id) => getOpsStore().getItem(id))),
    ])
    return { open, today, sales: new Map(sales.map((x) => [x.id, x])), lines, payments, items: new Map(items.filter((i) => !!i).map((i) => [i!.id, i!])) }
  })

  const tiles = [
    may('inventory:financial') ? { href: '/shop/sell', label: 'מכירה', icon: ShoppingBag, primary: true } : null,
    may('inventory:write') ? { href: '/shop/new', label: 'הוספת פריט', icon: PackagePlus } : null,
    { href: '/shop/scan', label: 'סריקת תווית', icon: ScanLine },
    { href: '/shop/items', label: 'חיפוש פריט', icon: Search },
  ].filter((x): x is NonNullable<typeof x> => !!x)

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold text-ink">חנות</h1>
      <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center text-base font-semibold ${t.primary ? 'border-brand bg-brand text-forest' : 'border-line bg-surface text-ink hover:bg-sunken'}`}>
            <t.icon aria-hidden className="h-8 w-8" />{t.label}
          </Link>
        ))}
      </nav>

      {!res.ok ? (
        <p className="rounded-lg border border-line bg-surface p-3 text-sm text-muted" dir="ltr">{res.message}</p>
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
            <h2 className="text-sm font-semibold text-ink">ממתין למסירה ({res.data.open.length})</h2>
            {res.data.open.length === 0 ? <p className="text-sm text-muted">אין פריטים שממתינים לאיסוף או למשלוח.</p> : (
              <ul className="flex flex-col divide-y divide-line/60">
                {res.data.open.map((l) => {
                  const it = res.data.items.get(l.itemId)
                  const sale = res.data.sales.get(l.saleId)
                  return (
                    <li key={l.id}>
                      <Link href={`/shop/sales/${l.saleId}`} className="flex min-h-14 items-center gap-3 py-2 hover:bg-sunken">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {it?.photoUrl ? <img src={it.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" /> : <span className="h-12 w-12 shrink-0 rounded bg-sunken" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium" dir="auto">{it?.title ?? 'פריט'}{l.quantity > 1 ? ` ×${l.quantity}` : ''}</span>
                          <span className="block truncate text-xs text-muted">{l.fulfilment === 'delivery' ? `משלוח${l.scheduledFor ? ` ${l.scheduledFor}` : ''}` : 'איסוף'} · <span dir="ltr">{sale?.number}</span></span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
            <h2 className="text-sm font-semibold text-ink">מכירות היום ({res.data.today.length})</h2>
            {res.data.today.length === 0 ? <p className="text-sm text-muted">עוד לא נרשמה מכירה היום.</p> : (
              <ul className="flex flex-col divide-y divide-line/60">
                {res.data.today.map((sale) => {
                  const m = saleMoney(sale, res.data.lines.filter((l) => l.saleId === sale.id), res.data.payments.filter((p) => p.saleId === sale.id))
                  return (
                    <li key={sale.id}>
                      <Link href={`/shop/sales/${sale.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm hover:bg-sunken">
                        <span dir="ltr">{sale.number}</span>
                        <span className={m.state === 'paid' || m.state === 'nothing_due' ? 'text-ok' : 'text-warn'}>{PAYMENT_STATE_HE[m.state]}</span>
                        {may('inventory:financial') ? <span className="num">{formatAgorot(m.dueMinor)}</span> : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
