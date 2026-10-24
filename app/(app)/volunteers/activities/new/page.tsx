import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requirePageAccess } from '@/lib/auth/session'
import { ActionForm } from '../../../inventory/forms'
import { createActivityAction } from '../../actions'
import { projectOptions } from '../../load'
import { ActivityFields, ShiftFields, VolNav } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function NewActivity({ searchParams }: { searchParams: { project?: string } }) {
  await requirePageAccess('volunteers:write')
  const { projects, note } = await projectOptions()
  const pre = projects.find((p) => p.id === searchParams.project)
  return (
    <>
      <PageHeader title="New activity" description="Write it the way volunteers will read it (Hebrew). Save as a draft to check it, or publish straight away: publishing emails volunteers who asked to hear about new activities in this area." />
      <VolNav active="/volunteers/activities" />
      <ActionForm action={createActivityAction} hidden={{}} label="Create activity" busy="Creating…" tone="primary" className="flex flex-col gap-4">
        <Card>
          <CardHeader title="The activity" />
          <CardBody><ActivityFields projects={projects} projectsNote={note} projectId={pre?.id} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="First shift" meta="add more on the activity page" />
          <CardBody><ShiftFields repeat /></CardBody>
        </Card>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="publish" className="h-4 w-4" /> Publish now (visible in the volunteer app)</label>
      </ActionForm>
    </>
  )
}
