import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getFieldItem, getFieldOptions } from '@/lib/integrations/furniture/field'
import { DeleteItemForm, ItemEditForm, PhotoForm } from '../../../manage-forms'

export const dynamic = 'force-dynamic'

/** Only an https photo URL is rendered; anything else in the column is not ours to load. */
const https = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u : null)

/** One item, every field the field app's edit sheet has, read and written through the field app's endpoint. */
export default async function FurnitureItemPage({ params }: { params: { id: string; itemId: string } }) {
  await requirePageAccess('furniture:read')
  const s = (await getSession())!
  const operate = can(s.user.role, 'furniture:operate', s.overrides)
  const write = can(s.user.role, 'furniture:write', s.overrides)
  const back = `/furniture/${params.id}`
  const [r, opts] = await Promise.all([getFieldItem(params.itemId), getFieldOptions()])
  if (r.state !== 'ok') {
    return (
      <>
        <PageHeader title="Furniture item" />
        <p className="mb-4 text-sm"><Link href={back} className="underline-offset-2 hover:underline">← Back to the project</Link></p>
        <SourceProblem result={r} what="Furniture item" />
      </>
    )
  }
  const item = r.data
  const photos = [...new Set([...(item.photo_urls ?? []), ...(item.image_url ? [item.image_url] : [])])].map(https).filter(Boolean) as string[]
  return (
    <>
      <PageHeader title={item.description} description={[item.collected ? `נאסף${item.collected_by ? ` (${item.collected_by})` : ''}` : null, item.source ? `source: ${item.source}` : null].filter(Boolean).join(' · ')} />
      <p className="mb-4 text-sm"><Link href={back} className="underline-offset-2 hover:underline">← Back to the project</Link></p>
      <Card className="mb-4">
        <CardHeader title="Photos" meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />} />
        <CardBody className="flex flex-col gap-3">
          {photos.length ? (
            <div className="flex flex-wrap gap-2">
              {photos.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage URL of another project */}
                  <img src={u} alt={item.description} loading="lazy" className="h-32 w-32 rounded-md border border-line object-cover" />
                </a>
              ))}
            </div>
          ) : <p className="text-sm text-muted">No photo.</p>}
          {operate && item.apartment_id ? <PhotoForm projectId={params.id} apartmentId={item.apartment_id} itemId={item.id} updatedAt={item.updated_at} /> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Details" meta={operate ? 'Saved by the field app with its own edit rules; a change made in the field since this page loaded is refused, not overwritten.' : 'Your role can view items but not change them'} />
        <CardBody>
          {opts.state !== 'ok' ? <SourceProblem result={opts} what="Field app options" /> : operate ? (
            <ItemEditForm projectId={params.id} item={item} options={opts.data} />
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(item).filter(([k, v]) => v != null && v !== '' && !['id', 'project_id', 'apartment_id', 'updated_at', 'photo_urls', 'image_url'].includes(k)).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd dir="auto">{String(v)}</dd></div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>
      {write ? (
        <Card className="mt-4">
          <CardHeader title="Delete" />
          <CardBody><DeleteItemForm id={item.id} projectId={params.id} label={item.description} backHref={back} /></CardBody>
        </Card>
      ) : null}
    </>
  )
}
