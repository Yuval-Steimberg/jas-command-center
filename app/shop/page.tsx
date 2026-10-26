import Link from 'next/link'
import { Suspense } from 'react'
import { AlertTriangle, ChevronLeft, PackagePlus, ScanLine, Search, ShoppingBag, Store, Truck } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can, ROLE_LABELS_HE, type Permission } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { handoverQueue } from '@/lib/sales/views'
import { handoverCounts } from '@/lib/sales/handovers'
import { readOps } from '@/lib/analytics/load'
import { inventorySection } from '@/lib/analytics/ops'
import { previousPeriod, rangeFor } from '@/lib/time'
import { Thumb } from '@/components/shop/bits'
import { formatAgorot } from '@/lib/money'
import { formatDay } from '@/lib/format'
import { matchPlace } from '@/lib/inventory/places'
import { stockAndSales, type Breakdown } from '@/lib/inventory/breakdown'

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

  // The actions render at once; the numbers stream in after, each from the read the rest of the system uses.
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
      <Suspense fallback={<Skeleton h="h-48" />}>
        <Today money={sell} crm={may('crm:read')} pii={may('crm:read_pii')} />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-64" />}>
        <ByCategory money={sell} />
      </Suspense>
    </div>
  )
}

const Skeleton = ({ h }: { h: string }) => <div className={`${h} animate-pulse rounded-lg border border-line bg-surface`} />
const Problem = ({ what, message }: { what: string; message: string }) => <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad" dir="auto">{what} לא נטענו: {message}</p>

