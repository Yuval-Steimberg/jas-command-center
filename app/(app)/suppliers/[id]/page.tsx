import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { ItemStatusChip, OpsUnavailable, PoStatusChip, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel, locationLabels } from '@/lib/ops/views'
import { whatsappLink } from '@/lib/crm/model'
import { getSupplierStore } from '@/lib/suppliers/store'
import { isOverdue, poTotals, supplierStats } from '@/lib/suppliers/model'
import { money } from '@/lib/suppliers/service'
import { formatCount, formatDateTime, formatPct, timeAgo } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function SupplierPage({ params }: { params: { id: string } }) {
  await requirePageAccess('inventory:read')
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')
  const showCost = may('inventory:write') || may('inventory:financial')
  const res = await loadOps(async () => {
    const ops = getOpsStore()
    const sup = getSupplierStore()
    const contact = await ops.getContact(params.id)
    if (!contact) return null
    const [orders, receipts, items, locations] = await Promise.all([sup.listOrders({ supplierId: contact.id }), sup.listReceipts({ supplierId: contact.id, limit: 200 }), sup.itemsFrom(contact.id), ops.listLocations()])
    return { contact, orders, receipts, items, locations: locationLabels(locations) }
  })
  if (res.ok && !res.data) notFound()

  if (!res.ok) return <><PageHeader title="Supplier" /><OpsUnavailable title="Suppliers are not available" message={res.message} /></>
  const { contact: c, orders, receipts, items, locations } = res.data!
  const st = supplierStats(orders, receipts)
  const wa = pii ? whatsappLink(c.phone) : null
  const lineOf = new Map(orders.flatMap((o) => o.lines.map((l) => [l.id, { l, o }] as const)))
  const onTime = st.onTime.early + st.onTime.late ? st.onTime.early / (st.onTime.early + st.onTime.late) : null

  return (
    <>
      <PageHeader
        title={pii ? c.fullName : contactLabel(c, false)}
        description={c.roles.includes('supplier') ? 'Supplier' : 'Contact (not marked as a supplier yet: the first order adds the role)'}
        actions={
          <div className="flex flex-wrap gap-2">
            {may('inventory:write') ? <Link href={`/suppliers/orders/new?supplier=${c.id}`} className={btn}>New order</Link> : null}
            {wa ? <a href={wa} target="_blank" rel="noreferrer" className={btn}>WhatsApp</a> : null}
            {may('crm:read') ? <Link href={`/crm/${c.id}`} className={btn}>Contact page</Link> : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Open orders" value={formatCount(st.open)} sub={st.overdue ? `${st.overdue} late` : undefined} tone={st.overdue ? 'warn' : undefined} />
          <Kpi label="Orders" value={formatCount(st.orders)} sub={st.lastOrderAt ? `last ${timeAgo(st.lastOrderAt)}` : undefined} />
          <Kpi label="On time" value={formatPct(onTime, 0)} sub={onTime == null ? 'no dated orders received yet' : `${st.onTime.early + st.onTime.late} dated orders`} />
          {showCost ? <Kpi label="Received value" value={money(st.receivedMinor)} sub={st.uncostedLines ? `${st.uncostedLines} line(s) without a cost` : st.onOrderMinor ? `${money(st.onOrderMinor)} still on order` : undefined} /> : <Kpi label="Items received" value={formatCount(items.length)} />}
        </div>
        {pii && (c.phone || c.email || c.notes) ? (
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                {c.phone ? <><dt className="text-muted">Phone</dt><dd dir="ltr" className="text-left">{c.phone}</dd></> : null}
                {c.email ? <><dt className="text-muted">Email</dt><dd dir="ltr" className="text-left">{c.email}</dd></> : null}
                {c.notes ? <><dt className="text-muted">Notes</dt><dd dir="auto" className="whitespace-pre-line">{c.notes}</dd></> : null}
              </dl>
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Orders" meta={formatCount(orders.length)} />
          <CardBody>
            {orders.length === 0 ? <p className="text-sm text-muted">No orders yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Order</th><th className="font-normal">Status</th><th className="font-normal">Expected</th><th className="font-normal">Arrived</th>{showCost ? <th className="font-normal">Value</th> : null}</tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {orders.map((o) => {
                      const t = poTotals(o)
                      return (
                        <tr key={o.id}>
                          <td className="py-2"><Link href={`/suppliers/orders/${o.id}`} className={`${linkCls} font-medium`} dir="ltr">{o.number}</Link> <span className="text-xs text-muted">{timeAgo(o.createdAt)}</span></td>
                          <td><PoStatusChip status={o.status} late={isOverdue(o)} /></td>
                          <td className="whitespace-nowrap text-muted" dir="ltr">{o.expectedAt ?? '—'}</td>
                          <td className="num whitespace-nowrap">{t.unitsReceived} / {t.units}</td>
                          {showCost ? <td className="num whitespace-nowrap">{money(t.orderedMinor)}{t.uncosted ? ' +?' : ''}</td> : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Items from this supplier" meta={formatCount(items.length)} />
            <CardBody>
              {items.length === 0 ? <p className="text-sm text-muted">Nothing received yet.</p> : (
                <ul className="flex flex-col divide-y divide-line/60 text-sm">
                  {items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <Link href={`/inventory/${i.id}`} className={`${linkCls} font-medium`} dir="auto">{i.sku} · {i.title}</Link>
                      <ItemStatusChip status={i.status} />
                      {i.quantity > 1 ? <span className="text-muted">× {i.quantity}</span> : null}
                      {i.locationId ? <span className="text-xs text-muted" dir="auto">{locations.get(i.locationId)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Deliveries received" meta="history" />
            <CardBody>
              {receipts.length === 0 ? <p className="text-sm text-muted">No deliveries yet.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {receipts.map((r) => {
                    const x = lineOf.get(r.lineId)
                    return (
                      <li key={r.id} className="flex flex-wrap gap-x-2">
                        <span className="text-muted">{formatDateTime(r.at)}</span>
                        <span className="num">{r.quantity} ×</span>
                        <span dir="auto">{x?.l.description ?? 'item'}</span>
                        {x ? <Link href={`/suppliers/orders/${x.o.id}`} className={`${linkCls} text-muted`} dir="ltr">{x.o.number}</Link> : null}
                        <span className="text-xs text-faint">{r.actorEmail}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
