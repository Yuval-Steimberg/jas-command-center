import Link from 'next/link'
import { Card, CardBody, PageHeader } from '@/components/ui/card'
import { btn } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { ScanBox } from '../forms'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  await requirePageAccess('inventory:read')
  return (
    <>
      <PageHeader title="Scan an item" description="Point a scanner at a label (it types the code and presses Enter), use the phone camera, or type the SKU. Labels are printed from an item page or from a selection on the inventory list." actions={<Link href="/inventory" className={btn}>Inventory</Link>} />
      <Card className="max-w-2xl"><CardBody><ScanBox /></CardBody></Card>
    </>
  )
}
