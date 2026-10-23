import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { SourceProblem } from '@/components/ui/source-state'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'

/** Inventory, customers, fulfilment and tasks: the command center's own records (migration 0003). */
export async function InventorySummary() {
  const r = await getOpsSnapshot()
  return (
    <Card>
      <CardHeader title={<Link href="/inventory" className="hover:underline">Inventory & fulfilment</Link>} meta="Command center records" />
      <CardBody>
        {r.state !== 'ok' ? <SourceProblem result={r} what="Inventory" /> : (
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Available" value={formatCount(r.data.items.available)} sub={formatAgorot(r.data.items.askingValueMinor, { whole: true }) + ' asking'} />
            <Kpi label="Not listed yet" value={formatCount(r.data.items.unlisted)} tone={r.data.items.agingUnlisted ? 'warn' : undefined} sub={r.data.items.agingUnlisted ? `${r.data.items.agingUnlisted} for 60+ days` : undefined} />
            <Kpi label="Sold, not delivered" value={formatCount(r.data.items.awaitingDelivery)} sub={`${r.data.deliveries.scheduled} planned`} />
            <Kpi label="Reserved" value={formatCount(r.data.items.byStatus.reserved)} sub={r.data.items.reservedExpiringSoon ? `${r.data.items.reservedExpiringSoon} end within a day` : undefined} />
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export async function CrmSummary() {
  const r = await getOpsSnapshot()
  return (
    <Card>
      <CardHeader title={<Link href="/crm" className="hover:underline">Customers & tasks</Link>} meta="Command center records" />
      <CardBody>
        {r.state !== 'ok' ? <SourceProblem result={r} what="Customers" /> : (
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Open leads" value={formatCount(r.data.crm.openLeads)} tone={r.data.crm.staleLeads ? 'warn' : undefined} sub={r.data.crm.staleLeads ? `${r.data.crm.staleLeads} waiting 3+ days` : undefined} />
            <Kpi label="Customers" value={formatCount(r.data.crm.customers)} sub={`${formatCount(r.data.crm.contacts)} contacts`} />
            <Kpi label="Open tasks" value={formatCount(r.data.tasks.open)} tone={r.data.tasks.overdue ? 'warn' : undefined} sub={r.data.tasks.overdue ? `${r.data.tasks.overdue} overdue` : undefined} />
            <Kpi label="Possible double sales" value={formatCount(r.data.tasks.doubleSale)} tone={r.data.tasks.doubleSale ? 'bad' : undefined} />
          </div>
        )}
      </CardBody>
    </Card>
  )
}
