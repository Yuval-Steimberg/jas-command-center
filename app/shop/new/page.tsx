import { ItemForm } from '@/components/inventory/item-form'
import { EMPTY_ITEM } from '@/components/inventory/item-values'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { CONDITION_LABEL_HE } from '@/lib/inventory/model'

export const dynamic = 'force-dynamic'

export default async function ShopNewItemPage() {
  await requirePageAccess('inventory:write')
  const s = (await getSession())!
  const res = await loadOps(() => getOpsStore().listLocations())
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-bold text-ink">הוספת פריט</h1>
      <p className="text-sm text-muted">מצלמים את הפריט, ואז ה-AI יכול למלא את הפרטים. כל שדה נשאר לעריכה.</p>
      {!res.ok ? <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p> : (
        <ItemForm
          lang="he" base="/shop" mode="create" initial={EMPTY_ITEM}
          locations={locationOptions(res.data)} canWebsite={can(s.user.role, 'website:write', s.overrides)}
        />
      )}
    </div>
  )
}
