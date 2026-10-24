import { LabelSheet } from '@/components/inventory/label-sheet'
import { PrintButton } from '@/components/shop/print-button'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'

export const dynamic = 'force-dynamic'

/** Labels from the shop: the same sheet as /inventory/labels, in Hebrew. ?ids=a,b,c */
export default async function ShopLabelsPage({ searchParams }: { searchParams: { ids?: string } }) {
  const ids = (searchParams.ids ?? '').split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)
  const res = ids.length ? await loadOps(() => getOpsStore().listItems({ ids })) : null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 print:hidden">
        <h1 className="text-2xl font-bold text-ink">הדפסת תוויות</h1>
        <p className="text-sm text-muted">בכל תווית יש QR שנפתח במצלמת הטלפון וברקוד לסורק של החנות.</p>
        {res?.ok && res.data.length ? <PrintButton label={res.data.length === 1 ? 'הדפסת התווית' : `הדפסת ${res.data.length} תוויות`} /> : null}
      </div>
      {!res ? <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">פותחים פריט ולוחצים ״הדפסת תווית״.</p>
        : !res.ok ? <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p>
        : <LabelSheet items={res.data} lang="he" />}
    </div>
  )
}
