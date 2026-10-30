import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { SourceProblem } from '@/components/ui/source-state'
import { requirePageAccess } from '@/lib/auth/session'
import { getFieldOptions } from '@/lib/integrations/furniture/field'
import { NewProjectForm } from '../manage-forms'

export const dynamic = 'force-dynamic'

/** A new field project, created by the field app with its whole skeleton of buildings and apartments. */
export default async function NewFurnitureProjectPage() {
  await requirePageAccess('furniture:write')
  const opts = await getFieldOptions()
  return (
    <>
      <PageHeader title="New furniture project" description="The field app creates it with every building and apartment, empty and waiting to be mapped. You are added as its project manager." />
      <p className="mb-4 text-sm"><Link href="/furniture" className="underline-offset-2 hover:underline">← All projects</Link></p>
      {opts.state !== 'ok' ? <SourceProblem result={opts} what="Field app options" /> : (
        <Card>
          <CardHeader title="פרויקט חדש" meta="The rest of the project card can be filled in after it is created." />
          <CardBody><NewProjectForm fields={opts.data.identityFields} maxBuildings={opts.data.limits.maxBuildings} maxPerEntrance={opts.data.limits.maxApartmentsPerEntrance} /></CardBody>
        </Card>
      )}
    </>
  )
}
