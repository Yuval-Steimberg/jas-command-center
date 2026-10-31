import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { listWebsiteOrders, ORDER_STATUSES } from '@/lib/integrations/website/manage'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { OrderNotesForm, OrderStatusForm } from '../forms'

export const dynamic = 'force-dynamic'

const ils = (v: number | null | undefined) => (v == null ? '—' : formatAgorot(shekelsToAgorot(v)))

export default async function WebsiteOrdersPage({ searchParams }: { searchParams?: { q?: string; status?: string } }) {
  await requirePageAccess('website:read')
  const s = (await getSession())!
  const pii = can(s.user.role, 'website:read_pii', s.overrides)
  const operate = can(s.user.role, 'website:operate', s.overrides)
  const raw = (typeof searchParams?.q === 'string' ? searchParams.q : '').trim().slice(0, 100)
  // Without read_pii a search may only name an order number, never a customer.
  const q = pii ? raw : raw.replace(/[^A-Za-z0-9-]/g, '')
  const status = ORDER_STATUSES.find((x) => x === searchParams?.status)
  const r = await listWebsiteOrders(q, status)
  return (
    <>
      <PageHeader
        title="Website orders"
        description="Orders paid on the website. Move each one along as you prepare it: processing, shipped, delivered. Payments, cancellations and refunds are handled in Grow, not here."
      />
      <Card>
        <CardHeader title="Orders" meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          <form action="/website/orders" className="mb-3 flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1"><span className="sr-only">Search</span><input name="q" defaultValue={raw} dir="auto" maxLength={100} placeholder={pii ? 'Order number, customer name, email or phone' : 'Order number (your role cannot search by customer)'} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm" /></label>
            <label><span className="sr-only">Status</span>
              <select name="status" defaultValue={status ?? ''} className="h-10 w-full rounded-md border border-line bg-surface px-2 text-sm sm:w-auto">
                <option value="">Any status</option>
                {ORDER_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Search</button>
          </form>
          {r.state !== 'ok' ? (
            <SourceProblem result={r} what="Website orders" />
          ) : !r.data.length ? (
            <p className="text-sm text-muted">No orders match.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {r.data.map((o) => (
                <li key={o.id} className="py-2">
                  <details>
                    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-mono text-xs">{o.order_number}</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-xs">{o.status}</span>
                      <span className="num">{ils(o.total)}</span>
                      <span dir="auto" className="min-w-0 flex-1 truncate">{pii ? o.customer_name : <span className="text-muted">customer hidden for your role</span>}</span>
                      <span className="text-xs text-muted">{formatDateTime(o.created_at)}</span>
                    </summary>
                    <div className="mt-3 grid gap-4 pb-2 lg:grid-cols-2">
                      <div className="flex flex-col gap-3 text-sm">
                        {pii ? (
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                            <dt className="text-muted">Customer</dt><dd dir="auto">{o.customer_name ?? '—'}</dd>
                            <dt className="text-muted">Email</dt><dd dir="ltr" className="break-all">{o.customer_email ?? '—'}</dd>
                            <dt className="text-muted">Phone</dt><dd dir="ltr">{o.customer_phone ?? '—'}</dd>
                          </dl>
                        ) : null}
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-line/50">
                            {(o.items ?? []).map((it, i) => (
                              <tr key={i}><td dir="auto" className="py-1 pe-2">{it.name_he || it.name_en || `#${it.product_id ?? '?'}`}</td><td className="num py-1 pe-2 text-end">×{it.quantity}</td><td className="num py-1 text-end">{ils(it.price * it.quantity)}</td></tr>
                            ))}
                            {o.items == null ? <tr><td className="py-1 text-muted">Items could not be read.</td></tr> : null}
                          </tbody>
                        </table>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                          <dt className="text-muted">Subtotal</dt><dd className="num">{ils(o.subtotal)}</dd>
                          <dt className="text-muted">Shipping</dt><dd className="num">{ils(o.shipping)}</dd>
                          {o.discount ? <><dt className="text-muted">Discount</dt><dd className="num">−{ils(o.discount)}</dd></> : null}
                          <dt className="text-muted">Total</dt><dd className="num font-semibold">{ils(o.total)}</dd>
                          {o.paid_at ? <><dt className="text-muted">Paid</dt><dd>{formatDateTime(o.paid_at)}</dd></> : null}
                        </dl>
                      </div>
                      <div className="flex flex-col gap-4">
                        {operate ? <OrderStatusForm id={o.id} orderNumber={o.order_number} status={o.status} /> : <p className="text-xs text-muted">Your role can view orders but not change them.</p>}
                        {operate && pii ? <OrderNotesForm id={o.id} notes={o.notes} /> : pii && o.notes ? <p dir="auto" className="whitespace-pre-wrap text-sm">{o.notes}</p> : null}
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {r.state === 'ok' && r.data.length === 100 ? <p className="mt-2 text-meta text-muted">Showing the newest 100. Narrow the search to see older orders.</p> : null}
        </CardBody>
      </Card>
    </>
  )
}
