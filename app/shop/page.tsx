import Link from 'next/link'
import { Suspense } from 'react'
import { ChevronLeft, PackagePlus, ScanLine, Search, ShoppingBag } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can, ROLE_LABELS_HE, type Permission } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { soldUnits, type Breakdown, type BreakdownRow } from '@/lib/inventory/breakdown'
import { BREAKDOWN_DAYS, isBreakdownDays, loadAllBreakdowns, type BreakdownDays } from '@/lib/inventory/breakdown-view'

export const dynamic = 'force-dynamic'

type View = 'stock' | 'sales'

export default async function ShopHome({ searchParams }: { searchParams?: { view?: string; days?: string } }) {
  const s = (await getSession())!
  const may = (p: Permission) => can(s.user.role, p, s.overrides)

  const sell = may('inventory:financial')
  // Sales counts are business performance: only with inventory:reports. Without it the toggle is not offered
  // and no sales movement is read at all (loadAllBreakdowns), so nothing can reach the page by a URL either.
  const reports = may('inventory:reports')
  const view: View = reports && searchParams?.view === 'sales' ? 'sales' : 'stock'
  const days: BreakdownDays = isBreakdownDays(searchParams?.days) ? searchParams.days : '30'
  const tiles = [
    may('inventory:write') ? { href: '/shop/new', label: 'הוספת פריט', icon: PackagePlus } : null,
    { href: '/shop/scan', label: 'סריקת תווית', icon: ScanLine },
    { href: '/shop/items', label: 'חיפוש פריט', icon: Search },
  ].filter((x): x is NonNullable<typeof x> => !!x)

  // The actions render at once; the numbers stream in after.
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
      <section aria-labelledby="stats" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="stats" className="text-lg font-bold text-ink">סטטיסטיקה</h2>
          {reports ? (
            <nav aria-label="מלאי או מכירות" className="inline-flex rounded-full border border-line bg-surface p-1">
              {(['stock', 'sales'] as const).map((v) => (
                <Link key={v} href={v === 'stock' ? '/shop' : `/shop?view=sales&days=${days}`} aria-current={v === view ? 'true' : undefined} className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm ${v === view ? 'bg-forest font-semibold text-cream' : 'text-muted hover:text-ink'}`}>
                  {v === 'stock' ? 'מלאי' : 'מכירות'}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        {view === 'sales' ? (
          <nav aria-label="תקופה" className="flex flex-wrap gap-2">
            {BREAKDOWN_DAYS.map((d) => (
              <Link key={d} href={`/shop?view=sales&days=${d}`} aria-current={d === days ? 'true' : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm ${d === days ? 'border-forest bg-sage-soft font-medium text-forest' : 'border-line text-muted hover:bg-sunken hover:text-ink'}`}>
                {DAYS_HE[d]}
              </Link>
            ))}
          </nav>
        ) : null}
        <Suspense key={`${view}-${days}`} fallback={<div className="h-64 animate-pulse rounded-lg border border-line bg-surface" />}>
          <Stats view={view} days={days} />
        </Suspense>
      </section>
    </div>
  )
}

const DAYS_HE: Record<BreakdownDays, string> = { '30': '30 ימים', '90': '90 ימים', '365': '12 חודשים', all: 'מאז ומעולם' }
const GROUP_HE: Record<Breakdown, string> = { renewal: 'לפי רמת חידוש', category: 'לפי קטגוריה', colour: 'לפי צבע' }
// The order the brief asks for: renewal level, category, colour.
const ORDER: Breakdown[] = ['renewal', 'category', 'colour']

/**
 * The ONE statistics section in shop mode. Item counts, never money: units in
 * stock now (in storage or listed), or units sold in the period in the shop and
 * on the website, net of returns. Same definitions as /inventory and
 * /analytics (`lib/inventory/breakdown.ts`), so the screens never disagree.
 */
async function Stats({ view, days }: { view: View; days: BreakdownDays }) {
  const res = await loadOps(() => loadAllBreakdowns(days, { sales: view === 'sales' }))
  if (!res.ok) return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad" dir="auto">הנתונים לא נטענו: {res.message}</p>
  const value = (r: BreakdownRow) => (view === 'sales' ? soldUnits(r) : r.stock)
  const total = res.data.rows.category.reduce((a, r) => a + value(r), 0)
  return (
    <>
      <p className="num text-sm text-muted">
        {view === 'sales' ? `${total} פריטים נמכרו ב${DAYS_HE[days]}${days === 'all' ? '' : ' האחרונים'}` : `${total} פריטים במלאי עכשיו`}
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        {ORDER.map((b) => (
          <Bars key={b} title={GROUP_HE[b]} rows={res.data.rows[b].map((r) => ({ label: r.group, value: value(r) })).filter((r) => r.value > 0)} empty={view === 'sales' ? 'לא נמכרו פריטים בתקופה הזו.' : 'אין פריטים במלאי.'} />
        ))}
      </div>
      <p className="text-xs text-muted">
        {view === 'sales'
          ? 'מספר פריטים, לא סכומים. בחנות ובאתר יחד, בניכוי פריטים שהוחזרו; הזמנה שבוטלה לא נספרת. מכירה משויכת לפי מה שכתוב על הפריט עכשיו.'
          : 'מספר פריטים במחסן או באתר, בכל מקום. צבע = הצבע הראשון שנכתב על הפריט.'}
        {res.data.capped ? ' יש יותר רשומות ממה שנקרא בבת אחת: המספרים עשויים להיות נמוכים.' : ''}
      </p>
    </>
  )
}

/** Horizontal bars: one hue (sage), the count written at the end, so it reads without a legend or a percentage. */
function Bars({ title, rows, empty }: { title: string; rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{empty}</p> : (
        <ul className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate text-ink" dir="auto">{r.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-sage" style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} /></span>
              <span className="num min-w-8 text-end font-medium text-ink">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
