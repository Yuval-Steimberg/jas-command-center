import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, PoStatusChip, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel } from '@/lib/ops/views'
import { getSupplierStore } from '@/lib/suppliers/store'
import { OPEN_PO, isOverdue, israelDay, poTotals, supplierStats } from '@/lib/suppliers/model'
import { money } from '@/lib/suppliers/service'
import { formatCount, timeAgo } from '@/lib/format'
import { input } from '../website/forms'
import { ActionForm, Field } from '../inventory/forms'
import { saveSupplierAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  await requirePageAccess('inventory:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')
  const showCost = may('inventory:write') || may('inventory:financial')
  const res = await loadOps(async () => {
    const [suppliers, orders, receipts] = await Promise.all([
      getOpsStore().listContacts({ role: 'supplier', limit: 1000 }),
      getSupplierStore().listOrders({ limit: 2000 }),
      getSupplierStore().listReceipts({ limit: 5000 }),
    ])
    return { suppliers, orders, receipts }
  })

  return (
    <>
      <PageHeader
        title="Suppliers & purchasing"
        description="Who you buy from, what is on order, and what arrived. Receiving an order puts the goods straight into inventory, in the location you choose."
        actions={may('inventory:write') ? <Link href="/suppliers/orders/new" className={btn}>New order</Link> : undefined}
      />
      {!res.ok ? <OpsUnavailable title="Suppliers are not available" message={res.message} /> : (() => {
        const { suppliers, orders, receipts } = res.data
        const names = new Map(suppliers.map((c) => [c.id, contactLabel(c, pii)]))
        const open = orders.filter((o) => OPEN_PO.includes(o.status)).sort((a, b) => (a.expectedAt ?? '9999').localeCompare(b.expectedAt ?? '9999'))
        const late = open.filter((o) => isOverdue(o))
        const monthStart = `${israelDay().slice(0, 7)}-01`
        const unitsThisMonth = receipts.filter((r) => r.at.slice(0, 10) >= monthStart).reduce((n, r) => n + r.quantity, 0)
        const onOrder = open.reduce((n, o) => { const t = poTotals(o); return n + t.orderedMinor - t.receivedMinor }, 0)
        const rows = suppliers
          .map((c) => ({ c, st: supplierStats(orders.filter((o) => o.supplierId === c.id), receipts.filter((r) => r.supplierId === c.id)) }))
          .sort((a, b) => b.st.open - a.st.open || (b.st.lastOrderAt ?? '').localeCompare(a.st.lastOrderAt ?? '') || a.c.fullName.localeCompare(b.c.fullName))
        return (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="Suppliers" value={formatCount(suppliers.length)} />
                <Kpi label="Open orders" value={formatCount(open.length)} />
                <Kpi label="Late" value={formatCount(late.length)} tone={late.length ? 'warn' : undefined} hint="Past the expected date and not fully received" />
                {showCost ? <Kpi label="Still on order" value={money(onOrder)} hint="Costed lines only" /> : <Kpi label="Units received this month" value={formatCount(unitsThisMonth)} />}
              </div>
              <Card>
                <CardHeader title="Orders on the way" meta="by expected date" />
                <CardBody>
                  {open.length === 0 ? <p className="text-sm text-muted">Nothing on order.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[34rem] text-sm">
                        <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Order</th><th className="font-normal">Supplier</th><th className="font-normal">Status</th><th className="font-normal">Expected</th><th className="font-normal">Arrived</th></tr></thead>
                        <tbody className="divide-y divide-line/60">
                          {open.map((o) => {
                            const t = poTotals(o)
                            return (
                              <tr key={o.id}>
                                <td className="py-2"><Link href={`/suppliers/orders/${o.id}`} className={`${linkCls} font-medium`} dir="ltr">{o.number}</Link></td>
                                <td dir="auto"><Link href={`/suppliers/${o.supplierId}`} className={linkCls}>{names.get(o.supplierId) ?? 'Supplier'}</Link></td>
                                <td><PoStatusChip status={o.status} late={isOverdue(o)} /></td>
                                <td className="whitespace-nowrap text-muted" dir="ltr">{o.expectedAt ?? '—'}</td>
                                <td className="num whitespace-nowrap">{t.unitsReceived} / {t.units}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Suppliers" meta={`${formatCount(suppliers.length)}`} />
                <CardBody>
                  {rows.length === 0 ? <p className="text-sm text-muted">No suppliers yet. Add one on the right, or give any contact the Supplier role.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[34rem] text-sm">
                        <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Supplier</th><th className="font-normal">Open</th><th className="font-normal">Orders</th><th className="font-normal">Last order</th>{showCost ? <th className="font-normal">Received value</th> : null}</tr></thead>
                        <tbody className="divide-y divide-line/60">
                          {rows.map(({ c, st }) => (
                            <tr key={c.id}>
                              <td className="py-2" dir="auto"><Link href={`/suppliers/${c.id}`} className={`${linkCls} font-medium`}>{contactLabel(c, pii)}</Link></td>
                              <td className="num">{st.open}{st.overdue ? <span className="text-warn"> ({st.overdue} late)</span> : null}</td>
                              <td className="num">{st.orders}</td>
                              <td className="whitespace-nowrap text-muted">{st.lastOrderAt ? timeAgo(st.lastOrderAt) : '—'}</td>
                              {showCost ? <td className="num whitespace-nowrap">{money(st.receivedMinor)}{st.uncostedLines ? <span className="text-muted" title="Lines without a unit cost are not counted"> +?</span> : null}</td> : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
            {may('crm:write') ? (
              <Card>
                <CardHeader title="Add a supplier" />
                <CardBody>
                  <ActionForm action={saveSupplierAction} hidden={{}} label="Add supplier" busy="Saving…" tone="primary">
                    <Field label="Business name"><input name="fullName" required dir="auto" maxLength={200} className={input} /></Field>
                    <Field label="Contact person"><input name="contactPerson" dir="auto" maxLength={200} className={input} /></Field>
                    <Field label="Phone" hint="Used for the WhatsApp order button"><input name="phone" dir="ltr" maxLength={40} className={input} /></Field>
                    <Field label="Email"><input name="email" type="email" dir="ltr" maxLength={200} className={input} /></Field>
                    <Field label="Notes" hint="What they sell, terms, opening hours"><input name="notes" dir="auto" maxLength={2000} className={input} /></Field>
                    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="kind" value="person" className="h-4 w-4" /> A private person, not a business</label>
                  </ActionForm>
                </CardBody>
              </Card>
            ) : null}
          </div>
        )
      })()}
    </>
  )
}
