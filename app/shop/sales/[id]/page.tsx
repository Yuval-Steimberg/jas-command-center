import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { SaleDetail } from '@/components/sales/sale-detail'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { saleView } from '@/lib/sales/views'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ShopSalePage({ params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const res = await loadOps(async () => {
    const [v, locations] = await Promise.all([saleView(params.id, { crm: may('crm:read'), pii: may('crm:read_pii') }), getOpsStore().listLocations()])
    return v ? { v, locations: locationOptions(locations) } : null
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return <p dir="ltr" className="text-sm text-bad">{res.message}</p>
  const { v, locations } = res.data!
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">מכירה <span dir="ltr">{v.sale.number}</span></h1>
        {may('inventory:financial') ? <Link href="/shop/sell" className="inline-flex h-11 items-center rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">מכירה חדשה</Link> : null}
      </div>
      <p className="text-sm text-muted"><span dir="auto">{v.sale.contactId ? v.contactName ?? 'לקוח/ה' : 'לקוח/ה מזדמן/ת'}</span> · {formatDateTime(v.sale.createdAt)}</p>
      <SaleDetail v={v} lang="he" base="/shop" may={{ operate: may('inventory:operate'), money: may('inventory:financial') }} locations={locations} />
    </div>
  )
}
