import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn } from '@/components/ops/ui'
import { SaleDetail } from '@/components/sales/sale-detail'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { saleView } from '@/lib/sales/views'
import { terminalView } from '@/lib/sales/terminal'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function SalePage({ params }: { params: { id: string } }) {
  await requirePageAccess('inventory:read')
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const res = await loadOps(async () => {
    const [v, locations, terminal] = await Promise.all([saleView(params.id, { crm: may('crm:read'), pii: may('crm:read_pii') }), getOpsStore().listLocations(), terminalView(params.id)])
    return v ? { v, locations: locationOptions(locations), terminal } : null
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return (<><PageHeader title="Sale" /><OpsUnavailable message={res.message} /></>)
  const { v, locations, terminal } = res.data!
  return (
    <>
      <PageHeader
        title={`Sale ${v.sale.number}`}
        description={<span>{v.sale.contactId ? (v.contactName ? <Link href={`/crm/${v.sale.contactId}`} className="underline-offset-2 hover:underline">{v.contactName}</Link> : 'Customer') : 'Walk-in customer'} · {formatDateTime(v.sale.createdAt)} · by {v.sale.createdBy}</span>}
        actions={<div className="flex flex-wrap gap-2"><Link href="/sales" className={btn}>Sales</Link>{may('inventory:financial') ? <Link href="/sales/new" className={btn}>New sale</Link> : null}</div>}
      />
      <SaleDetail v={v} lang="en" base="/sales" may={{ operate: may('inventory:operate'), money: may('inventory:financial') }} locations={locations} terminal={terminal} />
    </>
  )
}
