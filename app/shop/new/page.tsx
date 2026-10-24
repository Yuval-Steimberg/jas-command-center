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
      <h1 className="text-xl font-bold text-ink">הוספת פריט</h1>
      <p className="text-sm text-muted">מצלמים, ואפשר לבקש מה-AI להציע שם, קטגוריה, צבעים, חומר ומחיר. כל הצעה ניתנת לעריכה. תמונה שדומה לפריט קיים מסומנת.</p>
      {!res.ok ? <p dir="ltr" className="text-sm text-bad">{res.message}</p> : (
        <ItemForm
          lang="he" base="/shop" mode="create" initial={EMPTY_ITEM}
          conditions={Object.entries(CONDITION_LABEL_HE).map(([value, label]) => ({ value, label }))}
          locations={locationOptions(res.data)} canCost={can(s.user.role, 'inventory:financial', s.overrides)}
        />
      )}
    </div>
  )
}
