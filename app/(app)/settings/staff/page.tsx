import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requirePageAccess } from '@/lib/auth/session'
import { authMode } from '@/lib/auth/mode'
import { ROLES, ROLE_LABELS } from '@/lib/auth/rbac'
import { listStaff } from '@/lib/staff/store'
import { listLocationAdmins } from '@/lib/schedule/store'
import { ActiveForm, DeleteForm, InviteForm, LocationAdminForm, ResendForm, RoleForm } from './forms'

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
  let schedulers: Awaited<ReturnType<typeof listLocationAdmins>> | null = null
  let schedError: string | null = null
  try {
    schedulers = await listLocationAdmins()
  } catch (e) {
    schedError = e instanceof Error ? e.message : String(e)
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
        <Card>
          <CardHeader title="Volunteer schedule" meta="Who sees each location's volunteer schedule (/schedule). A scheduler changes it (Dafna); a location manager only sees it (Sharon, Gil, Liat). Give them the Volunteer schedule role, then add them here. The database enforces it: nobody else can change a schedule." />
          <CardBody>
            {schedError ? <p role="alert" className="text-sm text-bad">Could not read schedulers: {schedError}. Has migration 0011 been run?</p> : !schedulers?.length ? <p className="text-sm text-muted">No locations yet (migration 0011 creates Sharon&apos;s Workshop).</p> : (
              <ul className="divide-y divide-line/70">
                {schedulers.map(({ location, admins }) => {
                  const people = (staff ?? []).filter((s) => s.active && !admins.some((x) => x.profileId === s.id)).map((s) => ({ id: s.id, label: s.name ? `${s.name} (${s.email})` : s.email }))
                  return (
                    <li key={location.id} className="flex flex-col gap-2 py-3">
                      <div dir="auto" className="text-sm font-medium">{location.name}</div>
                      {admins.length ? (
                        <ul className="flex flex-col gap-2">
                          {admins.map((x) => (
                            <li key={x.profileId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span><span dir="auto">{x.name}</span> <span dir="ltr" className="text-xs text-muted">{x.email}</span> <span className="text-xs text-muted">· {x.access === 'view' ? 'location manager (sees only)' : 'schedules'}</span></span>
                              <span className="flex flex-wrap gap-2">
                                <LocationAdminForm location={location.id} profile={x.profileId} on access={x.access === 'view' ? 'schedule' : 'view'} label={x.access === 'view' ? 'Let them schedule' : 'Make view-only'} />
                                <LocationAdminForm location={location.id} profile={x.profileId} on={false} label="Remove" />
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-xs text-warn">Nobody has access to this location&apos;s schedule yet.</p>}
                      {people.length ? <LocationAdminForm location={location.id} on label="Add" people={people} /> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
