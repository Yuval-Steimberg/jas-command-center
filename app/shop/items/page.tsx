import Link from 'next/link'
import { ItemStatusChip } from '@/components/ops/ui'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { formatAgorot } from '@/lib/money'
import { ShopItemSearch } from '@/components/shop/item-search'
import { Thumb } from '@/components/shop/bits'

export const dynamic = 'force-dynamic'

export default async function ShopItemsPage({ searchParams }: { searchParams: { q?: string; all?: string } }) {
  const q = (searchParams.q ?? '').trim().slice(0, 100)
  const all = searchParams.all === '1'
  const res = await loadOps(() => getOpsStore().listItems({ q: q || undefined, statuses: all ? undefined : ['in_storage', 'listed', 'reserved'], limit: 60 }))
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold text-ink">חיפוש פריט</h1>
      <ShopItemSearch q={q} all={all} />
      {!res.ok ? <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p> : res.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{q ? <>לא נמצא פריט שמתאים ל־<span dir="auto" className="font-medium text-ink">{q}</span>.{all ? '' : ' אפשר לסמן ״גם פריטים שנמכרו״.'}</> : 'אין עדיין פריטים במלאי.'}</p>
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
    </div>
  )
}
