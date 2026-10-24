import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { listWebsiteProducts } from '@/lib/integrations/website/manage'
import { websiteQty } from '@/lib/sync/products'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { ActionForm, Field, LocationSelect, SelectAll } from '../forms'
import { adoptWebsiteAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function FromWebsitePage() {
  await requirePageAccess('inventory:operate')
  const r = await listWebsiteProducts('')
  const ops = await loadOps(async () => {
    const store = getOpsStore()
    const ids = r.state === 'ok' ? r.data.map((p) => p.id) : []
    const [locations, linked, sync] = await Promise.all([
      store.listLocations(),
      ids.length ? store.listItems({ websiteProductIds: ids, limit: 1000 }) : Promise.resolve([]),
      store.getCursor('ops:website_products'),
    ])
    return { locations, linked: new Set(linked.map((i) => i.websiteProductId)), sync }
  })
  const waiting = r.state === 'ok' && ops.ok ? r.data.filter((p) => !ops.data.linked.has(p.id)) : []
  const sellable = waiting.filter((p) => websiteQty(p) > 0)
  const soldOut = waiting.length - sellable.length
  return (
    <>
      <PageHeader
        title="From the website"
        description="Products that were added on the website itself (the phone studio at /manager/quick, or the old manager) and are not in inventory yet. Bringing one in creates the inventory item, already listed, linked to that product: website sales then mark it sold here. New studio products are brought in by the hourly sync on their own; this list is for the ones that existed before, and for anything the sync could not take."
        actions={<Link href="/inventory" className={btn}>Inventory</Link>}
      />
      <Card>
        <CardHeader title={`Not in inventory${r.state === 'ok' && ops.ok ? ` (${sellable.length})` : ''}`} meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          {r.state !== 'ok' ? (
            <SourceProblem result={r} what="Website products" />
          ) : !ops.ok ? (
            <OpsUnavailable message={ops.message} />
          ) : !sellable.length ? (
            <p className="text-sm text-muted">Every website product with stock is already in inventory.{soldOut ? ` ${soldOut} product(s) with no stock left are not offered.` : ''}</p>
          ) : (
            <ActionForm action={adoptWebsiteAction} hidden={{}} label="Bring into inventory" busy="Bringing in…" tone="primary" confirm="Create inventory items for the ticked products?" className="flex flex-col gap-4">
              <p className="text-sm text-muted">Tick only products that physically exist (in the shop or in storage). Up to 100 per confirm.{soldOut ? ` ${soldOut} product(s) with no stock left are not shown.` : ''}</p>
              <SelectAll name="productId" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-2 pe-2 font-medium"><span className="sr-only">Bring in</span></th><th className="py-2 pe-3 font-medium">Product</th><th className="py-2 pe-3 font-medium">Stock</th><th className="py-2 pe-3 font-medium">Price</th><th className="py-2 pe-3 font-medium">On the site</th></tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {sellable.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pe-2"><input type="checkbox" name="productId" value={p.id} aria-label={`Bring in ${p.name_he}`} className="h-5 w-5" /></td>
                        <td className="py-2 pe-3">
                          <div className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {p.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : null}
                            <Link href={`/website/products/${p.id}`} className={linkCls} dir="auto">{p.name_he}</Link>
                          </div>
                        </td>
                        <td className="num py-2 pe-3">{websiteQty(p)}</td>
                        <td className="num whitespace-nowrap py-2 pe-3">{p.price != null ? formatAgorot(shekelsToAgorot(p.price)) : '—'}</td>
                        <td className="py-2 pe-3 text-muted">{p.published === false ? 'Draft' : 'Published'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:max-w-sm">
                <Field label="Where they are"><LocationSelect locations={locationOptions(ops.data.locations)} /></Field>
              </div>
            </ActionForm>
          )}
          {ops.ok ? <p className="mt-3 text-meta text-faint">Automatic sync: {ops.data.sync.lastSuccessAt ? 'running' : 'not run yet'}{ops.data.sync.cursor ? `, products after #${ops.data.sync.cursor} are brought in by itself` : ''}. Switch it off under Tasks → Automations.</p> : null}
        </CardBody>
      </Card>
    </>
  )
}
