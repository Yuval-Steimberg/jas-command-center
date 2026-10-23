import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { CONDITION_LABEL } from '@/lib/inventory/model'
import { input } from '../../website/forms'
import { ActionForm, Field, LocationSelect } from '../forms'
import { createItemAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function NewItemPage() {
  await requirePageAccess('inventory:write')
  const res = await loadOps(() => getOpsStore().listLocations())
  return (
    <>
      <PageHeader title="Add an item" description="For an item that did not come from a collection project: a walk-in donation, a workshop piece, a return from elsewhere. Collected furniture goes through intake instead, so it keeps the apartment it came from." actions={<Link href="/inventory" className={btn}>Inventory</Link>} />
      <Card className="max-w-2xl">
        <CardHeader title="New item" />
        <CardBody>
          {!res.ok ? <OpsUnavailable message={res.message} /> : (
            <ActionForm action={createItemAction} hidden={{}} label="Add item" busy="Adding…" tone="primary" className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input name="title" required dir="auto" maxLength={200} className={input} /></Field>
              <Field label="Asking price (₪)"><input name="price" inputMode="decimal" dir="ltr" className={input} /></Field>
              <Field label="Quantity" hint="More than 1 = identical units sold from one record"><input name="quantity" type="number" min={1} max={10000} defaultValue={1} className={input} /></Field>
              <Field label="Condition"><select name="condition" defaultValue="good" className={input}>{Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Location"><LocationSelect locations={locationOptions(res.data)} /></Field>
              <Field label="Category"><input name="category" dir="auto" maxLength={100} className={input} /></Field>
              <Field label="Photo (https link)"><input name="photoUrl" dir="ltr" maxLength={2000} className={input} /></Field>
              <Field label="Dimensions"><input name="dimensions" dir="auto" maxLength={200} className={input} /></Field>
              <Field label="Material"><input name="material" dir="auto" maxLength={200} className={input} /></Field>
              <Field label="Where it came from"><input name="note" dir="auto" maxLength={500} className={input} /></Field>
              <div className="sm:col-span-2"><Field label="Notes"><textarea name="description" dir="auto" rows={3} maxLength={2000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" /></Field></div>
            </ActionForm>
          )}
        </CardBody>
      </Card>
    </>
  )
}
