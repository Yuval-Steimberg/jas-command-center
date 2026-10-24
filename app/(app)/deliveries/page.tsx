import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel } from '@/lib/ops/views'
import type { DeliveryStatus } from '@/lib/ops/types'
import { DELIVERY_NEXT } from '@/lib/deliveries/service'
import { formatCount, formatDateTime, timeAgo } from '@/lib/format'
import { input } from '../website/forms'
import { ActionForm, Field } from '../inventory/forms'
import { createDeliveryAction, moveDeliveryAction } from './actions'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<DeliveryStatus, string> = { planned: 'Planned', out: 'On the way', done: 'Delivered', failed: 'Did not happen', cancelled: 'Cancelled' }
const MOVE_LABEL: Record<DeliveryStatus, string> = { planned: 'Plan again', out: 'On the way', done: 'Delivered', failed: 'Did not happen', cancelled: 'Cancel' }

export default async function DeliveriesPage({ searchParams }: { searchParams?: { item?: string } }) {
  await requirePageAccess('inventory:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')
  const res = await loadOps(async () => {
    const store = getOpsStore()
    const [active, closed, sold] = await Promise.all([
      store.listDeliveries({ statuses: ['planned', 'out', 'failed'] }),
      store.listDeliveries({ statuses: ['done', 'cancelled'], limit: 30 }),
      store.listItems({ statuses: ['sold'], limit: 300 }),
    ])
    const contactIds = [...new Set([...active, ...closed].map((d) => d.contactId).filter((x): x is string => !!x))]
    const itemIds = [...new Set([...active, ...closed].map((d) => d.itemId).filter((x): x is string => !!x))]
    const [contacts, itemRows] = await Promise.all([
      contactIds.length && may('crm:read') ? store.listContacts({ ids: contactIds, limit: contactIds.length }) : [],
      itemIds.length ? store.listItems({ ids: itemIds, limit: itemIds.length }) : [],
    ])
    const items = new Map(itemRows.map((i) => [i.id, i]))
    const planned = new Set(active.map((d) => d.itemId))
    return { active, closed: closed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), unplanned: sold.filter((i) => !planned.has(i.id)), contacts: new Map(contacts.map((c) => [c.id, c])), items }
  })
  const preItem = typeof searchParams?.item === 'string' ? searchParams.item : ''

  return (
    <>
      <PageHeader
        title="Deliveries & pickups"
        description="Getting sold items to their buyers. Marking a delivery done also marks the item delivered here and the website order delivered on the website (through the website's own guarded write)."
      />
      {!res.ok ? <OpsUnavailable message={res.message} /> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              <Kpi label="Sold, nothing planned" value={formatCount(res.data.unplanned.length)} tone={res.data.unplanned.length ? 'warn' : undefined} />
              <Kpi label="Planned" value={formatCount(res.data.active.filter((d) => d.status === 'planned').length)} />
              <Kpi label="On the way" value={formatCount(res.data.active.filter((d) => d.status === 'out').length)} />
            </div>
            <Card>
              <CardHeader title="Open" meta="by date" />
              <CardBody>
                {res.data.active.length === 0 ? <p className="text-sm text-muted">Nothing planned.</p> : (
                  <ul className="flex flex-col divide-y divide-line/60">
                    {res.data.active.map((d) => {
                      const c = d.contactId ? res.data.contacts.get(d.contactId) : undefined
                      const it = d.itemId ? res.data.items.get(d.itemId) : undefined
                      return (
                        <li key={d.id} className="flex flex-col gap-2 py-3 text-sm">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={`font-medium ${d.status === 'failed' ? 'text-bad' : 'text-ink'}`}>{STATUS_LABEL[d.status]}</span>
                            <span className="text-muted">{d.scheduledFor ? formatDateTime(d.scheduledFor).split(',')[0] : 'no date'}{d.timeWindow ? ` · ${d.timeWindow}` : ''}</span>
                            {it ? <Link href={`/inventory/${it.id}`} className={linkCls} dir="auto">{it.sku} · {it.title}</Link> : null}
                            {d.websiteOrderNumber ? <span dir="ltr" className="text-muted">{d.websiteOrderNumber}</span> : null}
                            {c ? <Link href={`/crm/${c.id}`} className={linkCls} dir="auto">{contactLabel(c, pii)}</Link> : null}
                          </div>
                          {pii && d.address ? <p dir="auto" className="text-muted">{d.address}</p> : null}
                          {d.note ? <p dir="auto" className="text-xs text-muted">{d.note}</p> : null}
                          {may('inventory:operate') ? (
                            <div className="flex flex-wrap gap-2">
                              {DELIVERY_NEXT[d.status].map((to) => (
                                <ActionForm key={to} action={moveDeliveryAction} hidden={{ id: d.id, to }} label={MOVE_LABEL[to]} busy="…" tone={to === 'done' ? 'primary' : 'plain'} confirm={to === 'done' ? 'Mark delivered? This also marks the item and the website order delivered.' : to === 'cancelled' ? 'Cancel this delivery?' : undefined} className="flex flex-col gap-1" />
                              ))}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Closed recently" />
              <CardBody>
                {res.data.closed.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {res.data.closed.map((d) => {
                      const it = d.itemId ? res.data.items.get(d.itemId) : undefined
                      return <li key={d.id} className="text-muted">{STATUS_LABEL[d.status]} · {it ? `${it.sku} · ${it.title}` : d.websiteOrderNumber} · {timeAgo(d.updatedAt)}</li>
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          {may('inventory:operate') ? (
            <Card>
              <CardHeader title="Plan a delivery or pickup" />
              <CardBody>
                <ActionForm action={createDeliveryAction} hidden={{}} label="Plan it" busy="Saving…" tone="primary">
                  <Field label="Sold item">
                    <select name="itemId" defaultValue={preItem} className={input}>
                      <option value="">— none —</option>
                      {res.data.unplanned.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.title}</option>)}
                    </select>
                  </Field>
                  <Field label="or a website order number" hint="For shop products that never came through intake"><input name="orderNumber" dir="ltr" maxLength={40} className={input} /></Field>
                  <Field label="Date"><input name="date" type="date" dir="ltr" className={input} /></Field>
                  <Field label="Time window"><input name="window" dir="auto" maxLength={60} placeholder="e.g. 10:00–13:00" className={input} /></Field>
                  {pii ? <Field label="Address"><input name="address" dir="auto" maxLength={300} className={input} /></Field> : null}
                  <Field label="Note"><input name="note" dir="auto" maxLength={500} className={input} /></Field>
                  <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mine" className="h-4 w-4" /> I am taking it</label>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </>
  )
}
