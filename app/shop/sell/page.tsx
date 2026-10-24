import { Checkout } from '@/components/sales/checkout'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { checkoutData } from '@/lib/sales/views'

export const dynamic = 'force-dynamic'

export default async function ShopSellPage({ searchParams }: { searchParams: { item?: string | string[] } }) {
  await requirePageAccess('inventory:financial')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const res = await loadOps(() => checkoutData({ crm: may('crm:read'), pii: may('crm:read_pii') }))
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold text-ink">מכירה</h1>
      {!res.ok ? <p dir="ltr" className="text-sm text-bad">{res.message}</p> : (
        <Checkout items={res.data.items} contacts={res.data.contacts} allowNewContact={may('crm:write')} lang="he" base="/shop" preselect={([] as string[]).concat(searchParams.item ?? [])} requestId={res.data.requestId} />
      )}
    </div>
  )
}
