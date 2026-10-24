import Link from 'next/link'
import { Card, CardBody, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { ACTIVITY_STATUSES, ACTIVITY_STATUS_EN, KIND_EN, type ActivityStatus } from '@/lib/volunteers/model'
import { buildShiftViews } from '@/lib/volunteers/views'
import { ActivityStatusChip, VolNav, shiftWhen } from '../ui'

export const dynamic = 'force-dynamic'

export default async function ActivitiesPage({ searchParams }: { searchParams: { status?: string; project?: string } }) {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const status = (ACTIVITY_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? (searchParams.status as ActivityStatus) : null
  const now = Date.now()
  const res = await loadOps(async () => {
    const store = getVolunteerStore()
    const activities = await store.listActivities({ statuses: status ? [status] : ['draft', 'published'], projectId: searchParams.project || undefined, limit: 2000 })
    const shifts = activities.length ? await store.listShifts({ activityIds: activities.map((a) => a.id) }) : []
    const signups = shifts.length ? await store.listSignups({ shiftIds: shifts.map((x) => x.id), statuses: ['confirmed', 'waitlisted', 'invited'] }) : []
    return { activities, views: buildShiftViews(activities, shifts, signups, now) }
  })
  return (
    <>
      <PageHeader title="Activities" description="Each activity has one or more shifts. Drafts are invisible to volunteers until published." actions={can(s.user.role, 'volunteers:write', s.overrides) ? <Link href="/volunteers/activities/new" className={btn}>New activity</Link> : undefined} />
      <VolNav active="/volunteers/activities" />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Link href="/volunteers/activities" className={!status ? 'font-medium text-ink' : `${linkCls} text-muted`}>Current</Link>
        {ACTIVITY_STATUSES.map((x) => <Link key={x} href={`/volunteers/activities?status=${x}`} className={status === x ? 'font-medium text-ink' : `${linkCls} text-muted`}>{ACTIVITY_STATUS_EN[x]}</Link>)}
      </div>
      {!res.ok ? <OpsUnavailable title="Volunteers are not available" message={res.message} /> : (
        <Card>
          <CardBody>
            {res.data.activities.length === 0 ? <p className="text-sm text-muted">No activities here yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Activity</th><th className="font-normal">Status</th><th className="font-normal">Next shift</th><th className="font-normal">Upcoming shifts</th><th className="font-normal">Signed up</th><th className="font-normal">Project</th></tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {res.data.activities.map((a) => {
                      const v = res.data.views.filter((x) => x.activity.id === a.id)
                      const upcoming = v.filter((x) => x.shift.status === 'open' && Date.parse(x.shift.endsAt) > now)
                      return (
                        <tr key={a.id}>
                          <td className="py-2" dir="auto"><Link href={`/volunteers/activities/${a.id}`} className={`${linkCls} font-medium`}>{a.title}</Link><div className="text-xs text-muted">{KIND_EN[a.kind]}{a.adultsOnly ? ' · 18+' : ''}</div></td>
                          <td><ActivityStatusChip status={a.status} /></td>
                          <td className="whitespace-nowrap">{upcoming[0] ? shiftWhen(upcoming[0].shift) : <span className="text-muted">—</span>}</td>
                          <td className="num">{upcoming.length}</td>
                          <td className="num">{upcoming.reduce((n, x) => n + x.counts.confirmed, 0)} / {upcoming.reduce((n, x) => n + x.shift.capacity, 0)}</td>
                          <td dir="auto" className="text-muted">{a.furnitureProjectId ? <Link href={`/furniture/${a.furnitureProjectId}`} className={linkCls}>{a.furnitureProjectName ?? 'Project'}</Link> : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </>
  )
}
