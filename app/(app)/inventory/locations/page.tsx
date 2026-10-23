import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationLabels, locationOptions } from '@/lib/ops/views'
import { LOCATION_KINDS } from '@/lib/ops/types'
import { ON_HAND } from '@/lib/inventory/model'
import { input } from '../../website/forms'
import { ActionForm, Field, LocationSelect } from '../forms'
import { saveLocationAction } from '../actions'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = { warehouse: 'Warehouse', zone: 'Zone / room', shelf: 'Shelf / bay', shop: 'Shop floor', external: 'External (partner, storage unit)' }

export default async function LocationsPage() {
  await requirePageAccess('inventory:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'inventory:write', s.overrides)
  const res = await loadOps(async () => {
    const store = getOpsStore()
    const [locations, items] = await Promise.all([store.listLocations(), store.listItems({ statuses: ON_HAND, limit: 5000 })])
    const count = new Map<string, number>()
    for (const i of items) if (i.locationId) count.set(i.locationId, (count.get(i.locationId) ?? 0) + 1)
    return { locations, count }
  })
  return (
    <>
      <PageHeader title="Storage locations" description="Where items physically are: a warehouse, its zones and shelves, the shop floor, or somewhere outside. Nothing here comes from another system: name your real locations once, and intake and moves will use them." actions={<Link href="/inventory" className={btn}>Inventory</Link>} />
      {!res.ok ? <OpsUnavailable message={res.message} /> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader title={`Locations (${res.data.locations.length})`} />
            <CardBody>
              {!res.data.locations.length ? <p className="text-sm text-muted">No locations yet.</p> : (
                <ul className="divide-y divide-line/60 text-sm">
                  {[...locationLabels(res.data.locations)].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => {
                    const l = res.data.locations.find((x) => x.id === id)!
                    return (
                      <li key={id} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                        <span dir="auto" className={`min-w-0 flex-1 ${l.active ? '' : 'text-muted line-through'}`}>{label}</span>
                        <span className="text-xs text-muted">{KIND[l.kind]}</span>
                        <Link href={`/inventory?location=${id}`} className={`num text-xs ${linkCls}`}>{res.data.count.get(id) ?? 0} items</Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
          {write ? (
            <Card>
              <CardHeader title="Add a location" />
              <CardBody>
                <ActionForm action={saveLocationAction} hidden={{}} label="Add" busy="Saving…" tone="primary">
                  <Field label="Name"><input name="name" required dir="auto" maxLength={120} className={input} /></Field>
                  <Field label="Kind"><select name="kind" className={input}>{LOCATION_KINDS.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>
                  <Field label="Inside"><LocationSelect name="parentId" locations={locationOptions(res.data.locations)} /></Field>
                  <Field label="Address"><input name="address" dir="auto" maxLength={300} className={input} /></Field>
                  <Field label="Notes"><input name="notes" dir="auto" maxLength={500} className={input} /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </>
  )
}
