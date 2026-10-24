import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { ItemStatusChip, OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationLabels } from '@/lib/ops/views'
import { ITEM_STATUSES, type ItemStatus } from '@/lib/ops/types'
import { STATUS_LABEL, daysHeld } from '@/lib/inventory/model'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { listWebsiteProducts, listWebsiteProductsByIds } from '@/lib/integrations/website/manage'
import { formatAgorot } from '@/lib/money'
import { formatCount } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function InventoryPage({ searchParams }: { searchParams?: { q?: string; status?: string; location?: string; view?: string } }) {
  await requirePageAccess('inventory:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const q = (typeof searchParams?.q === 'string' ? searchParams.q : '').trim().slice(0, 100)
  const status = ITEM_STATUSES.find((x) => x === searchParams?.status)
  const statuses: ItemStatus[] | undefined = status ? [status] : searchParams?.view === 'all' ? undefined : ['in_storage', 'listed', 'reserved', 'sold']
  const location = typeof searchParams?.location === 'string' ? searchParams.location : ''

  const res = await loadOps(async () => {
    const store = getOpsStore()
    const [items, locations] = await Promise.all([store.listItems({ statuses, q: q || undefined, locationId: location || undefined, limit: 500 }), store.listLocations()])
    return { items, locations }
  })
  const snap = await getOpsSnapshot()
  const linkedIds = res.ok ? res.data.items.map((i) => i.websiteProductId).filter((x): x is number => x != null) : []
  const [web, allWeb] = await Promise.all([linkedIds.length ? listWebsiteProductsByIds(linkedIds) : null, may('website:read') ? listWebsiteProducts('') : null])
  const webById = new Map(web?.state === 'ok' ? web.data.map((p) => [p.id, p]) : [])

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every physical item after intake: where it is, its condition, and its way to a buyer, a donation or recycling. Once listed, the website owns the item's price, visibility and stock; this page reads them live. Products added on the website itself (the phone studio) come in by the hourly sync; older ones are listed below until someone brings them in."
        actions={
          <div className="flex flex-wrap gap-2">
            {may('inventory:operate') ? <Link href="/inventory/intake" className={btn}>Intake from collections</Link> : null}
            {may('inventory:operate') ? <Link href="/inventory/website" className={btn}>From the website</Link> : null}
            {may('inventory:write') ? <Link href="/inventory/new" className={btn}>Add an item</Link> : null}
            <Link href="/inventory/scan" className={btn}>Scan</Link>
            <Link href="/inventory/locations" className={btn}>Locations</Link>
          </div>
        }
      />
      {snap.state === 'ok' ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Available" value={formatCount(snap.data.items.available)} sub="in storage + listed" />
          <Kpi label="Not listed yet" value={formatCount(snap.data.items.unlisted)} sub={snap.data.items.agingUnlisted ? `${snap.data.items.agingUnlisted} for 60+ days` : undefined} tone={snap.data.items.agingUnlisted ? 'warn' : undefined} />
          <Kpi label="Listed online" value={formatCount(snap.data.items.byStatus.listed)} />
          <Kpi label="Reserved" value={formatCount(snap.data.items.byStatus.reserved)} />
          <Kpi label="Sold, not delivered" value={formatCount(snap.data.items.awaitingDelivery)} />
          <Kpi label="Asking value" value={formatAgorot(snap.data.items.askingValueMinor, { whole: true })} sub={`${snap.data.items.priced} priced items`} hint="Sum of asking prices of available items that have one. Not revenue." />
        </div>
      ) : null}

      <Card>
        <CardHeader title="Items" meta={res.ok ? `${res.data.items.length} shown${res.data.items.length === 500 ? ' (first 500; narrow the search)' : ''}` : undefined} />
        <CardBody>
          <form action="/inventory" className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <label className="min-w-0"><span className="sr-only">Search</span><input name="q" defaultValue={q} dir="auto" maxLength={100} placeholder="SKU, name, category or project" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm" /></label>
            <label><span className="sr-only">Status</span>
              <select name="status" defaultValue={status ?? ''} className="h-10 w-full rounded-md border border-line bg-surface px-2 text-sm">
                <option value="">On hand (not final)</option>
                {ITEM_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
              </select>
            </label>
            <label><span className="sr-only">Location</span>
              <select name="location" defaultValue={location} className="h-10 w-full rounded-md border border-line bg-surface px-2 text-sm">
                <option value="">Any location</option>
                {res.ok ? [...locationLabels(res.data.locations)].map(([id, label]) => <option key={id} value={id}>{label}</option>) : null}
              </select>
            </label>
            <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Filter</button>
          </form>
          {!res.ok ? (
            <OpsUnavailable message={res.message} />
          ) : !res.data.items.length ? (
            <p className="text-sm text-muted">{q || status || location ? 'No items match.' : 'No items yet. Take in collected furniture, or add an item by hand.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 pe-3 font-medium">SKU</th><th className="py-2 pe-3 font-medium">Item</th><th className="py-2 pe-3 font-medium">Status</th><th className="py-2 pe-3 font-medium">Location</th><th className="py-2 pe-3 text-end font-medium">Price</th><th className="py-2 pe-3 font-medium">Website</th><th className="py-2 text-end font-medium">Days</th></tr></thead>
                <tbody className="divide-y divide-line/60">
                  {res.data.items.map((i) => {
                    const p = i.websiteProductId != null ? webById.get(i.websiteProductId) : undefined
                    const labels = locationLabels(res.data.locations)
                    return (
                      <tr key={i.id}>
                        <td className="py-2 pe-3 font-mono text-xs"><Link href={`/inventory/${i.id}`} className={linkCls}>{i.sku}</Link></td>
                        <td dir="auto" className="max-w-[280px] truncate py-2 pe-3"><Link href={`/inventory/${i.id}`} className={linkCls}>{i.title}</Link>{i.quantity > 1 ? <span className="text-muted"> ×{i.quantity}</span> : null}</td>
                        <td className="py-2 pe-3"><ItemStatusChip status={i.status} /></td>
                        <td className="py-2 pe-3 text-muted">{i.locationId ? labels.get(i.locationId) ?? '—' : '—'}</td>
                        <td className="num py-2 pe-3 text-end">{p?.price != null ? formatAgorot(Math.round(p.price * 100)) : i.priceMinor ? formatAgorot(i.priceMinor) : '—'}</td>
                        <td className="py-2 pe-3 text-xs">{i.websiteProductId == null ? <span className="text-muted">not listed</span> : !p ? <span className="text-muted">#{i.websiteProductId}{web && web.state !== 'ok' ? ' (could not read)' : ''}</span> : <span>{p.published === false ? 'draft' : 'published'} · stock {p.in_stock === false ? 0 : (p.quantity ?? 1)}</span>}</td>
                        <td className="num py-2 text-end text-muted">{daysHeld(i)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">{searchParams?.view === 'all' ? <Link href="/inventory" className={linkCls}>Hide delivered, donated and recycled</Link> : <Link href="/inventory?view=all" className={linkCls}>Include delivered, donated and recycled</Link>}</p>
        </CardBody>
      </Card>

      {allWeb ? (
        <Card className="mt-4">
          <CardHeader title="Website-only stock" meta={allWeb.state === 'ok' ? <Freshness checkedAt={allWeb.checkedAt} source={allWeb.source} latencyMs={allWeb.latencyMs} /> : 'Shop products that did not come through intake. The website owns them; edit on the product page.'} />
          <CardBody>
            {allWeb.state !== 'ok' ? (
              <SourceProblem result={allWeb} what="Website products" />
            ) : (() => {
              const linked = new Set(res.ok ? res.data.items.map((i) => i.websiteProductId) : [])
              const own = allWeb.data.filter((p) => !linked.has(p.id) && !/^jas-\d{6}$/.test(p.slug))
              return own.length ? (
                <>
                {may('inventory:operate') ? <p className="mb-2 text-sm"><Link href="/inventory/website" className={linkCls}>Bring these into inventory</Link> <span className="text-muted">so website sales of them show here.</span></p> : null}
                <ul className="divide-y divide-line/60 text-sm">
                  {own.slice(0, 50).map((p) => (
                    <li key={p.id} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                      <Link href={`/website/products/${p.id}`} dir="auto" className={`min-w-0 flex-1 truncate ${linkCls}`}>{p.name_he}</Link>
                      <span className="num text-muted">{p.price != null ? formatAgorot(Math.round(p.price * 100)) : '—'}</span>
                      <span className={p.in_stock === false || p.quantity === 0 ? 'text-bad' : 'text-muted'}>stock {p.in_stock === false ? 0 : (p.quantity ?? '—')}</span>
                      <span className="text-xs text-muted">{p.published === false ? 'draft' : 'published'}</span>
                    </li>
                  ))}
                </ul>
                </>
              ) : <p className="text-sm text-muted">Every website product is in inventory.</p>
            })()}
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}
