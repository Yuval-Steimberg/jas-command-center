import Link from 'next/link'
import { Card, CardBody, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel } from '@/lib/ops/views'
import { getSupplierStore } from '@/lib/suppliers/store'
import { OrderForm } from '../../order-form'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage({ searchParams }: { searchParams?: { supplier?: string } }) {
  await requirePageAccess('inventory:write')
  const s = (await getSession())!
  const pii = can(s.user.role, 'crm:read_pii', s.overrides)
  const res = await loadOps(async () => {
    const [suppliers, items] = await Promise.all([getOpsStore().listContacts({ role: 'supplier', limit: 1000 }), getOpsStore().listItems({ limit: 2000 }), getSupplierStore().listOrders({ limit: 1 })])
    return { suppliers: suppliers.map((c) => ({ id: c.id, label: contactLabel(c, pii) })).sort((a, b) => a.label.localeCompare(b.label)), categories: [...new Set(items.map((i) => i.category).filter((x): x is string => !!x))].sort() }
  })
  return (
    <>
      <PageHeader title="New purchase order" description="Saved as a draft. Send it to the supplier from the order page (WhatsApp or email), then mark it ordered." />
      {!res.ok ? <OpsUnavailable title="Suppliers are not available" message={res.message} /> : res.data.suppliers.length === 0 ? (
        <p className="text-sm text-muted">Add a supplier first on <Link href="/suppliers" className={linkCls}>Suppliers</Link>.</p>
      ) : (
        <Card><CardBody><OrderForm suppliers={res.data.suppliers} supplierId={typeof searchParams?.supplier === 'string' ? searchParams.supplier : undefined} showCost categories={res.data.categories} /></CardBody></Card>
      )}
    </>
  )
}
