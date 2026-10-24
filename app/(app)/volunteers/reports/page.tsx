import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { formatChange, formatCount } from '@/lib/format'
import { pct, previousRange, volunteerStats } from '@/lib/volunteers/analytics'
import { hoursText } from '@/lib/volunteers/rules'
import { addDays, israelToUtc } from '@/lib/volunteers/time'
import { input } from '../../website/forms'
import { loadWindow } from '../load'
import { reportRange } from '../range'
import { VolNav } from '../ui'

export const dynamic = 'force-dynamic'

const change = (a: number, b: number) => (b > 0 ? formatChange((a - b) / b) : null)

export default async function VolunteerReports({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const pii = can(s.user.role, 'volunteers:read_pii', s.overrides)
  const now = Date.now()
  const { range, error } = reportRange(searchParams, now)
  const project = searchParams.project || undefined
  // Whole history: "first time" and retention need every earlier attendance, not just this window.
  const res = await loadOps(() => loadWindow('2000-01-01T00:00:00Z', israelToUtc(addDays(range.to, 2), '00:00')!, now))
  const qs = new URLSearchParams({ from: range.from, to: range.to, ...(project ? { project } : {}) }).toString()

  return (
    <>
      <PageHeader title="Volunteer reports" description="Signed up = expected; attended = actually came (recorded attendance). Hours are attended time only. Compared with the equally long period before." />
      <VolNav active="/volunteers/reports" />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1"><span className="text-muted">From</span><input type="date" name="from" defaultValue={range.from} className={input} /></label>
        <label className="flex flex-col gap-1"><span className="text-muted">To</span><input type="date" name="to" defaultValue={range.to} className={input} /></label>
        {project ? <input type="hidden" name="project" value={project} /> : null}
        <button className="h-10 rounded-full border border-line px-4 font-medium hover:bg-sunken">Show</button>
        {error ? <span role="alert" className="text-bad">{error} Showing the last 30 days.</span> : null}
      </form>
      {!res.ok ? <OpsUnavailable title="Volunteers are not available" message={res.message} /> : (() => {
        const filter = project ? { projectId: project === 'none' ? null : project } : {}
        const st = volunteerStats(res.data, range, now, filter)
        const pv = volunteerStats(res.data, previousRange(range), now, filter)
        const name = project ? (st.byProject[0]?.projectName ?? (project === 'none' ? 'No project' : 'Project')) : null
        return (
          <div className="flex flex-col gap-4">
            {name ? <p className="text-sm">Project: <strong dir="auto">{name}</strong> · <Link href={`/volunteers/reports?from=${range.from}&to=${range.to}`} className={linkCls}>all projects</Link></p> : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <Kpi label="Signed up" value={formatCount(st.signedUp)} change={change(st.signedUp, pv.signedUp)} hint="Confirmed places on shifts in the range (expected)" />
              <Kpi label="Attended" value={formatCount(st.attended)} change={change(st.attended, pv.attended)} hint="Recorded as present (actual)" />
              <Kpi label="Hours" value={hoursText(st.minutes)} change={change(st.minutes, pv.minutes)} />
              <Kpi label="People who came" value={formatCount(st.attendees)} sub={`${st.firstTime} first time · ${st.returning} returning`} />
              <Kpi label="Turn-up rate" value={pct(st.attendanceRate)} sub={`${st.absent} no-show`} />
              <Kpi label="Not recorded" value={formatCount(st.unrecorded)} tone={st.unrecorded ? 'warn' : undefined} hint="Confirmed on a finished shift with no attendance: counted nowhere until recorded" />
              <Kpi label="Waitlisted" value={formatCount(st.waitlisted)} />
              <Kpi label="Cancellations" value={formatCount(st.cancellations)} sub={pct(st.cancellationRate)} lowerIsBetter change={change(st.cancellations, pv.cancellations)} />
              <Kpi label="Fill rate" value={pct(st.utilization)} hint="Signed up ÷ capacity" />
              <Kpi label="Shifts" value={formatCount(st.shifts)} />
              <Kpi label="Retention" value={pct(st.retention.rate)} sub={`${st.retention.kept} of ${st.retention.base}`} hint="Of the people who came in the previous period, how many came again in this one" />
              <Kpi label="New volunteers" value={formatCount(st.newRegistrations)} change={change(st.newRegistrations, pv.newRegistrations)} />
            </div>
            <Card>
              <CardHeader title="By furniture project" meta={<span className="flex gap-3"><a href={`/volunteers/export?kind=projects&${qs}`} className={linkCls}>CSV</a></span>} />
              <CardBody>
                {st.byProject.length === 0 ? <p className="text-sm text-muted">No shifts in this range.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Project</th><th className="font-normal">Shifts</th><th className="font-normal">Signed up</th><th className="font-normal">Attended</th><th className="font-normal">Volunteers</th><th className="font-normal">Hours</th></tr></thead>
                      <tbody className="divide-y divide-line/60">
                        {st.byProject.map((p) => (
                          <tr key={p.projectId ?? 'none'}>
                            <td className="py-2" dir="auto">{p.projectId ? <><Link href={`/volunteers/reports?${new URLSearchParams({ from: range.from, to: range.to, project: p.projectId })}`} className={linkCls}>{p.projectName ?? 'Project'}</Link> · <Link href={`/furniture/${p.projectId}`} className={`${linkCls} text-xs text-muted`}>project</Link></> : <span className="text-muted">No project</span>}</td>
                            <td className="num">{p.shifts}</td><td className="num">{p.signedUp}</td><td className="num">{p.attended}</td><td className="num">{p.volunteers}</td><td className="num">{hoursText(p.minutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Day by day" meta={<a href={`/volunteers/export?kind=daily&${qs}`} className={linkCls}>CSV</a>} />
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] text-sm">
                    <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Day</th><th className="font-normal">Signed up</th><th className="font-normal">Attended</th><th className="font-normal">Hours</th></tr></thead>
                    <tbody className="divide-y divide-line/60">
                      {st.daily.filter((d) => d.signedUp || d.attended).map((d) => <tr key={d.day}><td className="num py-1.5">{d.day}</td><td className="num">{d.signedUp}</td><td className="num">{d.attended}</td><td className="num">{hoursText(d.minutes)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
            <p className="flex flex-wrap gap-4 text-sm"><a href={`/volunteers/export?kind=summary&${qs}`} className={linkCls}>Summary CSV</a>{pii ? <a href={`/volunteers/export?kind=people&${qs}`} className={linkCls}>Hours per volunteer CSV (personal data)</a> : null}</p>
          </div>
        )
      })()}
    </>
  )
}
