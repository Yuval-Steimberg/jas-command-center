import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { locationOptions } from '@/lib/ops/views'
import { listIntakeCandidates } from '@/lib/integrations/furniture/intake'
import { CONDITION_LABEL, FIELD_CONDITION } from '@/lib/inventory/model'
import { formatDateTime } from '@/lib/format'
import { IntakeForm, SelectAll } from '../forms'
import { intakeAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function IntakePage({ searchParams }: { searchParams: { project?: string } }) {
  await requirePageAccess('inventory:operate')
  const r = await listIntakeCandidates()
  const ops = await loadOps(async () => {
    const store = getOpsStore()
    const ids = r.state === 'ok' ? r.data.map((x) => x.id) : []
    const [locations, taken] = await Promise.all([store.listLocations(), ids.length ? store.listItems({ furnitureItemIds: ids, limit: 5000 }) : Promise.resolve([])])
    return { locations, taken: new Map(taken.map((i) => [i.furnitureItemId!, i])) }
  })
  const allWaiting = r.state === 'ok' && ops.ok ? r.data.filter((x) => !ops.data.taken.has(x.id)) : []
  const projects = [...allWaiting.reduce((m, x) => m.set(x.project_id, { name: x.projectName, n: (m.get(x.project_id)?.n ?? 0) + 1 }), new Map<string, { name: string; n: number }>())]
  const project = projects.some(([id]) => id === searchParams.project) ? searchParams.project : undefined
  const waiting = project ? allWaiting.filter((x) => x.project_id === project) : allWaiting
  return (
    <>
      <PageHeader
        title="Intake from collections"
        description="Items a crew marked JAS and ticked collected in the field app. Confirming intake creates the inventory item with its photo, condition and the apartment it came from. Each field item can be taken in once. Nothing is written back to the field app."
        actions={<Link href="/inventory" className={btn}>Inventory</Link>}
      />
      <Card>
        <CardHeader title={`Waiting for intake${r.state === 'ok' && ops.ok ? ` (${allWaiting.length})` : ''}`} meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : undefined} />
        <CardBody>
          {r.state !== 'ok' ? (
            <SourceProblem result={r} what="Collected furniture" />
          ) : !ops.ok ? (
            <OpsUnavailable message={ops.message} />
          ) : !allWaiting.length ? (
            <p className="text-sm text-muted">{r.data.length ? `All ${r.data.length} collected JAS item(s) are already in inventory.` : 'No item is marked JAS and collected in the field app yet.'}</p>
          ) : (
            <IntakeForm action={intakeAction} locations={locationOptions(ops.data.locations)}>
              {!ops.data.locations.length ? <p className="text-sm text-warn">No storage locations exist yet. <Link href="/inventory/locations" className={linkCls}>Add your warehouse</Link> first, or take items in without one.</p> : null}
              {projects.length > 1 ? (
                <nav aria-label="Filter by project" className="flex flex-wrap gap-2 text-sm">
                  <Link href="/inventory/intake" className={`rounded-full border px-3 py-1.5 ${project ? 'border-line text-muted' : 'border-ink text-ink'}`}>All ({allWaiting.length})</Link>
                  {projects.map(([id, p]) => <Link key={id} href={`/inventory/intake?project=${id}`} dir="auto" className={`rounded-full border px-3 py-1.5 ${project === id ? 'border-ink text-ink' : 'border-line text-muted'}`}>{p.name} ({p.n})</Link>)}
                </nav>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <SelectAll name="fieldItemId" key={project ?? 'all'} />
                <span className="text-xs text-muted">Up to 100 per confirm. Tick only what is in storage today.</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-2 pe-2 font-medium"><span className="sr-only">Take in</span></th><th className="py-2 pe-3 font-medium">Item</th><th className="py-2 pe-3 font-medium">From</th><th className="py-2 pe-3 font-medium">Condition</th><th className="py-2 pe-3 font-medium">Collected</th></tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {waiting.map((x) => {
                      const cond = FIELD_CONDITION(x.condition)
                      return (
                        <tr key={x.id}>
                          <td className="py-2 pe-2"><input type="checkbox" name="fieldItemId" value={x.id} aria-label={`Take in ${x.description}`} className="h-5 w-5" /></td>
                          <td className="py-2 pe-3">
                            <div className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {x.image_url ? <img src={x.image_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : null}
                              <span dir="auto">{x.description}{(x.quantity ?? 1) > 1 ? <span className="text-muted"> ×{x.quantity}</span> : null}</span>
                            </div>
                          </td>
                          <td dir="auto" className="py-2 pe-3 text-muted"><Link href={`/furniture/${x.project_id}`} className={linkCls}>{x.projectName}</Link>{x.apartmentLabel ? `, ${x.apartmentLabel}` : ''}</td>
                          <td className="py-2 pe-3 text-muted">{cond ? CONDITION_LABEL[cond] : '—'}</td>
                          <td className="py-2 pe-3 text-xs text-muted">{x.collected_at ? formatDateTime(x.collected_at) : '—'}{x.collected_by ? <span dir="auto"> · {x.collected_by}</span> : null}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </IntakeForm>
          )}
        </CardBody>
      </Card>
    </>
  )
}
