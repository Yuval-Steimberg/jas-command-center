import Link from 'next/link'
import { PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { itemUrl, qrSvg } from '@/lib/inventory/qr'
import { formatAgorot } from '@/lib/money'

export const dynamic = 'force-dynamic'

/** Printable QR labels. ?ids=a,b,c — or no ids for every item in storage without a listing. */
export default async function LabelsPage({ searchParams }: { searchParams?: { ids?: string } }) {
  await requirePageAccess('inventory:read')
  const ids = (searchParams?.ids ?? '').split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)
  const res = await loadOps(() => (ids.length ? getOpsStore().listItems({ ids }) : getOpsStore().listItems({ statuses: ['in_storage'], limit: 200 })))
  if (!res.ok) return (<><PageHeader title="Labels" /><OpsUnavailable message={res.message} /></>)
  const labels = await Promise.all(res.data.map(async (i) => ({ i, svg: await qrSvg(itemUrl(i.id)) })))
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Labels" description={`${labels.length} label(s). Print this page (Ctrl/⌘+P); the menus are left off the paper. Scanning a label opens the item.`} actions={<Link href="/inventory" className={btn}>Inventory</Link>} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
        {labels.map(({ i, svg }) => (
          <div key={i.id} className="flex break-inside-avoid items-center gap-2 rounded-md border border-line bg-white p-2 text-forest">
            <div className="h-20 w-20 shrink-0" aria-label={`QR code for ${i.sku}`} dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="min-w-0 text-xs">
              <p className="font-mono text-sm font-bold">{i.sku}</p>
              <p dir="auto" className="line-clamp-2">{i.title}</p>
              {i.priceMinor ? <p className="num font-semibold">{formatAgorot(i.priceMinor)}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
