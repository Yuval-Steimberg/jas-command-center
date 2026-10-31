import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requirePageAccess } from '@/lib/auth/session'
import { authMode } from '@/lib/auth/mode'
import { ROLES, ROLE_LABELS } from '@/lib/auth/rbac'
import { listStaff } from '@/lib/staff/store'
import { ActiveForm, DeleteForm, InviteForm, ResendForm, RoleForm } from './forms'

export const dynamic = 'force-dynamic'

export default async function StaffPage() {
  const me = await requirePageAccess('users:manage')
  const roles = ROLES.filter((r) => me.role === 'owner' || r !== 'owner').map((r) => ({ id: r, label: ROLE_LABELS[r] }))
  if (authMode().kind !== 'supabase') {
    return (
      <>
        <PageHeader title="Staff" />
        <p className="text-sm text-muted">Staff are managed through Supabase Auth, which this deployment is not using (local development login).</p>
      </>
    )
  }
  let staff: Awaited<ReturnType<typeof listStaff>> | null = null
  let error: string | null = null
  try {
    staff = await listStaff()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return (
    <>
      <PageHeader title="Staff" description="Who can sign in to the command center, and with which role. Every change is in the audit log. Deactivate blocks access and can be undone; Delete removes the login for good. You cannot change or delete yourself, and the last active owner cannot be removed." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Invite someone" meta="Supabase emails them a link to set their password. Expired or lost? Use Send new link below." />
          <CardBody><InviteForm roles={roles} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Staff" meta={staff ? `${staff.filter((s) => s.active).length} active` : undefined} />
          <CardBody>
            {error ? <p role="alert" className="text-sm text-bad">Could not read staff: {error}</p> : !staff?.length ? <p className="text-sm text-muted">No staff yet.</p> : (
              <ul className="divide-y divide-line/70">
                {staff.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 text-sm">
                      <div dir="auto" className={s.active ? 'font-medium' : 'font-medium text-muted line-through'}>{s.name || s.email}</div>
                      <div dir="ltr" className="text-xs text-muted">{s.email}</div>
                      <div className="text-xs text-muted">{s.role ? ROLE_LABELS[s.role] : 'No role'}{s.active ? '' : ' · deactivated'}{s.id === me.id ? ' · you' : ''}</div>
                    </div>
                    {s.id !== me.id && (me.role === 'owner' || s.role !== 'owner') ? (
                      <div className="flex flex-wrap items-start gap-2">
                        <RoleForm id={s.id} email={s.email} role={s.role} roles={roles} />
                        {s.active ? <ResendForm id={s.id} email={s.email} /> : null}
                        <ActiveForm id={s.id} email={s.email} active={s.active} />
                        <DeleteForm id={s.id} email={s.email} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
