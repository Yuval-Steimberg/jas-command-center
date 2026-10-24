import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { DESTINATIONS, getFurnitureProject, type FurnitureItem } from '@/lib/integrations/furniture/manage'
import { getFurnitureKpis } from '@/lib/integrations/furniture/field'
import { ArchiveForm, CollectForm, DestinationForm, FinishApartmentForm, HandoverForm, ReopenApartmentForm } from '../forms'
import { KpiCard } from '../kpis'
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
  const [r, kpis] = await Promise.all([getFurnitureProject(params.id), getFurnitureKpis(params.id)])
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
  const { project, apartments, items, itemsCapped } = r.data
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
        actions={operate ? <ArchiveForm id={project.id} name={project.name} archived={Boolean(project.archived)} /> : null}
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
        <CardHeader title="Apartments and items" meta={write || operate ? 'Every change here is the same change the field app makes, with its rules (collector name, completion, handover)' : 'Your role can view items but not change them'} />
        <CardBody>
          {!apartments.length ? <p className="text-sm text-muted">No apartments yet.</p> : (
            <ul className="divide-y divide-line/70">
              {apartments.map((a) => {
                const its = byApartment.get(a.id) ?? []
                const aptLabel = `בניין ${a.building_number}${a.entrance ? ` · כניסה ${a.entrance}` : ''} · דירה ${a.apartment_number}`
                return (
                  <li key={a.id} className="py-2">
                    <details>
                      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span dir="rtl" className="font-medium">{aptLabel}</span>
                        <span dir="rtl" className="rounded-full border border-line px-2 py-0.5 text-xs">{STATUS[a.status] ?? a.status}</span>
                        <span className="text-xs text-muted">{its.filter((i) => i.status !== 'discarded').length} items · {its.filter((i) => i.intended_for_collection && i.collected).length}/{its.filter((i) => i.intended_for_collection && i.status !== 'discarded').length} collected</span>
                      </summary>
                      {operate ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {a.status === 'COMPLETED'
                            ? <ReopenApartmentForm id={a.id} projectId={project.id} label={aptLabel} />
                            : <FinishApartmentForm id={a.id} projectId={project.id} label={aptLabel} />}
                        </div>
                      ) : null}
                      {!its.length ? <p className="py-2 text-sm text-muted">No items.</p> : (
                        <ul className="mt-2 divide-y divide-line/50">
                          {its.map((i) => (
                            <li key={i.id} className="grid gap-2 py-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                              {photo(i.image_url) ? (
                                <a href={photo(i.image_url)!} target="_blank" rel="noreferrer" className="block h-16 w-16 shrink-0">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage URL of another project; next/image would need its host allowlisted */}
                                  <img src={photo(i.image_url)!} alt={i.description} loading="lazy" className="h-16 w-16 rounded-md border border-line object-cover" />
                                </a>
                              ) : <span aria-hidden className="hidden h-16 w-16 sm:block" />}
                              <div className="min-w-0 text-sm">
                                <div dir="auto" className={i.status === 'discarded' ? 'text-muted line-through' : ''}>{i.description}{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ''}</div>
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
                    </details>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  )
}
