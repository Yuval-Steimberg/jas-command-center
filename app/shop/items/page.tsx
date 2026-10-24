import Link from 'next/link'
import { ItemStatusChip } from '@/components/ops/ui'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { formatAgorot } from '@/lib/money'
import { input } from '@/app/(app)/website/forms'

export const dynamic = 'force-dynamic'

export default async function ShopItemsPage({ searchParams }: { searchParams: { q?: string; all?: string } }) {
  const q = (searchParams.q ?? '').trim().slice(0, 100)
  const all = searchParams.all === '1'
  const res = await loadOps(() => getOpsStore().listItems({ q: q || undefined, statuses: all ? undefined : ['in_storage', 'listed', 'reserved'], limit: 60 }))
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold text-ink">חיפוש פריט</h1>
      <form className="flex flex-col gap-2 sm:flex-row" role="search">
        <input name="q" defaultValue={q} dir="auto" placeholder="קוד, שם, קטגוריה, צבע או חומר" aria-label="חיפוש" className={`${input} h-12 text-base`} />
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted"><input type="checkbox" name="all" value="1" defaultChecked={all} className="h-5 w-5" />גם פריטים שנמכרו</label>
        <button type="submit" className="h-12 rounded-full bg-forest px-6 text-sm font-semibold text-cream">חיפוש</button>
      </form>
      {!res.ok ? <p dir="ltr" className="text-sm text-bad">{res.message}</p> : res.data.length === 0 ? <p className="text-sm text-muted">לא נמצא פריט.</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {res.data.map((i) => (
            <li key={i.id}>
              <Link href={`/shop/items/${i.id}`} className="flex min-h-20 items-center gap-3 rounded-lg border border-line bg-surface p-2 hover:bg-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.photoUrl ? <img src={i.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" /> : <span className="h-16 w-16 shrink-0 rounded bg-sunken" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink" dir="auto">{i.title}</span>
                  <span className="block truncate text-xs text-muted"><span dir="ltr">{i.sku}</span>{i.category ? ` · ${i.category}` : ''}{i.quantity > 1 ? ` · ${i.quantity} יח׳` : ''}</span>
                  <span className="mt-1 flex items-center gap-2"><ItemStatusChip status={i.status} lang="he" />{i.priceMinor != null ? <span className="num text-sm">{formatAgorot(i.priceMinor)}</span> : null}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
