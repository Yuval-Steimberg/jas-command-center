import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { SourceProblem } from '@/components/ui/source-state'
import { ItemStatusChip, OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can, type Permission } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel, locationLabels, locationOptions } from '@/lib/ops/views'
import { CONDITION_LABEL, OPS, REFURB_LEVEL_LABEL, REFURB_STATUS_LABEL, can as allowed, daysHeld, describeChanges, draftProduct } from '@/lib/inventory/model'
import { REFURB_LEVELS, REFURB_STATUSES } from '@/lib/ops/types'
import { ItemForm } from '@/components/inventory/item-form'
import { valuesOf } from '@/components/inventory/item-values'
import { getSalesStore } from '@/lib/sales/store'
import { keptQty } from '@/lib/sales/model'
import { qrSvg, itemUrl } from '@/lib/inventory/qr'
import { getWebsiteProduct, getWebsiteProductMeta } from '@/lib/integrations/website/manage'
import { formatAgorot } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { input } from '../../website/forms'
import { ActionForm, ContactPicker, Field, LocationSelect } from '../forms'
import {
  deliveredAction, disposeAction, listItemAction, moveItemAction, publishAction, refurbAction, releaseAction, reserveAction, returnAction,
} from '../actions'

export const dynamic = 'force-dynamic'

const MOVE_LABEL: Record<string, string> = {
  intake: 'Taken in', move: 'Moved', edit: 'Edited', list: 'Listed on the website', publish: 'Published', unpublish: 'Hidden from the shop', reserve: 'Reserved', release: 'Reservation ended',
  sell: 'Sold', deliver: 'Delivered', return: 'Returned to stock', donate: 'Donated', recycle: 'Sent to recycling', dispose: 'Disposed', adjust: 'Quantity changed', conflict: 'Needs checking',
}

