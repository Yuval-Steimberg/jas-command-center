import Link from 'next/link'
import { PackagePlus } from 'lucide-react'
import { ItemStatusChip } from '@/components/ops/ui'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { AVAILABLE, STATUS_LABEL_HE } from '@/lib/inventory/model'
import { ITEM_STATUSES, type ItemStatus } from '@/lib/ops/types'
import { formatAgorot } from '@/lib/money'
import { ShopItemSearch, type StatusOption } from '@/components/shop/item-search'
import { Thumb } from '@/components/shop/bits'

export const dynamic = 'force-dynamic'

/** "In stock" is the one definition the home screen and analytics use: on the shelf or on the website (held items are their own filter). */
const IN_STOCK = AVAILABLE

export default async function ShopItemsPage({ searchParams }: { searchParams: { q?: string; s?: string } }) {
  const session = (await getSession())!
  const q = (searchParams.q ?? '').trim().slice(0, 100)
  const s = searchParams.s === 'all' || (ITEM_STATUSES as readonly string[]).includes(searchParams.s ?? '') ? searchParams.s! : 'stock'
  const statuses = s === 'stock' ? [...IN_STOCK] : s === 'all' ? undefined : [s as ItemStatus]
  const [res, snap] = await Promise.all([loadOps(() => getOpsStore().listItems({ q: q || undefined, statuses, limit: 300 })), getOpsSnapshot()])
  // Counts come from the same snapshot the home screen uses, so the two never disagree.
  const by = snap.state === 'ok' ? snap.data.items.byStatus : null
  const total = by ? Object.values(by).reduce((a, b) => a + b, 0) : null
  const options: StatusOption[] = [
    { value: 'stock', label: 'במלאי', count: by ? IN_STOCK.reduce((a, k) => a + by[k], 0) : null },
    { value: 'all', label: 'הכול', count: total },
    ...ITEM_STATUSES.filter((k) => !by || by[k] > 0).map((k) => ({ value: k, label: STATUS_LABEL_HE[k], count: by?.[k] ?? null })),
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">מלאי</h1>
        {total != null ? <p className="num text-sm text-muted">{total} פריטים במערכת</p> : null}
      </div>
      <ShopItemSearch q={q} status={s} options={options} />
      {!res.ok ? <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p> : res.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{q ? <>לא נמצא פריט שמתאים ל־<span dir="auto" className="font-medium text-ink">{q}</span>.{s === 'all' ? '' : ' אפשר לבחור ״הכול״.'}</> : 'אין פריטים כאלה.'}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {res.data.map((i) => (
            <li key={i.id}>
              <Link href={`/shop/items/${i.id}`} className="flex min-h-20 items-center gap-3 rounded-lg border border-line bg-surface p-2 pe-3 hover:bg-sunken">
                <Thumb src={i.photoUrl} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink" dir="auto">{i.title}</span>
                  <span className="block truncate text-xs text-muted"><span dir="ltr">{i.sku}</span>{i.category ? ` · ${i.category}` : ''}{i.quantity > 1 ? ` · ${i.quantity} יח׳` : ''}</span>
                  <span className="mt-1 flex items-center gap-2"><ItemStatusChip status={i.status} lang="he" /></span>
                </span>
                <span className="num shrink-0 text-base font-bold text-ink">{i.priceMinor != null ? formatAgorot(i.priceMinor) : <span className="text-xs font-normal text-muted">ללא מחיר</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {can(session.user.role, 'inventory:write', session.overrides) ? (
        // Above the tab bar; forest, not orange, since this screen has no single primary action.
        <Link href="/shop/new" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] end-4 z-10 inline-flex h-14 items-center gap-2 rounded-full bg-forest px-5 text-base font-semibold text-cream shadow-card print:hidden">
          <PackagePlus aria-hidden className="h-5 w-5" />פריט חדש
        </Link>
      ) : null}
    </div>
  )
}
