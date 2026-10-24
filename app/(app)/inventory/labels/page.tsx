import Link from 'next/link'
import { PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { LabelSheet } from '@/components/inventory/label-sheet'

export const dynamic = 'force-dynamic'

/** Printable labels (QR + Code 128). ?ids=a,b,c — or no ids for every item in storage without a listing. */
export default async function LabelsPage({ searchParams }: { searchParams?: { ids?: string } }) {
  await requirePageAccess('inventory:read')
  const ids = (searchParams?.ids ?? '').split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)
  const res = await loadOps(() => (ids.length ? getOpsStore().listItems({ ids }) : getOpsStore().listItems({ statuses: ['in_storage'], limit: 200 })))
  if (!res.ok) return (<><PageHeader title="Labels" /><OpsUnavailable message={res.message} /></>)
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Labels" description={`${res.data.length} label(s). Print this page (Ctrl/⌘+P); the menus are left off the paper. The QR opens the item on a phone; the barcode is for a shop scanner.`} actions={<Link href="/inventory" className={btn}>Inventory</Link>} />
      </div>
      <LabelSheet items={res.data} />
    </>
  )
}
