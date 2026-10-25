import Link from 'next/link'
import { PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn } from '@/components/ops/ui'
import { ItemForm } from '@/components/inventory/item-form'
import { EMPTY_ITEM } from '@/components/inventory/item-values'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { CONDITION_LABEL } from '@/lib/inventory/model'

export const dynamic = 'force-dynamic'

export default async function NewItemPage() {
  await requirePageAccess('inventory:write')
  const s = (await getSession())!
  const res = await loadOps(() => getOpsStore().listLocations())
  return (
    <>
      <PageHeader title="Add an item" description="For an item that did not come from a collection project: a walk-in donation, a workshop piece, a return from elsewhere. Start from a photo: the AI can suggest the name, category, colours, material and a price, and a photo that looks like an item we already have is flagged. Collected furniture goes through intake instead, so it keeps the apartment it came from." actions={<Link href="/inventory" className={btn}>Inventory</Link>} />
      <div className="max-w-3xl">
        {!res.ok ? <OpsUnavailable message={res.message} /> : (
          <ItemForm
            lang="en" base="/inventory" mode="create" initial={EMPTY_ITEM}
            locations={locationOptions(res.data)}
          />
        )}
      </div>
    </>
  )
}
