import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, PoStatusChip, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel, locationLabels, locationOptions } from '@/lib/ops/views'
import { getSupplierStore } from '@/lib/suppliers/store'
import { PO_STATUS_LABEL, RECEIVABLE, editable, isOverdue, nextStatuses, poTotals, remaining, type PoStatus } from '@/lib/suppliers/model'
import { mailtoOrder, money, orderWhatsAppLink } from '@/lib/suppliers/service'
import { CONDITION_LABEL } from '@/lib/inventory/model'
import { CONDITIONS } from '@/lib/ops/types'
import { formatDateTime } from '@/lib/format'
import { input } from '../../../website/forms'
import { ActionForm, Field, LocationSelect } from '../../../inventory/forms'
import { receiveOrderAction, setOrderStatusAction } from '../../actions'
import { OrderForm } from '../../order-form'

export const dynamic = 'force-dynamic'

const MOVE: Partial<Record<PoStatus, { label: string; confirm?: string }>> = {
  ordered: { label: 'Mark as ordered' },
  cancelled: { label: 'Cancel order', confirm: 'Cancel this order?' },
  received: { label: 'Close: the rest is not coming', confirm: 'Close the order? Lines not fully received will no longer be expected.' },
}

export default async function OrderPage({ params }: { params: { id: string } }) {
  await requirePageAccess('inventory:read')
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')
  const showCost = may('inventory:write') || may('inventory:financial')
  const res = await loadOps(async () => {
    const po = await getSupplierStore().getOrder(params.id)
    if (!po) return null
    const ops = getOpsStore()
    const [supplier, receipts, locations, suppliers] = await Promise.all([
      ops.getContact(po.supplierId),
      getSupplierStore().listReceipts({ poId: po.id }),
      ops.listLocations(),
      may('inventory:write') && editable(po) ? ops.listContacts({ role: 'supplier', limit: 1000 }) : Promise.resolve([]),
    ])
    const items = receipts.length ? await ops.listItems({ ids: receipts.map((r) => r.itemId) }) : []
    return { po, supplier, receipts, locations, suppliers, items: new Map(items.map((i) => [i.id, i])) }
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return <><PageHeader title="Purchase order" /><OpsUnavailable title="Suppliers are not available" message={res.message} /></>

  const { po, supplier, receipts, locations, suppliers, items } = res.data!
  const t = poTotals(po)
  const labels = locationLabels(locations)
  const supplierName = supplier ? contactLabel(supplier, pii) : 'Supplier'
  const wa = supplier && pii ? orderWhatsAppLink(po, supplier) : null
  const mail = supplier && pii ? mailtoOrder(po, supplier) : null
  const canReceive = may('inventory:operate') && RECEIVABLE.includes(po.status) && po.lines.some((l) => remaining(l) > 0)
  const lineById = new Map(po.lines.map((l) => [l.id, l]))

  return (
    <>
      <PageHeader
        title={`Order ${po.number}`}
        description={<span className="flex flex-wrap items-center gap-2"><Link href={`/suppliers/${po.supplierId}`} className={linkCls} dir="auto">{supplierName}</Link><PoStatusChip status={po.status} late={isOverdue(po)} />{po.expectedAt ? <span>expected <span dir="ltr">{po.expectedAt}</span></span> : null}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {wa ? <a href={wa} target="_blank" rel="noreferrer" className={btn}>Send on WhatsApp</a> : null}
            {mail ? <a href={mail} className={btn}>Send by email</a> : null}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Lines" meta={`${t.unitsReceived} of ${t.units} arrived`} />
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Item</th><th className="font-normal">Ordered</th><th className="font-normal">Arrived</th>{showCost ? <><th className="font-normal">Unit</th><th className="font-normal">Total</th></> : null}</tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {po.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2" dir="auto">{l.description}{l.category ? <span className="text-xs text-muted"> · {l.category}</span> : null}</td>
                        <td className="num">{l.quantity}</td>
                        <td className={`num ${l.receivedQty >= l.quantity ? 'text-ok' : l.receivedQty ? 'text-warn' : ''}`}>{l.receivedQty}</td>
                        {showCost ? <><td className="num whitespace-nowrap">{l.unitCostMinor == null ? '—' : money(l.unitCostMinor)}</td><td className="num whitespace-nowrap">{l.unitCostMinor == null ? '—' : money(l.unitCostMinor * l.quantity)}</td></> : null}
                      </tr>
                    ))}
                  </tbody>
                  {showCost ? <tfoot><tr className="border-t border-line text-sm font-medium"><td className="py-2" colSpan={3}>Order total{t.uncosted ? ` (${t.uncosted} line(s) without a cost not counted)` : ''}</td><td /><td className="num whitespace-nowrap">{money(t.orderedMinor)}</td></tr></tfoot> : null}
                </table>
              </div>
              {po.note ? <p dir="auto" className="mt-3 whitespace-pre-line text-sm text-muted">{po.note}</p> : null}
            </CardBody>
          </Card>
          {canReceive ? (
            <Card>
              <CardHeader title="Receive goods" meta="creates inventory items" />
              <CardBody>
                <ActionForm action={receiveOrderAction} hidden={{ id: po.id, supplierId: po.supplierId, requestId: crypto.randomUUID() }} label="Receive into inventory" busy="Receiving…" tone="primary" confirm="Put these into inventory?" className="flex flex-col gap-3">
                  <p className="text-sm text-muted">The quantities are filled with what is still to come. Change any that arrived short, or clear a line that did not arrive.</p>
                  <ul className="flex flex-col gap-2">
                    {po.lines.filter((l) => remaining(l) > 0).map((l) => (
                      <li key={l.id} className="grid gap-2 rounded-md border border-line/70 bg-ground/40 p-2 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,2fr)] sm:items-end">
                        <span className="text-sm" dir="auto">{l.description} <span className="text-muted">({remaining(l)} to come)</span></span>
                        <Field label="Arrived"><input name={`qty_${l.id}`} type="number" min={0} max={remaining(l)} step={1} defaultValue={remaining(l)} dir="ltr" className={input} /></Field>
                        <Field label="Location (if different)"><LocationSelect name={`loc_${l.id}`} locations={locationOptions(locations)} /></Field>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Put everything in" hint={receipts[0]?.locationId ? 'Same place as the last delivery' : undefined}><LocationSelect locations={locationOptions(locations)} defaultValue={receipts[0]?.locationId} /></Field>
                    <Field label="Condition">
                      <select name="condition" defaultValue="as_new" className={input}>
                        {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                        <option value="">Not recorded</option>
                      </select>
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Received" meta={receipts.length ? `${receipts.length} entr${receipts.length === 1 ? 'y' : 'ies'}` : undefined} />
            <CardBody>
              {receipts.length === 0 ? <p className="text-sm text-muted">Nothing has arrived yet.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {receipts.map((r) => {
                    const it = items.get(r.itemId)
                    return (
                      <li key={r.id} className="flex flex-wrap gap-x-2">
                        <span className="text-muted">{formatDateTime(r.at)}</span>
                        <span className="num">{r.quantity} ×</span>
                        <span dir="auto">{lineById.get(r.lineId)?.description}</span>
                        {it ? <Link href={`/inventory/${it.id}`} className={linkCls} dir="ltr">{it.sku}</Link> : null}
                        {r.locationId ? <span className="text-muted" dir="auto">→ {labels.get(r.locationId)}</span> : null}
                        <span className="text-xs text-faint">{r.actorEmail}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Status" meta={PO_STATUS_LABEL[po.status]} />
            <CardBody>
              <dl className="mb-3 grid grid-cols-[7rem_1fr] gap-1 text-sm">
                <dt className="text-muted">Created</dt><dd>{formatDateTime(po.createdAt)}</dd>
                {po.orderedAt ? <><dt className="text-muted">Ordered</dt><dd>{formatDateTime(po.orderedAt)}</dd></> : null}
                {po.closedAt ? <><dt className="text-muted">Closed</dt><dd>{formatDateTime(po.closedAt)}</dd></> : null}
                <dt className="text-muted">By</dt><dd className="truncate">{po.createdBy}</dd>
              </dl>
              {may('inventory:write') ? (
                <div className="flex flex-wrap gap-2">
                  {nextStatuses(po).map((to) => (
                    <ActionForm key={to} action={setOrderStatusAction} hidden={{ id: po.id, to, version: po.version, supplierId: po.supplierId }} label={MOVE[to]?.label ?? to} busy="…" tone={to === 'ordered' ? 'primary' : 'plain'} confirm={MOVE[to]?.confirm} />
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
          {may('inventory:write') && editable(po) ? (
            <Card>
              <CardHeader title="Edit order" />
              <CardBody>
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Change lines, supplier or date</summary>
                  <div className="mt-3">
                    <OrderForm po={po} suppliers={suppliers.map((c) => ({ id: c.id, label: contactLabel(c, pii) }))} showCost={showCost} categories={[]} />
                  </div>
                </details>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
