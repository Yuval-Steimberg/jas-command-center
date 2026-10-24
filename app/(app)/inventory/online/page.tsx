import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { listWebsiteProducts } from '@/lib/integrations/website/manage'
import { websiteQty } from '@/lib/sync/products'
import { AVAILABLE, draftProduct } from '@/lib/inventory/model'
import { driveFileId } from '@/lib/inventory/drive'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'
import { ActionForm, SelectAll } from '../forms'
import { copyDrivePhotosAction, hideWebsiteAction, listManyAction } from '../actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/**
 * What the website shop shows, next to what is on the shelf: hide old
 * products (unpublished, never deleted) and put items in storage on sale in
 * one press. Each write goes through the same functions as an item's page.
 */
export default async function WebsiteShopPage() {
  await requirePageAccess('website:write')
  const r = await listWebsiteProducts('')
  const ops = await loadOps(async () => {
    const store = getOpsStore()
    const [items, onDrive, linked] = await Promise.all([
      store.listItems({ statuses: ['in_storage'], limit: 1000 }),
      store.listItems({ statuses: [...AVAILABLE, 'reserved'], limit: 1000 }),
      r.state === 'ok' && r.data.length ? store.listItems({ websiteProductIds: r.data.map((p) => p.id), limit: 1000 }) : Promise.resolve([]),
    ])
    return { items, drive: onDrive.filter((i) => [i.photoUrl, ...(i.extraPhotos ?? [])].some((l) => driveFileId(l))), linked: new Map(linked.map((i) => [i.websiteProductId!, i])) }
  })

  const onSale = r.state === 'ok' ? r.data.filter((p) => p.published !== false && websiteQty(p) > 0) : []
  const names = new Map(onSale.map((p) => [norm(p.name_he), p]))
  const items = ops.ok ? ops.data.items.map((i) => ({ i, draft: draftProduct(i), twin: names.get(norm(i.title)) ?? null })) : []
  const ready = items.filter((x) => x.draft.ok)
  const blocked = items.length - ready.length

  return (
    <>
      <PageHeader
        title="Website shop"
        description="What visitors see in the website shop, and the items in storage that are not on it. Hiding unpublishes a product: it disappears from the shop, past orders keep pointing at it, and it can be published again from its website page. Putting items on sale creates one published website product per item, linked to it, so a website sale marks it sold here and a shop sale takes it off the website."
        actions={<Link href="/inventory" className={btn}>Inventory</Link>}
      />
      <Card>
        <CardHeader title={`On the website shop now${r.state === 'ok' ? ` (${onSale.length})` : ''}`} meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          {r.state !== 'ok' ? <SourceProblem result={r} what="Website products" /> : !onSale.length ? <p className="text-sm text-muted">Nothing is on sale on the website.</p> : (
            <ActionForm action={hideWebsiteAction} hidden={{}} label="Hide the ticked products" busy="Hiding…" tone="plain" confirm="Hide the ticked products from the website shop? They are kept and can be published again." className="flex flex-col gap-4">
              <p className="text-sm text-muted">Tick what should no longer be in the shop. Products linked to an inventory item show its SKU.</p>
              <SelectAll name="productId" />
              <ProductTable rows={onSale.map((p) => ({ p, sku: ops.ok ? ops.data.linked.get(p.id)?.sku ?? null : null }))} />
            </ActionForm>
          )}
        </CardBody>
      </Card>
      {ops.ok && ops.data.drive.length ? (
        <Card>
          <CardHeader title={`Photos still on Google Drive (${ops.data.drive.length})`} />
          <CardBody>
            <ActionForm action={copyDrivePhotosAction} hidden={{}} label="Copy the photos here" busy="Copying…" tone="plain" className="flex flex-col gap-3">
              <p className="text-sm text-muted">Phones and the website cannot always show a Google Drive link, so these items show a broken photo. This copies each photo into the command center&apos;s own photo store and points the item at the copy (the folder must be shared &quot;anyone with the link&quot;). 30 items per press; putting an item on sale below copies its photo first anyway.</p>
              {ops.data.drive.map((i) => <input key={i.id} type="hidden" name="itemId" value={i.id} />)}
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={`In storage, not on the website${ops.ok ? ` (${ready.length})` : ''}`} />
        <CardBody>
          {!ops.ok ? <OpsUnavailable message={ops.message} /> : !ready.length ? (
            <p className="text-sm text-muted">Every item in storage that has a price and a photo is on the website.{blocked ? ` ${blocked} item(s) need a price or an https photo first.` : ''}</p>
          ) : (
            <ActionForm action={listManyAction} hidden={{}} label="Put the ticked items on sale" busy="Listing…" tone="primary" confirm="Publish the ticked items on the website shop now?" className="flex flex-col gap-4">
              <p className="text-sm text-muted">
                Each goes live at its asking price with its photo, in the website category of the same name (none if the website has no such category). Up to 30 per press; tick the rest again after.
                {blocked ? ` ${blocked} item(s) are not offered: they need a price or an https photo first.` : ''}
              </p>
              <SelectAll name="itemId" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-2 pe-2 font-medium"><span className="sr-only">Put on sale</span></th><th className="py-2 pe-3 font-medium">Item</th><th className="py-2 pe-3 font-medium">Category</th><th className="py-2 pe-3 font-medium">Price</th><th className="py-2 pe-3 font-medium">Note</th></tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {ready.map(({ i, twin }) => (
                      <tr key={i.id}>
                        <td className="py-2 pe-2"><input type="checkbox" name="itemId" value={i.id} aria-label={`Put ${i.title} on sale`} className="h-5 w-5" /></td>
                        <td className="py-2 pe-3">
                          <div className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {i.photoUrl ? <img src={i.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : null}
                            <Link href={`/inventory/${i.id}`} className={linkCls} dir="auto">{i.title}</Link>
                            <span className="text-xs text-muted" dir="ltr">{i.sku}</span>
                          </div>
                        </td>
                        <td className="py-2 pe-3 text-muted" dir="auto">{i.category ?? '—'}</td>
                        <td className="num whitespace-nowrap py-2 pe-3">{i.priceMinor != null ? formatAgorot(i.priceMinor) : '—'}</td>
                        <td className="py-2 pe-3 text-xs text-warn">{twin ? <>Same name already on the site (<Link href={`/website/products/${twin.id}`} className={linkCls}>#{twin.id}</Link>)</> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ActionForm>
          )}
        </CardBody>
      </Card>
    </>
  )
}

function ProductTable({ rows }: { rows: { p: { id: number; name_he: string; image_url: string | null; price: number | null }; sku: string | null }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-2 pe-2 font-medium"><span className="sr-only">Hide</span></th><th className="py-2 pe-3 font-medium">Product</th><th className="py-2 pe-3 font-medium">Price</th><th className="py-2 pe-3 font-medium">Inventory</th></tr></thead>
        <tbody className="divide-y divide-line/60">
          {rows.map(({ p, sku }) => (
            <tr key={p.id}>
              <td className="py-2 pe-2"><input type="checkbox" name="productId" value={p.id} aria-label={`Hide ${p.name_he}`} className="h-5 w-5" /></td>
              <td className="py-2 pe-3">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : null}
                  <Link href={`/website/products/${p.id}`} className={linkCls} dir="auto">{p.name_he}</Link>
                </div>
              </td>
              <td className="num whitespace-nowrap py-2 pe-3">{p.price != null ? formatAgorot(shekelsToAgorot(p.price)) : '—'}</td>
              <td className="py-2 pe-3 text-muted" dir="ltr">{sku ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
