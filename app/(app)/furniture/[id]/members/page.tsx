import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { requirePageAccess } from '@/lib/auth/session'
import { getFieldMembers, getFieldOptions } from '@/lib/integrations/furniture/field'
import { AddMemberForm, MemberRow } from '../../manage-forms'

export const dynamic = 'force-dynamic'

/**
 * Who can open this project in the field app (user_projects): every write
 * policy there requires membership. New accounts are made in the field app's
 * own user management: its invite function only accepts a signed-in admin.
 */
export default async function FurnitureMembersPage({ params }: { params: { id: string } }) {
  await requirePageAccess('furniture:write')
  await requirePageAccess('furniture:read_pii')
  const [r, opts] = await Promise.all([getFieldMembers(params.id), getFieldOptions()])
  const roles = opts.state === 'ok' ? opts.data.projectRoles : []
  return (
    <>
      <PageHeader title="Project team" description="People who can open and work on this project in the field app." />
      <p className="mb-4 text-sm"><Link href={`/furniture/${params.id}`} className="underline-offset-2 hover:underline">← Back to the project</Link></p>
      {r.state !== 'ok' ? <SourceProblem result={r} what="Project team" /> : (
        <Card>
          <CardHeader title={`${r.data.members.length} on this project`} meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />} />
          <CardBody className="flex flex-col gap-4">
            <div className="divide-y divide-line/70">
              {r.data.members.length ? r.data.members.map((m) => <MemberRow key={m.userId} projectId={params.id} member={m} roles={roles} />) : <p className="text-sm text-muted">Nobody yet.</p>}
            </div>
            <AddMemberForm projectId={params.id} candidates={r.data.candidates} roles={roles} />
          </CardBody>
        </Card>
      )}
    </>
  )
}