function Stat({ label, value, sub, href, tone }: { label: string; value: string; sub?: string; href?: string; tone?: 'bad' }) {
  const body = (
    <>
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className={`num text-2xl font-bold ${tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</span>
      {sub ? <span className="num text-xs text-muted">{sub}</span> : null}
    </>
  )
  const cls = 'flex min-h-24 flex-col justify-center gap-0.5 rounded-lg border border-line bg-surface p-3'
  return href ? <Link href={href} className={`${cls} hover:bg-sunken`}>{body}</Link> : <div className={cls}>{body}</div>
}

/** The four cards and the to-do list: stock from the inventory snapshot, handovers from the deliveries tab's own list. */
async function Today({ money, crm, pii }: { money: boolean; crm: boolean; pii: boolean }) {
  const [snap, queue] = await Promise.all([getOpsSnapshot(), loadOps(() => handoverQueue({ crm, pii }))])
  const n = queue.ok ? handoverCounts(queue.data.list) : null
  const todo = queue.ok ? queue.data.list.slice(0, 5) : []
  return (
    <>
      {n?.overdue ? (
        <Link href="/shop/deliveries" className="flex min-h-14 items-center gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 text-sm font-semibold text-bad">
          <AlertTriangle aria-hidden className="h-5 w-5 shrink-0" />
          <span className="flex-1">{n.overdue === 1 ? 'משלוח אחד באיחור' : `${n.overdue} משלוחים באיחור`}</span>
          <ChevronLeft aria-hidden className="h-5 w-5 shrink-0" />
        </Link>
      ) : null}
      <section aria-label="מצב החנות" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="במלאי" href="/shop/items" value={snap.state === 'ok' ? String(snap.data.items.available) : '—'} sub={money && snap.state === 'ok' ? formatAgorot(snap.data.items.askingValueMinor, { whole: true }) : undefined} />
        <Stat label="ממתין לאיסוף" href="/shop/deliveries" value={n ? String(n.pickup) : '—'} />
        <Stat label="ממתין למשלוח" href="/shop/deliveries" value={n ? String(n.delivery) : '—'} />
        <Stat label="באיחור" href="/shop/deliveries" value={n ? String(n.overdue) : '—'} tone={n?.overdue ? 'bad' : undefined} />
      </section>
      {snap.state === 'error' ? <Problem what="נתוני המלאי" message={snap.error} /> : null}
      {!queue.ok ? <Problem what="המסירות" message={queue.message} /> : (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center justify-between text-base font-bold text-ink">
            מסירות לביצוע
            {queue.data.list.length > todo.length ? <Link href="/shop/deliveries" className="text-sm font-medium text-muted underline-offset-2 hover:underline">כל {queue.data.list.length}</Link> : null}
          </h2>
          {todo.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">אין פריטים שממתינים לאיסוף או למשלוח.</p> : (
            <ul className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-surface">
              {todo.map((h) => {
                const c = h.contactId ? queue.data.contacts.get(h.contactId) : undefined
                return (
                  <li key={h.key}>
                    <Link href="/shop/deliveries" className="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-sunken">
                      <Thumb src={h.item?.photoUrl} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink" dir="auto">{h.item?.title ?? (h.ref ? `הזמנה ${h.ref}` : 'פריט')}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                          {h.kind === 'delivery' ? <Truck aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <Store aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                          {h.kind === 'delivery' ? 'משלוח' : 'איסוף'}
                          {h.scheduledFor ? <span className="num" dir="ltr">{formatDay(h.scheduledFor)}</span> : null}
                          {c ? <span dir="auto" className="truncate">· {c.name}</span> : null}
                        </span>
                      </span>
                      {h.overdue ? <span className="shrink-0 rounded-full border border-bad/30 bg-bad/10 px-2 py-0.5 text-xs font-medium text-bad">באיחור</span> : null}
                      <ChevronLeft aria-hidden className="h-5 w-5 shrink-0 text-faint" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

/**
 * This month's shop sales, and stock by category, renewal level and colour: the
 * same definition as /analytics and the full table on /shop/items
 * (`lib/inventory/breakdown.ts`), so the three never disagree. Every group is
 * shown, none cut off.
 */
async function ByCategory({ money }: { money: boolean }) {
  const range = rangeFor('mtd')
  const prev = previousPeriod(range)
  const ops = await readOps(prev.from)
  const sec = inventorySection(ops, range, prev)
  if (ops.state !== 'ok') return <Problem what="נתוני המכירות" message={ops.detail} />
  const metric = (id: string) => sec.metrics.find((m) => m.id === id)?.value ?? null
  const shop = matchPlace('shop', ops.data.locations ?? [])
  const rows = (by: Breakdown) => stockAndSales(ops.data.items, ops.data.movements, by, range, new Set(shop ? [shop.id] : []))
  const stockBars = (by: Breakdown) => rows(by).filter((r) => r.stock > 0).map((r) => ({ label: r.group, value: r.stock, shown: String(r.stock) }))
  const sold = rows('category').filter((r) => r.shopValueMinor > 0).sort((a, b) => b.shopValueMinor - a.shopValueMinor)
  const units = metric('inv.inStoreSales')
  const net = metric('inv.inStoreNet')
  return (
    <>
      <section className="grid grid-cols-2 gap-3">
        <Stat label="נמכר החודש בחנות" value={units == null ? '—' : String(units)} sub={money && net != null ? `${formatAgorot(net, { whole: true })} אחרי החזרות` : undefined} href={money ? '/shop/sales' : undefined} />
        <Stat label="נמכר באתר החודש" value={metric('inv.soldOnline') == null ? '—' : String(metric('inv.soldOnline'))} sub="הכסף נספר באתר" />
      </section>
      {money ? <Bars title="מכירות החודש לפי קטגוריה" rows={sold.map((r) => ({ label: r.group, value: r.shopValueMinor, shown: formatAgorot(r.shopValueMinor, { whole: true }) }))} empty="עוד לא נמכר כלום החודש." /> : null}
      <Bars title="מלאי לפי קטגוריה" rows={stockBars('category')} empty="אין פריטים במלאי." />
      <Bars title="מלאי לפי רמת חידוש" rows={stockBars('renewal')} empty="אין פריטים במלאי." />
      <Bars title="מלאי לפי צבע" rows={stockBars('colour')} empty="אין פריטים במלאי." />
      <Link href="/shop/items?by=category&days=30#by-group" className="flex min-h-11 items-center justify-between rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-sunken">
        טבלה מלאה: מלאי, בחנות ומכירות לפי קטגוריה, צבע ורמת חידוש
        <ChevronLeft aria-hidden className="h-5 w-5 shrink-0 text-faint" />
      </Link>
    </>
  )
}

/** Horizontal bars: one hue (sage), the value written at the end, so it reads without a legend or colour. */
function Bars({ title, rows, empty }: { title: string; rows: { label: string; value: number; shown: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{empty}</p> : (
        <ul className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate text-ink" dir="auto">{r.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-sage" style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></span>
              <span className="num min-w-12 text-end text-muted">{r.shown}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
