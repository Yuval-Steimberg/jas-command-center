import Link from 'next/link'
import { renewalLabel } from '@/lib/inventory/renewal'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Printer, ShoppingBag } from 'lucide-react'
import { Thumb } from '@/components/shop/bits'
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
  if (!res.ok) return <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p>
  const { item, locations, contacts, lines } = res.data!
  const labels = locationLabels(locations)
  const hidden = { id: item.id, version: item.version }
  const kept = lines.find((l) => keptQty(l) > 0)
  // Empty facts are left out rather than printed as a column of dashes; location always shows, because "where is it" is the question.
  const row = (k: string, v: React.ReactNode, always = false) => (v || always ? <><dt className="text-muted">{k}</dt><dd dir="auto" className="text-ink">{v || 'לא צוין'}</dd></> : null)
  const sellable = allowed('sell_in_store', item.status) && item.quantity > 0 && may('inventory:financial')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-3 sm:flex-row">
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photoUrl} alt={item.title} className="aspect-[4/3] w-full rounded-md object-cover sm:aspect-square sm:w-64" />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start gap-3">
            {item.photoUrl ? null : <Thumb size="lg" />}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-ink" dir="auto">{item.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><span dir="ltr" className="font-mono">{item.sku}</span><ItemStatusChip status={item.status} lang="he" />{item.quantity > 1 ? <span>{item.quantity} יח׳</span> : null}</p>
            </div>
          </div>
          <p className="num text-3xl font-bold text-ink">{item.priceMinor != null ? formatAgorot(item.priceMinor) : <span className="text-lg font-medium text-muted">ללא מחיר</span>}{item.priceApproved === false ? <span className="ms-2 text-sm font-normal text-warn">הערכת AI, לא אושר</span> : null}</p>
          {sellable || kept ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {sellable ? <Link href={`/shop/sell?item=${item.id}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-8 text-base font-bold text-forest transition-colors duration-150 hover:bg-brand-pressed hover:text-cream"><ShoppingBag aria-hidden className="h-5 w-5" />מכירת הפריט</Link> : null}
              {kept ? <Link href={`/shop/sales/${kept.saleId}`} className="inline-flex h-12 items-center justify-center rounded-full border border-line px-6 text-base font-medium hover:bg-sunken">פתיחת המכירה</Link> : null}
            </div>
          ) : null}
          <Link href={`/shop/labels?ids=${item.id}`} className="inline-flex h-11 items-center gap-2 self-start rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken"><Printer aria-hidden className="h-4 w-4" />הדפסת תווית</Link>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line/70 pt-3 text-sm">
            {row('מיקום', item.locationId ? labels.get(item.locationId) : null, true)}
            {row('רמת חידוש', renewalLabel(item.renewalLevel, 'he'))}
            {item.renewalLevel == null ? row('מצב', item.condition ? CONDITION_LABEL_HE[item.condition] : null) : null}
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

      {allowed('move', item.status) && may('inventory:operate') ? (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">העברה למיקום אחר</summary>
          <ActionForm action={moveItemAction} hidden={hidden} label="העברה" busy="מעביר…" className="mt-2 flex flex-col gap-2">
            <LocationSelect locations={locationOptions(locations)} defaultValue={item.locationId} emptyLabel="ללא מיקום" />
            <Field label="הערה"><input name="note" dir="auto" maxLength={500} className={input} /></Field>
          </ActionForm>
        </details>
      ) : null}

      {OPS.refurb.includes(item.status as 'in_storage') && may('inventory:operate') ? (
        <details className="rounded-lg border border-line bg-surface p-3" open={item.refurbStatus === 'needed' || item.refurbStatus === 'in_progress'}>
          <summary className="cursor-pointer text-sm font-semibold text-ink">שיפוץ</summary>
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
          <summary className="cursor-pointer text-sm font-semibold text-ink">עריכת פרטים</summary>
          <div className="mt-2">
            <ItemForm
              lang="he" base="/shop" mode="edit" initial={valuesOf(item)} hidden={hidden}
              quantityEditable={item.websiteProductId == null}
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}