export default async function ItemPage({ params }: { params: { id: string } }) {
  await requirePageAccess('inventory:read')
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  // A label scanned with a phone's own camera app opens this URL; a seller gets the shop view of the item.
  if (s.user.role === 'seller') redirect(`/shop/items/${params.id}`)
  const may = (p: Permission) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')

  const res = await loadOps(async () => {
    const store = getOpsStore()
    const item = await store.getItem(params.id)
    if (!item) return null
    // Everything else hangs off the item and is read at once, the website product included.
    const [{ saleLines, sales }, movements, locations, contacts, tasks, web] = await Promise.all([
      // Shop sale lines need migration 0006; without it the item page still works.
      (async () => {
        const saleLines = await getSalesStore().linesForItems([item.id]).catch(() => [])
        const sales = saleLines.length ? await getSalesStore().listSales({ ids: [...new Set(saleLines.map((l) => l.saleId))] }).catch(() => []) : []
        return { saleLines, sales }
      })(),
      store.movements(item.id),
      store.listLocations(),
      may('crm:read') ? store.listContacts({ limit: 500 }) : Promise.resolve([]),
      store.listTasks({ entityKind: 'item', entityId: item.id, limit: 50 }),
      Promise.all([
        item.websiteProductId != null && may('website:read') ? getWebsiteProduct(item.websiteProductId) : null,
        item.status === 'in_storage' && item.websiteProductId == null && may('website:write') ? getWebsiteProductMeta() : null,
        qrSvg(itemUrl(item.id)),
      ]),
    ])
    return { item, movements, locations, contacts, tasks, saleLines, sales, web }
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return (<><PageHeader title="Item" /><OpsUnavailable message={res.message} /></>)
  const { item, movements, locations, contacts, tasks, saleLines, sales, web } = res.data!
  const saleNo = new Map(sales.map((x) => [x.id, x.number]))
  const keptLine = saleLines.find((l) => keptQty(l) > 0)
  const money = may('inventory:financial')
  const labels = locationLabels(locations)
  const locs = locationOptions(locations)
  const people = new Map(contacts.map((c) => [c.id, c]))
  const contactOpts = contacts.map((c) => ({ id: c.id, label: contactLabel(c, pii) }))
  const [product, meta, qr] = web
  const hidden = { id: item.id, version: item.version }
  const draft = draftProduct(item)
  const person = (id: string | null) => {
    if (!id) return null
    const c = people.get(id)
    return <Link href={`/crm/${id}`} className={linkCls}>{c ? contactLabel(c, pii) : 'Customer'}</Link>
  }

  return (
    <>
      <PageHeader
        title={`${item.sku} · ${item.title}`}
        description={<span className="flex flex-wrap items-center gap-2"><ItemStatusChip status={item.status} /><span>{item.quantity > 1 ? `${item.quantity} units · ` : ''}{daysHeld(item)} days with us</span></span>}
        actions={<div className="flex flex-wrap gap-2"><Link href="/inventory" className={btn}>All items</Link><Link href={`/inventory/labels?ids=${item.id}`} className={btn}>Print label</Link></div>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Item" />
            <CardBody className="grid gap-4 sm:grid-cols-[180px_1fr]">
              {item.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.photoUrl} alt={item.title} className="aspect-square w-full rounded-md border border-line object-cover" />
              ) : <div className="grid aspect-square w-full place-items-center rounded-md border border-dashed border-line text-xs text-muted">No photo</div>}
              {item.extraPhotos?.length ? (
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  {item.extraPhotos.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="h-20 w-20 rounded-md border border-line object-cover" />
                    </a>
                  ))}
                </div>
              ) : null}
              <dl className="grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted">Location</dt><dd>{item.locationId ? labels.get(item.locationId) : '—'}</dd>
                <dt className="text-muted">Condition</dt><dd>{item.condition ? CONDITION_LABEL[item.condition] : '—'}</dd>
                <dt className="text-muted">Asking price</dt><dd className="num">{item.priceMinor ? formatAgorot(item.priceMinor) : '—'}</dd>
                <dt className="text-muted">Dimensions</dt><dd dir="auto">{item.dimensions ?? '—'}</dd>
                <dt className="text-muted">Material</dt><dd dir="auto">{item.material ?? '—'}</dd>
                <dt className="text-muted">Colours</dt><dd dir="auto">{item.colors ?? '—'}</dd>
                {item.priceApproved === false ? <><dt className="text-muted">Price check</dt><dd className="text-warn">AI estimate{item.aiPriceMinor != null ? ` ${formatAgorot(item.aiPriceMinor)}` : ''}, not approved yet</dd></> : null}
                {money && item.unitCostMinor != null && item.source !== 'purchase' ? <><dt className="text-muted">Cost</dt><dd className="num">{formatAgorot(item.unitCostMinor)} each</dd></> : null}
                {item.refurbStatus ? <><dt className="text-muted">Refurbishment</dt><dd>{REFURB_STATUS_LABEL[item.refurbStatus]}{item.refurbLevel ? ` · ${REFURB_LEVEL_LABEL[item.refurbLevel].split(' (')[0]}` : ''}{item.refurbContactId ? <> · {person(item.refurbContactId)}</> : null}</dd></> : null}
                {saleLines.length ? <><dt className="text-muted">Shop sales</dt><dd className="flex flex-wrap gap-x-2">{saleLines.map((l) => <Link key={l.id} href={`/sales/${l.saleId}`} className={linkCls}>{saleNo.get(l.saleId) ?? 'sale'}{l.quantity > 1 ? ` (${l.quantity})` : ''}{l.status === 'open' ? ', open' : l.status === 'returned' ? ', returned' : ''}</Link>)}</dd></> : null}
                {item.weightKg != null ? <><dt className="text-muted">Weight</dt><dd className="num">≈{item.weightKg} kg</dd></> : null}
                <dt className="text-muted">Came from</dt>
                <dd dir="auto">{item.source === 'furniture' && item.furnitureProjectId ? <><Link href={`/furniture/${item.furnitureProjectId}`} className={linkCls}>{item.furnitureProjectName}</Link>{item.furnitureApartment ? `, ${item.furnitureApartment}` : ''}</> : item.source === 'purchase' && item.supplierId ? <>Bought from <Link href={`/suppliers/${item.supplierId}`} className={linkCls}>{people.get(item.supplierId) ? contactLabel(people.get(item.supplierId)!, pii) : 'a supplier'}</Link>{item.purchaseOrderId ? <> · <Link href={`/suppliers/orders/${item.purchaseOrderId}`} className={linkCls}>order</Link></> : null}{item.unitCostMinor != null && (may('inventory:write') || may('inventory:financial')) ? `, ${formatAgorot(item.unitCostMinor)} each` : ''}</> : movements.some((m) => m.type === 'intake' && m.refKind === 'website_product') ? <>From the website shop{item.websiteProductId != null ? <> · <Link href={`/website/products/${item.websiteProductId}`} className={linkCls}>product #{item.websiteProductId}</Link></> : null}</> : 'Added by hand'}</dd>
                {item.status === 'reserved' ? <><dt className="text-muted">Reserved for</dt><dd>{person(item.reservedFor)} until {item.reservedUntil?.slice(0, 10)}</dd></> : null}
                {item.soldAt ? <><dt className="text-muted">Sold</dt><dd>{item.soldChannel === 'website' ? <>website order <Link href={`/website/orders?q=${encodeURIComponent(item.websiteOrderNumber ?? '')}`} className={linkCls}>{item.websiteOrderNumber}</Link></> : 'in the shop'}, {formatDateTime(item.soldAt)}{item.soldPriceMinor ? `, ${formatAgorot(item.soldPriceMinor)}` : ''}{item.buyerContactId ? <> · {person(item.buyerContactId)}</> : null}</dd></> : null}
                {item.dispositionNote ? <><dt className="text-muted">{item.status === 'donated' ? 'Donated to' : item.status === 'recycled' ? 'Recycled at' : 'Note'}</dt><dd dir="auto">{item.dispositionNote}</dd></> : null}
                {item.description ? <><dt className="text-muted">Notes</dt><dd dir="auto" className="whitespace-pre-wrap">{item.description}</dd></> : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Website listing" meta="The website owns a listed item's price, visibility and stock." />
            <CardBody className="text-sm">
              {item.websiteProductId == null ? (
                <p className="text-muted">Not listed.{!draft.ok && item.status === 'in_storage' ? ` To list it: ${draft.reason}` : ''}</p>
              ) : !product ? (
                <p className="text-muted">Product #{item.websiteProductId}. Your role cannot read website products.</p>
              ) : product.state !== 'ok' ? (
                <SourceProblem result={product} what="Website product" />
              ) : !product.data ? (
                <p className="text-bad">Website product #{item.websiteProductId} no longer exists.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted">Product</dt><dd><Link href={`/website/products/${product.data.id}`} className={linkCls}>#{product.data.id} /product/{product.data.slug}</Link></dd>
                    <dt className="text-muted">Shown in shop</dt><dd>{product.data.published === false ? 'No (draft)' : 'Yes'}</dd>
                    <dt className="text-muted">Price</dt><dd className="num">{product.data.price != null ? formatAgorot(Math.round(product.data.price * 100)) : '—'}</dd>
                    <dt className="text-muted">Stock</dt><dd className="num">{product.data.in_stock === false ? 0 : (product.data.quantity ?? '—')}</dd>
                  </dl>
                  {may('inventory:write') && may('website:write') && product.data.published !== undefined && (item.status === 'listed' || item.status === 'reserved') ? (
                    <ActionForm action={publishAction} hidden={{ id: item.id, published: String(!product.data.published) }} label={product.data.published ? 'Hide from the shop' : 'Publish in the shop'} busy="Saving…" tone={product.data.published ? 'plain' : 'primary'} confirm={product.data.published ? 'Hide this item from the shop?' : 'Publish this item in the shop now?'} />
                  ) : null}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" meta="Every change, oldest at the bottom. Append-only." />
            <CardBody>
              <ol className="flex flex-col gap-3 text-sm">
                {movements.map((m) => (
                  <li key={m.id} className="grid grid-cols-[110px_1fr] gap-3">
                    <span className="text-xs text-muted">{formatDateTime(m.at)}</span>
                    <div className="min-w-0">
                      <p className={m.type === 'conflict' ? 'font-medium text-bad' : 'font-medium'}>{MOVE_LABEL[m.type] ?? m.type}{m.fromStatus && m.toStatus && m.fromStatus !== m.toStatus ? <span className="font-normal text-muted"> · {m.fromStatus.replace('_', ' ')} → {m.toStatus.replace('_', ' ')}</span> : null}{m.fromLocation !== m.toLocation && m.type === 'move' ? <span className="font-normal text-muted"> · {m.fromLocation ? labels.get(m.fromLocation) : 'nowhere'} → {m.toLocation ? labels.get(m.toLocation) : 'nowhere'}</span> : null}</p>
                      {m.type === 'edit' ? describeChanges(m.detail, { money }).map((c) => <p key={c} dir="auto" className="text-muted">{c}</p>) : null}
                      {m.note ? <p dir="auto" className="text-muted">{m.note}</p> : null}
                      <p className="text-meta text-faint">{m.actorEmail}{m.refKind === 'website_order' ? ` · website order #${m.refId}` : m.refKind === 'furniture_item' ? ' · from the field app' : ''}{typeof m.detail.saleNumber === 'string' ? ` · sale ${m.detail.saleNumber}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Next steps" />
            <CardBody className="flex flex-col gap-5">
              {allowed('list', item.status) && may('inventory:write') && may('website:write') ? (
                item.websiteProductId != null ? (
                  <ActionForm action={listItemAction} hidden={hidden} label="Put back on sale on the website" busy="Listing…" tone="primary" confirm={`Set the website stock of product #${item.websiteProductId} back to ${item.quantity}?`} />
                ) : draft.ok ? (
                  <ActionForm action={listItemAction} hidden={hidden} label="Create a website draft" busy="Creating…" tone="primary">
                    {meta?.state === 'ok' ? (
                      <Field label="Shop category">
                        <select name="categoryId" defaultValue="" className={input}><option value="">None</option>{meta.data.categories.map((c) => <option key={c.id} value={c.id}>{c.name_he}</option>)}</select>
                      </Field>
                    ) : null}
                    <p className="text-meta text-muted">Creates an unpublished product with this photo, price and condition. Publish it after checking.</p>
                  </ActionForm>
                ) : <p className="text-sm text-muted">To list it on the website: {draft.reason}</p>
              ) : null}

              {allowed('reserve', item.status) && may('inventory:operate') && may('crm:read') ? (
                <details><summary className="cursor-pointer text-sm font-medium">Reserve for a customer</summary>
                  <div className="mt-2"><ActionForm action={reserveAction} hidden={hidden} label="Reserve" busy="Reserving…" confirm={item.status === 'listed' ? 'Reserving takes it off sale on the website. Continue?' : undefined}>
                    <ContactPicker contacts={contactOpts} allowNew={may('crm:write')} />
                    <Field label="For how many days"><input name="days" type="number" min={1} max={30} defaultValue={3} className={input} /></Field>
                    <Field label="Note"><input name="note" dir="auto" maxLength={500} className={input} /></Field>
                  </ActionForm></div>
                </details>
              ) : null}
              {item.status === 'reserved' && may('inventory:operate') ? <ActionForm action={releaseAction} hidden={{ id: item.id }} label="End the reservation" busy="Releasing…" confirm="End this reservation and put the item back on sale?"><Field label="Why"><input name="note" dir="auto" maxLength={500} className={input} /></Field></ActionForm> : null}

              {allowed('sell_in_store', item.status) && money && item.quantity > 0 ? (
                <Link href={`/sales/new?item=${item.id}`} className={btn}>Sell in the shop</Link>
              ) : null}

              {keptLine ? <p className="text-sm">Sold in shop sale <Link href={`/sales/${keptLine.saleId}`} className={linkCls}>{saleNo.get(keptLine.saleId) ?? 'open sale'}</Link>: hand it over, change the delivery or take a return there.</p> : null}
              {item.status === 'sold' && !keptLine && may('inventory:operate') ? <ActionForm action={deliveredAction} hidden={{ id: item.id }} label="Mark delivered / picked up" busy="Saving…" tone="primary"><p className="text-meta text-muted">{item.soldChannel === 'website' ? 'For a website order, marking the order delivered on the website does this too (on the next sync).' : 'Plan the delivery on the Deliveries page, or mark it here once done.'}</p></ActionForm> : null}

              {allowed('return', item.status) && money && !keptLine ? (
                <details><summary className="cursor-pointer text-sm font-medium">Customer returned it</summary>
                  <div className="mt-2"><ActionForm action={returnAction} hidden={hidden} label="Return to stock" busy="Saving…" confirm="Put this item back in stock? The money is refunded in Grow or at the till, not here.">
                    <Field label="Why"><input name="reason" required dir="auto" maxLength={500} className={input} /></Field>
                    <Field label="Put it in"><LocationSelect locations={locs} defaultValue={item.locationId} /></Field>
                  </ActionForm></div>
                </details>
              ) : null}

              {allowed('donate', item.status) && may('inventory:write') ? (
                <details><summary className="cursor-pointer text-sm font-medium">Donate, recycle or dispose</summary>
                  <div className="mt-2"><ActionForm action={disposeAction} hidden={hidden} label="Record" busy="Saving…" confirm="This is final for the item. Continue?">
                    <Field label="What happened"><select name="kind" className={input}><option value="donate">Donated</option><option value="recycle">Sent to recycling</option><option value="dispose">Disposed</option></select></Field>
                    <Field label="To whom / where / why"><input name="note" required dir="auto" maxLength={500} className={input} /></Field>
                    {may('crm:read') ? <ContactPicker contacts={contactOpts} allowNew={may('crm:write')} label="Recipient organisation (optional)" /> : null}
                  </ActionForm></div>
                </details>
              ) : null}

              {allowed('move', item.status) && may('inventory:operate') ? (
                <details><summary className="cursor-pointer text-sm font-medium">Move to another location</summary>
                  <div className="mt-2"><ActionForm action={moveItemAction} hidden={hidden} label="Move" busy="Moving…">
                    <LocationSelect locations={locs} defaultValue={item.locationId} />
                    <Field label="Note"><input name="note" dir="auto" maxLength={500} className={input} /></Field>
                  </ActionForm></div>
                </details>
              ) : null}
              {!OPS.move.includes(item.status as 'in_storage') && item.status !== 'sold' ? <p className="text-sm text-muted">This item&apos;s story is complete.</p> : null}
            </CardBody>
          </Card>

          {OPS.refurb.includes(item.status as 'in_storage') && may('inventory:operate') ? (
            <Card>
              <CardHeader title="Refurbishment" meta="what it needs, who does it, how far it is" />
              <CardBody>
                <ActionForm action={refurbAction} hidden={hidden} label="Save" busy="Saving…" className="flex flex-col gap-2">
                  <Field label="Status"><select name="refurbStatus" defaultValue={item.refurbStatus ?? ''} className={input}><option value="">Not needed</option>{REFURB_STATUSES.map((k) => <option key={k} value={k}>{REFURB_STATUS_LABEL[k]}</option>)}</select></Field>
                  <Field label="Level"><select name="refurbLevel" defaultValue={item.refurbLevel ?? ''} className={input}><option value="">—</option>{REFURB_LEVELS.map((k) => <option key={k} value={k}>{REFURB_LEVEL_LABEL[k]}</option>)}</select></Field>
                  {may('crm:read') ? <Field label="Refurbisher"><select name="refurbContactId" defaultValue={item.refurbContactId ?? ''} className={input}><option value="">—</option>{contacts.filter((c) => c.roles.includes('refurbisher') || c.id === item.refurbContactId).map((c) => <option key={c.id} value={c.id}>{contactLabel(c, pii)}</option>)}</select></Field> : null}
                  <Field label="Instructions"><textarea name="refurbInstructions" dir="auto" rows={3} maxLength={2000} defaultValue={item.refurbInstructions ?? ''} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" /></Field>
                  <p className="text-meta text-muted">Refurbishers are customers with the Refurbisher role. Marking it done turns &quot;needs repair&quot; into &quot;good&quot;.</p>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {allowed('edit', item.status) && may('inventory:write') ? (
            <Card>
              <CardHeader title="Edit details" />
              <CardBody>
                <ItemForm
                  lang="en" base="/inventory" mode="edit" initial={valuesOf(item)} hidden={hidden}
                  conditions={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))}
                  canCost={money && item.source !== 'purchase'} quantityEditable={item.websiteProductId == null}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Tasks" action={<Link href={`/tasks?entity=item&id=${item.id}`} className="text-xs underline-offset-2 hover:underline">Add</Link>} />
            <CardBody>
              {tasks.length ? (
                <ul className="flex flex-col gap-1.5 text-sm">{tasks.map((t) => <li key={t.id} className={t.status === 'open' ? '' : 'text-muted line-through'}>{t.title}{t.dueAt && t.status === 'open' ? <span className="text-muted"> · due {t.dueAt.slice(0, 10)}</span> : null}</li>)}</ul>
              ) : <p className="text-sm text-muted">No tasks.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Label" />
            <CardBody className="flex items-center gap-4">
              <div className="h-28 w-28 shrink-0" aria-label={`QR code for ${item.sku}`} dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="text-sm"><p className="font-mono text-base font-semibold">{item.sku}</p><p className="text-muted">Scanning opens this page.</p></div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
