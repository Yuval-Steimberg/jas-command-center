import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { requirePageAccess } from '@/lib/auth/session'
import { getFieldOptions, getFieldProjectIdentity } from '@/lib/integrations/furniture/field'
import { EditProjectForm } from '../../manage-forms'

export const dynamic = 'force-dynamic'

/** The field app's project ID card (פרטי הפרויקט), with its own fields and labels. */
export default async function FurnitureProjectCardPage({ params }: { params: { id: string } }) {
  await requirePageAccess('furniture:write')
  const [r, opts] = await Promise.all([getFieldProjectIdentity(params.id), getFieldOptions()])
  return (
    <>
      <PageHeader title={r.state === 'ok' ? r.data.name || 'Project card' : 'Project card'} description="The project's ID card in the field app. It feeds the impact and ESG reports." />
      <p className="mb-4 text-sm"><Link href={`/furniture/${params.id}`} className="underline-offset-2 hover:underline">← Back to the project</Link></p>
      {r.state !== 'ok' ? <SourceProblem result={r} what="Project card" /> : opts.state !== 'ok' ? <SourceProblem result={opts} what="Field app options" /> : (
        <Card>
          <CardHeader title="פרטי הפרויקט" meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />} />
          <CardBody><EditProjectForm projectId={params.id} fields={opts.data.identityFields} values={r.data} /></CardBody>
        </Card>
      )}
    </>
  )
}
