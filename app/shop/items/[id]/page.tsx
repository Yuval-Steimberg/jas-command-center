import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ItemStatusChip } from '@/components/ops/ui'
import { ItemForm } from '@/components/inventory/item-form'
import { valuesOf } from '@/components/inventory/item-values'
import { ActionForm, Field, LocationSelect } from '@/app/(app)/inventory/forms'
import { moveItemAction, refurbAction } from '@/app/(app)/inventory/actions'
import { input } from '@/app/(app)/website/forms'
import { getSession } from '@/lib/auth/session'
import { can, type Permission } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel, locationLabels, locationOptions } from '@/lib/ops/views'
import { REFURB_LEVELS, REFURB_STATUSES } from '@/lib/ops/types'
import { CONDITION_LABEL_HE, OPS, REFURB_LEVEL_LABEL_HE, REFURB_STATUS_LABEL_HE, can as allowed } from '@/lib/inventory/model'
import { getSalesStore } from '@/lib/sales/store'
import { keptQty } from '@/lib/sales/model'
import { formatAgorot } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function ShopItemPage({ params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) notFound()
  const s = (await getSession())!
  const may = (p: Permission) => can(s.user.role, p, s.overrides)
  const res = await loadOps(async () => {
    const store = getOpsStore()
    const item = await store.getItem(params.id)
    if (!item) return null
    const [locations, contacts, lines] = await Promise.all([
      store.listLocations(),
      may('crm:read') ? store.listContacts({ role: 'refurbisher', limit: 200 }) : Promise.resolve([]),
      getSalesStore().linesForItems([item.id]).catch(() => []),
    ])
    return { item, locations, contacts, lines }
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return <p dir="ltr" className="text-sm text-bad">{res.message}</p>
  const { item, locations, contacts, lines } = res.data!
  const labels = locationLabels(locations)
  const hidden = { id: item.id, version: item.version }
  const kept = lines.find((l) => keptQty(l) > 0)
  const row = (k: string, v: React.ReactNode) => <><dt className="text-muted">{k}</dt><dd dir="auto">{v ?? '—'}</dd></>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 sm:flex-row">
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photoUrl} alt={item.title} className="aspect-square w-full rounded-md object-cover sm:w-64" />
        ) : <div className="grid aspect-square w-full place-items-center rounded-md border border-dashed border-line text-sm text-muted sm:w-64">אין תמונה</div>}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-xl font-bold text-ink" dir="auto">{item.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><span dir="ltr" className="font-mono">{item.sku}</span><ItemStatusChip status={item.status} lang="he" />{item.quantity > 1 ? <span>{item.quantity} יח׳</span> : null}</p>
          <p className="num text-2xl font-semibold text-ink">{item.priceMinor != null ? formatAgorot(item.priceMinor) : 'ללא מחיר'}{item.priceApproved === false ? <span className="ms-2 text-sm font-normal text-warn">הערכת AI, לא אושר</span> : null}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {row('מיקום', item.locationId ? labels.get(item.locationId) : null)}
            {row('מצב', item.condition ? CONDITION_LABEL_HE[item.condition] : null)}
            {row('קטגוריה', item.category)}
            {row('צבעים', item.colors)}
            {row('חומר', item.material)}
            {row('מידות', item.dimensions)}
            {item.refurbStatus ? row('שיפוץ', `${REFURB_STATUS_LABEL_HE[item.refurbStatus]}${item.refurbLevel ? ` · ${REFURB_LEVEL_LABEL_HE[item.refurbLevel].split(' (')[0]}` : ''}`) : null}
          </dl>
          {item.description ? <p dir="auto" className="whitespace-pre-wrap text-sm text-muted">{item.description}</p> : null}
        </div>
      </div>
      {item.extraPhotos?.length ? (
        <div className="flex flex-wrap gap-2">
          {item.extraPhotos.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="h-24 w-24 rounded-md border border-line object-cover" />
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {allowed('sell_in_store', item.status) && item.quantity > 0 && may('inventory:financial') ? <Link href={`/shop/sell?item=${item.id}`} className="inline-flex h-12 items-center rounded-full bg-brand px-6 text-base font-semibold text-forest">מכירה</Link> : null}
        {kept ? <Link href={`/shop/sales/${kept.saleId}`} className="inline-flex h-12 items-center rounded-full border border-line px-6 text-base font-medium hover:bg-sunken">פתיחת המכירה</Link> : null}
      </div>

      {allowed('move', item.status) && may('inventory:operate') ? (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer py-1 text-sm font-semibold">העברה למיקום אחר</summary>
          <ActionForm action={moveItemAction} hidden={hidden} label="העברה" busy="מעביר…" className="mt-2 flex flex-col gap-2">
            <LocationSelect locations={locationOptions(locations)} defaultValue={item.locationId} />
            <Field label="הערה"><input name="note" dir="auto" maxLength={500} className={input} /></Field>
          </ActionForm>
        </details>
      ) : null}

      {OPS.refurb.includes(item.status as 'in_storage') && may('inventory:operate') ? (
        <details className="rounded-lg border border-line bg-surface p-3" open={item.refurbStatus === 'needed' || item.refurbStatus === 'in_progress'}>
          <summary className="cursor-pointer py-1 text-sm font-semibold">שיפוץ</summary>
          <ActionForm action={refurbAction} hidden={hidden} label="שמירה" busy="שומר…" className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="סטטוס"><select name="refurbStatus" defaultValue={item.refurbStatus ?? ''} className={input}><option value="">לא צריך</option>{REFURB_STATUSES.map((k) => <option key={k} value={k}>{REFURB_STATUS_LABEL_HE[k]}</option>)}</select></Field>
            <Field label="רמה"><select name="refurbLevel" defaultValue={item.refurbLevel ?? ''} className={input}><option value="">—</option>{REFURB_LEVELS.map((k) => <option key={k} value={k}>{REFURB_LEVEL_LABEL_HE[k]}</option>)}</select></Field>
            {may('crm:read') ? <Field label="משפץ/ת"><select name="refurbContactId" defaultValue={item.refurbContactId ?? ''} className={input}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{contactLabel(c, may('crm:read_pii'))}</option>)}</select></Field> : null}
            <div className="sm:col-span-2"><Field label="הוראות"><textarea name="refurbInstructions" dir="auto" rows={3} maxLength={2000} defaultValue={item.refurbInstructions ?? ''} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" /></Field></div>
          </ActionForm>
        </details>
      ) : null}

      {allowed('edit', item.status) && may('inventory:write') ? (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer py-1 text-sm font-semibold">עריכת פרטים</summary>
          <div className="mt-2">
            <ItemForm
              lang="he" base="/shop" mode="edit" initial={valuesOf(item)} hidden={hidden}
              conditions={Object.entries(CONDITION_LABEL_HE).map(([value, label]) => ({ value, label }))}
              canCost={may('inventory:financial') && item.source !== 'purchase'} quantityEditable={item.websiteProductId == null}
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}
