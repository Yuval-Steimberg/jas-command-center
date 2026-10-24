import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { linkCls } from '@/components/ops/ui'
import { loadOps } from '@/lib/ops/guard'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { buildShiftViews } from '@/lib/volunteers/views'
import { hoursText } from '@/lib/volunteers/rules'
import { Fill, shiftWhen } from './ui'

/**
 * Volunteer participation on one furniture project (activities linked by the
 * project's real id). Shown on the furniture project page. Expected (signed up)
 * and actual (attended) are separate numbers, never one.
 */
export async function ProjectVolunteers({ projectId, canCreate }: { projectId: string; canCreate: boolean }) {
  const now = Date.now()
  const res = await loadOps(async () => {
    const store = getVolunteerStore()
    const activities = await store.listActivities({ projectId, limit: 500 })
    const shifts = activities.length ? await store.listShifts({ activityIds: activities.map((a) => a.id) }) : []
    const signups = shifts.length ? await store.listSignups({ shiftIds: shifts.map((s) => s.id) }) : []
    return { activities, shifts, signups, views: buildShiftViews(activities, shifts, signups, now) }
  })
  const action = canCreate ? <Link href={`/volunteers/activities/new?project=${projectId}`} className={linkCls}>New volunteer activity</Link> : undefined
  if (!res.ok) return <Card className="my-4"><CardHeader title="Volunteers" /><CardBody><p className="text-sm text-muted">{res.message}</p></CardBody></Card>
  const { activities, signups, views } = res.data
  const live = views.filter((v) => v.shift.status === 'open' && v.activity.status !== 'cancelled')
  const upcoming = live.filter((v) => Date.parse(v.shift.endsAt) > now)
  const ids = new Set(live.map((v) => v.shift.id))
  const present = signups.filter((s) => ids.has(s.shiftId) && s.status === 'confirmed' && s.attendance === 'present')
  return (
    <Card className="my-4">
      <CardHeader title="Volunteers" meta={action} />
      <CardBody className="flex flex-col gap-3">
        {activities.length === 0 ? <p className="text-sm text-muted">No volunteer activities are linked to this project yet.</p> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Activities" value={activities.length} />
              <Kpi label="Signed up, upcoming" value={upcoming.reduce((n, v) => n + v.counts.confirmed, 0)} sub={`of ${upcoming.reduce((n, v) => n + v.shift.capacity, 0)} places`} />
              <Kpi label="Attended so far" value={present.length} sub={`${new Set(present.map((s) => s.volunteerId)).size} people`} />
              <Kpi label="Volunteer hours" value={hoursText(present.reduce((n, s) => n + (s.minutes ?? 0), 0))} hint="Recorded attendance only" />
            </div>
            {upcoming.length ? (
              <ul className="flex flex-col divide-y divide-line/60 text-sm">
                {upcoming.slice(0, 8).map((v) => (
                  <li key={v.shift.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><Link href={`/volunteers/shifts/${v.shift.id}`} className={linkCls}>{shiftWhen(v.shift)}</Link> · <span dir="auto">{v.activity.title}</span></span>
                    <Fill confirmed={v.counts.confirmed} capacity={v.shift.capacity} min={v.shift.minVolunteers} waitlisted={v.counts.waitlisted} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No upcoming shifts.</p>}
          </>
        )}
      </CardBody>
    </Card>
  )
}
