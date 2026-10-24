import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { SourceProblem } from '@/components/ui/source-state'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { syncStatus } from '@/lib/sync/run'
import { listWebsiteOrders, type WebsiteOrder } from '@/lib/integrations/website/manage'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { formatCount, formatDateTime, timeAgo } from '@/lib/format'
import { ActionForm } from '../inventory/forms'
import { syncNowAction } from './actions'
import { getSalesStore } from '@/lib/sales/store'
import { PAYMENT_STATE_LABEL, saleMoney } from '@/lib/sales/model'
import { inventorySection } from '@/lib/analytics/ops'
import { israelDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

/** Movements read for the 30-day figures; reaching it marks them a lower bound, as on /analytics. */
const MOVES_CAP = 5000

const STEP_LABEL = { orders: 'Website orders → inventory + customers', forms: 'Website forms → leads', reservations: 'Expired reservations', products: 'Website products → inventory, stock checks' } as const

export default async function SalesPage() {
  await requirePageAccess('inventory:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  // The three reads are independent: run them together, so the page waits for the slowest one, not the sum.
  const [res, shop, queue] = await Promise.all([
    loadOps(async () => {
      const store = getOpsStore()
      const [sync, sold, deliveries, moves] = await Promise.all([syncStatus(), store.listItems({ statuses: ['sold', 'delivered'], limit: 1000 }), store.listDeliveries({ statuses: ['planned', 'out'] }), store.recentMovements(MOVES_CAP, since)])
      return { sync, sold, moves, plannedOrders: new Set(deliveries.map((d) => d.websiteOrderId).filter((x): x is number => x != null)) }
    }),
    // Shop sales live in migration 0006: a database without it still shows everything else.
    loadOps(async () => {
      const st = getSalesStore()
      const sales = await st.listSales({ limit: 50 })
      const ids = sales.map((x) => x.id)
      const contactIds = [...new Set(sales.map((x) => x.contactId).filter((x): x is string => !!x))]
      const [lines, payments, contacts] = await Promise.all([st.linesOf(ids), st.paymentsOf(ids), may('crm:read') && contactIds.length ? getOpsStore().listContacts({ ids: contactIds, limit: contactIds.length }) : []])
      return { sales, lines, payments, names: new Map(contacts.map((c) => [c.id, may('crm:read_pii') ? c.fullName : 'Customer'])) }
    }),
    may('website:read') ? Promise.all((['paid', 'processing', 'shipped'] as const).map((st) => listWebsiteOrders('', st))) : null,
  ])
  const queueProblem = queue?.find((r): r is Exclude<typeof r, { state: 'ok' }> => r.state !== 'ok')
  const orders: WebsiteOrder[] = queue && !queueProblem ? queue.flatMap((r) => (r.state === 'ok' ? r.data : [])).sort((a, b) => a.created_at.localeCompare(b.created_at)) : []
  const pii = may('website:read_pii')

  const recent = res.ok ? res.data.sold.filter((i) => i.soldAt && i.soldAt >= since) : []
  const inStore = recent.filter((i) => i.soldChannel === 'in_store')
  // The 30-day figures use the analytics definitions (lib/analytics/ops.ts), so this page and /analytics agree:
  // every shop line counts (units of a lot included), returns are taken off, and a website sale counts once.
  const period = { from: israelDate(new Date(since)), to: israelDate() }
  const sec = res.ok ? inventorySection({ state: 'ok', data: { items: res.data.sold, movements: res.data.moves, deals: [], contacts: [], truncated: res.data.moves.length >= MOVES_CAP }, checkedAt: '' }, period, period) : null
  const metric = (id: string) => sec?.metrics.find((m) => m.id === id)?.value ?? null

  return (
    <>
      <PageHeader
        title="Sales & fulfilment"
        description="What has been sold and what still has to reach its buyer. Website orders are owned by the website and read live; in-store sales of inventory items are recorded here. The two are shown apart and never added up, and gift cards (their own system) are not part of either."
        actions={<div className="flex flex-wrap items-start gap-2">{may('inventory:financial') ? <Link href="/sales/new" className={btn}>New shop sale</Link> : null}{may('inventory:operate') ? <ActionForm action={syncNowAction} hidden={{}} label="Sync now" busy="Syncing…" className="flex flex-col items-end gap-1" /> : null}</div>}
      />
      {!res.ok ? <OpsUnavailable message={res.message} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Website orders to fulfil" value={queue && !queueProblem ? formatCount(orders.length) : '—'} sub="paid, processing or shipped" />
            <Kpi label="In-store sales, 30 days" value={formatCount(metric('inv.inStoreSales'))} sub={metric('inv.inStoreNet') == null ? undefined : `${formatAgorot(metric('inv.inStoreNet')!, { whole: true })} after returns`} hint="Shop sale lines in the last 30 days, the same figure as Analytics. Not website revenue." />
            <Kpi label="Inventory sold online, 30 days" value={formatCount(metric('inv.soldOnline'))} sub="their revenue is in the website's numbers" />
            <Kpi label="Sold, not delivered" value={formatCount(res.data.sold.filter((i) => i.status === 'sold').length)} />
          </div>

          <Card className="mb-4">
            <CardHeader title="Shop sales" meta="newest first · open lines are still to be picked up or delivered" action={may('inventory:financial') ? <Link href="/sales/new" className={`${linkCls} text-sm`}>New sale</Link> : undefined} />
            <CardBody>
              {!shop.ok ? <OpsUnavailable message={shop.message} /> : shop.data.sales.length === 0 ? <p className="text-sm text-muted">No shop sales yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="text-xs text-muted"><tr><th className="py-2 text-start font-medium">Sale</th><th className="text-start font-medium">Customer</th><th className="text-start font-medium">Items</th><th className="text-end font-medium">Total</th><th className="text-start font-medium ps-3">Payment</th><th className="text-start font-medium">Handover</th></tr></thead>
                    <tbody>
                      {shop.data.sales.map((sale) => {
                        const lines = shop.data.lines.filter((l) => l.saleId === sale.id)
                        const m = saleMoney(sale, lines, shop.data.payments.filter((p) => p.saleId === sale.id))
                        const open = lines.filter((l) => l.status === 'open').length
                        return (
                          <tr key={sale.id} className="border-t border-line/60 align-top">
                            <td className="py-2"><Link href={`/sales/${sale.id}`} className={linkCls} dir="ltr">{sale.number}</Link><div className="text-xs text-muted">{timeAgo(sale.createdAt)}</div></td>
                            <td dir="auto">{sale.contactId ? shop.data.names.get(sale.contactId) ?? 'Customer' : <span className="text-muted">walk-in</span>}</td>
                            <td className="num">{lines.reduce((a, l) => a + l.quantity, 0)}</td>
                            <td className="num text-end">{formatAgorot(m.dueMinor)}</td>
                            <td className={`ps-3 ${m.state === 'paid' || m.state === 'nothing_due' ? 'text-ok' : 'text-warn'}`}>{PAYMENT_STATE_LABEL[m.state]}{m.balanceMinor > 0 ? ` · ${formatAgorot(m.balanceMinor)} due` : ''}</td>
                            <td className={open ? 'text-warn' : 'text-muted'}>{open ? `${open} open` : 'done'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader title="Website fulfilment queue" meta="oldest first, read live" action={may('website:read') ? <Link href="/website/orders" className={`${linkCls} text-sm`}>All orders</Link> : undefined} />
              <CardBody>
                {!queue ? <p className="text-sm text-muted">Your role cannot read website orders.</p> : queueProblem ? <SourceProblem result={queueProblem} what="website orders" /> : orders.length === 0 ? (
                  <p className="text-sm text-muted">Nothing waiting.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="text-xs text-muted"><tr><th className="py-2 text-start font-medium">Order</th><th className="text-start font-medium">Status</th><th className="text-start font-medium">Items</th><th className="text-end font-medium">Total</th><th className="text-start font-medium ps-3">Delivery</th></tr></thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id} className="border-t border-line/60 align-top">
                            <td className="py-2"><span dir="ltr">{o.order_number}</span><div className="text-xs text-muted">{pii && o.customer_name ? <span dir="auto">{o.customer_name} · </span> : null}{timeAgo(o.created_at)}</div></td>
                            <td>{o.status}</td>
                            <td dir="auto" className="max-w-[16rem] text-muted">{(o.items ?? []).map((l) => `${l.quantity}× ${l.name_he ?? l.name_en ?? 'item'}`).join(', ')}</td>
                            <td className="num text-end">{formatAgorot(shekelsToAgorot(o.total))}</td>
                            <td className="ps-3">{res.data.plannedOrders.has(o.id) ? <span className="text-ok">planned</span> : <Link href="/deliveries" className={linkCls}>plan</Link>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>

            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader title="Sync with the website" meta="hourly, and on Sync now" />
                <CardBody>
                  <ul className="flex flex-col gap-3 text-sm">
                    {(Object.keys(STEP_LABEL) as (keyof typeof STEP_LABEL)[]).map((k) => {
                      const c = res.data.sync[k]
                      return (
                        <li key={k}>
                          <p className="font-medium text-ink">{STEP_LABEL[k]}</p>
                          <p className="text-xs text-muted">{c.lastSuccessAt ? `last ok ${timeAgo(c.lastSuccessAt)}` : 'never run'}{c.cursor && k === 'products' ? ` · up to product #${c.cursor}` : c.cursor && k !== 'reservations' ? ` · up to ${formatDateTime(c.cursor)}` : ''}</p>
                          {c.lastError ? <p dir="auto" className="text-xs text-bad">{c.lastError}</p> : null}
                        </li>
                      )
                    })}
                  </ul>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="In-store sales" meta="last 30 days" />
                <CardBody>
                  {inStore.length === 0 ? <p className="text-sm text-muted">None recorded. Start one with New shop sale.</p> : (
                    <ul className="flex flex-col gap-2 text-sm">
                      {inStore.sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? '')).map((i) => (
                        <li key={i.id} className="flex flex-wrap gap-x-2">
                          <Link href={`/inventory/${i.id}`} className={linkCls} dir="auto">{i.sku} · {i.title}</Link>
                          <span className="num">{formatAgorot(i.soldPriceMinor ?? 0)}</span>
                          <span className="text-xs text-muted">{timeAgo(i.soldAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-meta text-faint">A returned item leaves this list; its history keeps the sale.</p>
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  )
}
