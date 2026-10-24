import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Plus } from 'lucide-react'
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
  if (!res.ok) return <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p>
  const { v, locations } = res.data!
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">מכירה <span dir="ltr">{v.sale.number}</span></h1>
          <p className="text-sm text-muted"><span dir="auto">{v.sale.contactId ? v.contactName ?? 'לקוח/ה' : 'לקוח/ה מזדמן/ת'}</span> · {formatDateTime(v.sale.createdAt, 'he')}</p>
        </div>
        {may('inventory:financial') ? <Link href="/shop/sell" className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-medium hover:bg-sunken"><Plus aria-hidden className="h-4 w-4" />מכירה חדשה</Link> : null}
      </div>
      <SaleDetail v={v} lang="he" base="/shop" may={{ operate: may('inventory:operate'), money: may('inventory:financial') }} locations={locations} />
    </div>
  )
}
