import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { env } from '@/lib/env'
import { formatCount } from '@/lib/format'
import { volunteerStats, pct } from '@/lib/volunteers/analytics'
import { hoursText } from '@/lib/volunteers/rules'
import { addDays, israelDay } from '@/lib/volunteers/time'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { loadWindow } from './load'
import { Fill, VolNav, shiftWhen } from './ui'

export const dynamic = 'force-dynamic'

const D = 86_400_000

export default async function VolunteersOverview() {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const now = Date.now()
  const today = israelDay(now)
  const res = await loadOps(async () => {
    const [w, invites] = await Promise.all([
      loadWindow(new Date(now - 62 * D).toISOString(), new Date(now + 15 * D).toISOString(), now),
      getVolunteerStore().listSignups({ statuses: ['invited'], limit: 5000 }),
    ])
    return { ...w, invites }
  })
  const appUrl = env().volunteers.appUrl

  return (
    <>
      <PageHeader
        title="Volunteers"
        description={<>Activities, shifts and the people on them. Volunteers sign up in the volunteer app{appUrl ? <> (<a href={appUrl} className={linkCls} target="_blank" rel="noreferrer">{appUrl.replace(/^https?:\/\//, '')}</a>)</> : null}; everything here reads and writes the same records.</>}
        actions={may('volunteers:write') ? <Link href="/volunteers/activities/new" className={btn}>New activity</Link> : undefined}
      />
      <VolNav active="/volunteers" />
      {!res.ok ? <OpsUnavailable title="Volunteers are not available" message={res.message} /> : (() => {
        const d = res.data
        const stats = volunteerStats(d, { from: addDays(today, -29), to: today }, now)
        const live = d.views.filter((v) => v.shift.status === 'open' && v.activity.status === 'published')
        const next14 = live.filter((v) => Date.parse(v.shift.startsAt) > now && Date.parse(v.shift.startsAt) < now + 14 * D)
        const short = next14.filter((v) => Date.parse(v.shift.startsAt) < now + 7 * D && v.counts.confirmed < v.shift.minVolunteers)
        const unrecorded = d.views.filter((v) => Date.parse(v.shift.endsAt) <= now && Date.parse(v.shift.endsAt) > now - 30 * D && v.shift.status === 'open' && d.signups.some((x) => x.shiftId === v.shift.id && x.status === 'confirmed' && x.attendance === 'unknown'))
        const unfilled = next14.reduce((n, v) => n + v.places, 0)
        const waiting = next14.reduce((n, v) => n + v.counts.waitlisted, 0)
        const today0 = live.filter((v) => israelDay(v.shift.startsAt) === today || (Date.parse(v.shift.startsAt) <= now && Date.parse(v.shift.endsAt) > now))
        return (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <Kpi label="Registered" value={formatCount(stats.registered)} sub={`+${stats.newRegistrations} in 30 days`} />
              <Kpi label="Active (90 days)" value={formatCount(stats.active90)} hint="Attended at least one shift in the last 90 days" />
              <Kpi label="Shifts, next 14 days" value={formatCount(next14.length)} />
              <Kpi label="Open places" value={formatCount(unfilled)} hint="Free places on published shifts in the next 14 days" />
              <Kpi label="Waiting" value={formatCount(waiting)} hint="On waitlists for the next 14 days" />
              <Kpi label="Attended, 30 days" value={formatCount(stats.attended)} sub={`${stats.attendees} people`} />
              <Kpi label="Hours, 30 days" value={hoursText(stats.minutes)} hint="Recorded attendance only" />
              <Kpi label="Turn-up rate" value={pct(stats.attendanceRate)} hint="Present ÷ (present + no-show), last 30 days" tone={stats.attendanceRate != null && stats.attendanceRate < 0.7 ? 'warn' : undefined} />
            </div>

            {short.length || unrecorded.length || d.invites.length ? (
              <Card>
                <CardHeader title="Needs attention" />
                <CardBody>
                  <ul className="flex flex-col divide-y divide-line/60 text-sm">
                    {short.map((v) => (
                      <li key={`s${v.shift.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span><span className="text-warn">Below minimum</span> · <Link href={`/volunteers/shifts/${v.shift.id}`} className={`${linkCls} font-medium`} dir="auto">{v.activity.title}</Link> · {shiftWhen(v.shift)}</span>
                        <Fill confirmed={v.counts.confirmed} capacity={v.shift.capacity} min={v.shift.minVolunteers} waitlisted={v.counts.waitlisted} />
                      </li>
                    ))}
                    {unrecorded.map((v) => (
                      <li key={`u${v.shift.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span><span className="text-warn">Attendance not recorded</span> · <Link href={`/volunteers/shifts/${v.shift.id}`} className={`${linkCls} font-medium`} dir="auto">{v.activity.title}</Link> · {shiftWhen(v.shift)}</span>
                        <span className="text-xs text-muted">Hours count only once it is</span>
                      </li>
                    ))}
                    {d.invites.length ? <li className="py-2 text-muted">{d.invites.length} invitation{d.invites.length === 1 ? '' : 's'} waiting for the volunteer&apos;s answer.</li> : null}
                  </ul>
                </CardBody>
              </Card>
            ) : null}

            {today0.length ? (
              <Card>
                <CardHeader title="Today" meta="open a shift for the attendance sheet and its QR code" />
                <CardBody><ShiftTable rows={today0} now={now} /></CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Next 14 days" meta={<Link href="/volunteers/calendar" className={linkCls}>Calendar</Link>} />
              <CardBody>{next14.length ? <ShiftTable rows={next14} now={now} /> : <p className="text-sm text-muted">No published shifts in the next two weeks. {may('volunteers:write') ? <Link href="/volunteers/activities/new" className={linkCls}>Create an activity</Link> : null}</p>}</CardBody>
            </Card>
          </div>
        )
      })()}
    </>
  )
}

function ShiftTable({ rows }: { rows: import('@/lib/volunteers/views').ShiftView[]; now: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">When</th><th className="font-normal">Activity</th><th className="font-normal">Project</th><th className="font-normal">Filled</th></tr></thead>
        <tbody className="divide-y divide-line/60">
          {rows.map((v) => (
            <tr key={v.shift.id}>
              <td className="whitespace-nowrap py-2"><Link href={`/volunteers/shifts/${v.shift.id}`} className={linkCls}>{shiftWhen(v.shift)}</Link></td>
              <td dir="auto"><Link href={`/volunteers/activities/${v.activity.id}`} className={`${linkCls} font-medium`}>{v.activity.title}</Link>{v.shift.label ? <span className="text-muted"> · {v.shift.label}</span> : null}</td>
              <td dir="auto" className="text-muted">{v.activity.furnitureProjectId ? <Link href={`/furniture/${v.activity.furnitureProjectId}`} className={linkCls}>{v.activity.furnitureProjectName ?? 'Project'}</Link> : '—'}</td>
              <td><Fill confirmed={v.counts.confirmed} capacity={v.shift.capacity} min={v.shift.minVolunteers} waitlisted={v.counts.waitlisted} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
