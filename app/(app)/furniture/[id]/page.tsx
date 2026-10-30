import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { DESTINATIONS, getFurnitureProject, type FurnitureItem } from '@/lib/integrations/furniture/manage'
import { getFieldOptions, getFurnitureKpis } from '@/lib/integrations/furniture/field'
import { ArchiveForm, CollectForm, DestinationForm, FinishApartmentForm, HandoverForm, ReopenApartmentForm } from '../forms'
import { KpiCard } from '../kpis'
import { AddApartmentForm, AddBuildingForm, AddItemsForm, BuildingControls, BulkItemsBar, EditApartmentForm, PhotoForm } from '../manage-forms'
import { ProjectVolunteers } from '../../volunteers/project-card'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, string> = { NOT_STARTED: 'לא התחיל', DOCUMENTING: 'בתיעוד', COMPLETED: 'הושלם' }
/** Only an https photo URL is rendered; anything else in the column is not ours to load. */
const photo = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u : null)
const destLabel = (g: string | null) => DESTINATIONS.find((d) => d.id === g)?.label ?? 'ללא ייעוד'

export default async function FurnitureProjectPage({ params }: { params: { id: string } }) {
  await requirePageAccess('furniture:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'furniture:write', s.overrides)
  const operate = can(s.user.role, 'furniture:operate', s.overrides)
  const [r, kpis, opts] = await Promise.all([getFurnitureProject(params.id), getFurnitureKpis(params.id), getFieldOptions()])
  if (!r) notFound()
  const appUrl = env().furniture.appUrl
  if (r.state !== 'ok') {
    return (
      <>
        <PageHeader title="Furniture project" />
        <SourceProblem result={r} what="Furniture project" />
      </>
    )
  }
  const { project, apartments, items, itemsCapped, buildings: registry } = r.data
  const fieldOptions = opts.state === 'ok' ? opts.data : null
  const dests = fieldOptions?.destinations ?? []
  // A building is its registry row and the building_number its flats carry; either alone still counts.
  const buildings = [...new Set([...registry, ...apartments.map((a) => a.building_number ?? '')])].filter(Boolean)
  const multiBuilding = buildings.length > 1
  const byApartment = new Map<string, FurnitureItem[]>()
  for (const i of items) byApartment.set(i.apartment_id, [...(byApartment.get(i.apartment_id) ?? []), i])
  const live = items.filter((i) => i.status !== 'discarded')
  const options = DESTINATIONS.map((d) => ({ id: d.id, label: d.label }))
  // The address the project records, searched on OpenStreetMap. Not geocoded or stored, and
  // never put on the public neighbourhood map: a demolition site is not a partner place.
  const where = [[project.street, project.building_numbers].filter(Boolean).join(' '), project.city].filter(Boolean).join(', ')
  return (
    <>
      <PageHeader
        title={project.name}
        description={[project.city, project.developer_name, project.start_date && `from ${project.start_date}`, project.archived && 'archived'].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {write ? <Link href={`/furniture/${project.id}/edit`} className="flex h-10 items-center rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Project card</Link> : null}
            {write ? <Link href={`/furniture/${project.id}/members`} className="flex h-10 items-center rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Team</Link> : null}
            {operate ? <ArchiveForm id={project.id} name={project.name} archived={Boolean(project.archived)} /> : null}
          </div>
        }
      />
      <p className="mb-4 flex flex-wrap gap-x-3 text-sm">
        <Link href="/furniture" className="underline-offset-2 hover:underline">← All projects</Link>
        {where ? <a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(where)}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline" dir="auto">Map: {where}</a> : null}
        {appUrl ? (
          <>
            <a href={`${appUrl}/projects/${project.id}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Open in field app</a>
            <a href={`${appUrl}/reports/impact?project=${project.id}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Impact report</a>
            <a href={`${appUrl}/reports/esg?projects=${project.id}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">ESG report</a>
            <a href={`${appUrl}/projects/${project.id}/preparation`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Collection prep</a>
          </>
        ) : <span className="text-muted">Set FURNITURE_APP_URL to link to the field app and its reports.</span>}
      </p>
      <Card className="mb-4">
        <CardHeader title="Destinations" meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />} />
        <CardBody className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {DESTINATIONS.map((d) => <span key={d.id} dir="rtl"><span className="num font-semibold">{live.filter((i) => i.gallery_type === d.id).length}</span> {d.label}</span>)}
          <span className="text-muted">{live.length} items recorded · {apartments.length} apartments. Weight, diversion and CO₂ are below, computed by the field app.</span>
          {itemsCapped ? <span className="text-bad">Only the first 2000 items are listed here.</span> : null}
        </CardBody>
      </Card>
      <KpiCard result={kpis} />
      {can(s.user.role, 'volunteers:read', s.overrides) ? <ProjectVolunteers projectId={project.id} canCreate={can(s.user.role, 'volunteers:write', s.overrides)} /> : null}
      <Card>
        <CardHeader title="Buildings, apartments and items" meta={write || operate ? 'Every change here is made by the field app itself, with its rules (collector name, completion, handover, empty-only deletes)' : 'Your role can view items but not change them'} />
        <CardBody className="flex flex-col gap-4">
          {(write || operate) && !fieldOptions ? (
            <p className="text-sm text-bad">Editing is unavailable: {opts.state === 'not_configured' ? `set ${opts.missing.join(', ')}` : opts.state === 'error' ? opts.error : ''}. The field app’s endpoint gives the forms their options.</p>
          ) : null}
          {write && fieldOptions ? (
            <details className="rounded-md border border-line/70 p-3">
              <summary className="cursor-pointer text-sm font-medium">Add a building or an apartment</summary>
              <div className="mt-3 flex flex-col gap-4">
                <AddBuildingForm projectId={project.id} />
                <AddApartmentForm projectId={project.id} buildings={buildings} />
              </div>
            </details>
          ) : null}
          {!buildings.length ? <p className="text-sm text-muted">No buildings or apartments yet.</p> : buildings.map((b) => {
            const flats = apartments.filter((a) => a.building_number === b)
            return (
              <section key={b} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1">
                  <h3 dir="rtl" className="text-sm font-semibold">בניין {b} <span className="text-xs font-normal text-muted">· {flats.length} דירות</span></h3>
                  {write && fieldOptions ? <BuildingControls projectId={project.id} building={b} /> : null}
                </div>
                {!flats.length ? <p className="py-2 text-sm text-muted">No apartments in this building yet.</p> : (
                  <ul className="divide-y divide-line/70">
                    {flats.map((a) => {
                      const its = byApartment.get(a.id) ?? []
                      const aptLabel = `${multiBuilding ? `בניין ${a.building_number} · ` : ''}${a.entrance ? `כניסה ${a.entrance} · ` : ''}דירה ${a.apartment_number}`
                      const bulkId = `bulk-${a.id}`
                      const notes = typeof (a as Record<string, unknown>).notes === 'string' ? String((a as Record<string, unknown>).notes) : ''
                      return (
                        <li key={a.id} className="py-2">
                          <details>
                            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                              <span dir="rtl" className="font-medium">{aptLabel}</span>
                              <span dir="rtl" className="rounded-full border border-line px-2 py-0.5 text-xs">{STATUS[a.status] ?? a.status}</span>
                              <span className="text-xs text-muted">{its.filter((i) => i.status !== 'discarded').length} items · {its.filter((i) => i.intended_for_collection && i.collected).length}/{its.filter((i) => i.intended_for_collection && i.status !== 'discarded').length} collected</span>
                            </summary>
                            {notes ? <p dir="auto" className="mt-1 text-xs text-muted">הערות: {notes}</p> : null}
                            {operate || write ? (
                              <div className="mt-2 flex flex-wrap items-start gap-2">
                                {operate ? (a.status === 'COMPLETED'
                                  ? <ReopenApartmentForm id={a.id} projectId={project.id} label={aptLabel} />
                                  : <FinishApartmentForm id={a.id} projectId={project.id} label={aptLabel} />) : null}
                                {write && fieldOptions ? <EditApartmentForm projectId={project.id} apartment={{ ...a, notes }} label={aptLabel} canDelete={!its.length} /> : null}
                              </div>
                            ) : null}
                            {!its.length ? <p className="py-2 text-sm text-muted">No items.</p> : (
                              <ul className="mt-2 divide-y divide-line/50">
                                {its.map((i) => (
                                  <li key={i.id} className="grid gap-2 py-2 sm:grid-cols-[auto_auto_1fr_auto] sm:items-center">
                                    {write && fieldOptions ? (
                                      <label className="flex h-11 w-11 items-center justify-center"><span className="sr-only">Select {i.description}</span>
                                        <input type="checkbox" name="itemIds" value={i.id} form={bulkId} className="h-5 w-5" />
                                      </label>
                                    ) : <span aria-hidden className="hidden sm:block" />}
                                    {photo(i.image_url) ? (
                                      <a href={photo(i.image_url)!} target="_blank" rel="noreferrer" className="block h-16 w-16 shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage URL of another project; next/image would need its host allowlisted */}
                                        <img src={photo(i.image_url)!} alt={i.description} loading="lazy" className="h-16 w-16 rounded-md border border-line object-cover" />
                                      </a>
                                    ) : <span aria-hidden className="hidden h-16 w-16 sm:block" />}
                                    <div className="min-w-0 text-sm">
                                      <Link href={`/furniture/${project.id}/items/${i.id}`} dir="auto" className={`underline-offset-2 hover:underline ${i.status === 'discarded' ? 'text-muted line-through' : ''}`}>{i.description}{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ''}</Link>
                                      <div dir="rtl" className="text-xs text-muted">
                                        {destLabel(i.gallery_type)}
                                        {i.intended_for_collection ? (i.collected ? ` · נאסף${i.collected_by ? ` (${i.collected_by})` : ''}` : ' · ממתין לאיסוף') : ''}
                                      </div>
                                    </div>
                                    {i.status !== 'discarded' && (write || operate) ? (
                                      <div className="flex flex-col gap-2 sm:items-end">
                                        {write ? <DestinationForm id={i.id} projectId={project.id} description={i.description} from={i.gallery_type} updatedAt={i.updated_at} options={options} /> : null}
                                        {operate && i.intended_for_collection ? <CollectForm id={i.id} projectId={project.id} label={i.description} collected={Boolean(i.collected)} updatedAt={i.updated_at} /> : null}
                                        {operate && i.gallery_type === 'third_party' && i.handover_confirmed_at !== undefined ? (
                                          <HandoverForm id={i.id} projectId={project.id} label={i.description} confirmed={Boolean(i.handover_confirmed_at)} recipient={i.handover_recipient ?? null} updatedAt={i.updated_at} />
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {write && fieldOptions && its.length ? <BulkItemsBar formId={bulkId} projectId={project.id} destinations={dests} canDelete={write} /> : null}
                            {operate && fieldOptions ? (
                              <div className="mt-3 grid gap-4 rounded-md bg-sunken/50 p-3 lg:grid-cols-2">
                                <AddItemsForm projectId={project.id} apartmentId={a.id} destinations={dests} />
                                <PhotoForm projectId={project.id} apartmentId={a.id} destinations={dests} />
                              </div>
                            ) : null}
                          </details>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </CardBody>
      </Card>
    </>
  )
}
