import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { env } from '@/lib/env'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { AREA_EN, KIND_EN, SKILL_EN } from '@/lib/volunteers/model'
import { loadActivity } from '@/lib/volunteers/views'
import { addDays, israelDay } from '@/lib/volunteers/time'
import { input } from '../../../website/forms'
import { ActionForm, Field } from '../../../inventory/forms'
import { activityStatusAction, cancelAction, duplicateAction, saveShiftAction, updateActivityAction } from '../../actions'
import { projectOptions } from '../../load'
import { ActivityFields, ActivityStatusChip, Fill, ShiftFields, VolNav, shiftWhen } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function ActivityPage({ params }: { params: { id: string } }) {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const now = Date.now()
  const res = await loadOps(() => loadActivity(getVolunteerStore(), params.id, now))
  if (res.ok && !res.data) notFound()
  const write = may('volunteers:write')
  const projects = write ? await projectOptions() : { projects: [], note: null }
  const appUrl = env().volunteers.appUrl

  if (!res.ok) return <><PageHeader title="Activity" /><OpsUnavailable title="Volunteers are not available" message={res.message} /></>
  const { activity: a, views } = res.data!
  const upcoming = views.filter((v) => Date.parse(v.shift.endsAt) > now)
  const past = views.filter((v) => Date.parse(v.shift.endsAt) <= now).reverse()
  const live = a.status !== 'cancelled'

  return (
    <>
      <PageHeader
        title={a.title}
        description={<span className="flex flex-wrap items-center gap-2"><ActivityStatusChip status={a.status} /><span>{KIND_EN[a.kind]}{a.area ? ` · ${AREA_EN[a.area]}` : ''}{a.adultsOnly ? ' · 18+' : ''}</span>{a.furnitureProjectId ? <Link href={`/furniture/${a.furnitureProjectId}`} className={linkCls}>{a.furnitureProjectName ?? 'Furniture project'}</Link> : null}{appUrl && a.status === 'published' ? <a href={`${appUrl}/activities/${a.id}`} target="_blank" rel="noreferrer" className={linkCls}>View in volunteer app</a> : null}</span>}
      />
      <VolNav active="/volunteers/activities" />
      {a.status === 'cancelled' ? <p role="status" className="mb-4 rounded-md border border-bad/30 bg-bad/5 p-3 text-sm">Cancelled{a.cancelReason ? `: ${a.cancelReason}` : ''}.</p> : null}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Upcoming shifts" meta={`${upcoming.length}`} />
            <CardBody>
              {upcoming.length === 0 ? <p className="text-sm text-muted">No upcoming shifts.</p> : (
                <ul className="flex flex-col divide-y divide-line/60">
                  {upcoming.map((v) => (
                    <li key={v.shift.id} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span><Link href={`/volunteers/shifts/${v.shift.id}`} className={`${linkCls} font-medium`}>{shiftWhen(v.shift)}</Link>{v.shift.label ? <span className="text-muted" dir="auto"> · {v.shift.label}</span> : null}{v.shift.role ? <span className="text-muted" dir="auto"> · {v.shift.role}</span> : null}{v.shift.status === 'cancelled' ? <span className="text-bad"> · cancelled</span> : null}</span>
                        <span className="flex items-center gap-3">{v.counts.invited ? <span className="text-xs text-muted">{v.counts.invited} invited</span> : null}<Fill confirmed={v.counts.confirmed} capacity={v.shift.capacity} min={v.shift.minVolunteers} waitlisted={v.counts.waitlisted} /></span>
                      </div>
                      {write && live && v.shift.status === 'open' ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted">Edit or cancel this shift</summary>
                          <div className="mt-2 flex flex-col gap-4 rounded-md border border-line/70 p-3">
                            <ActionForm action={saveShiftAction} hidden={{ activityId: a.id, id: v.shift.id, version: v.shift.version }} label="Save shift" busy="Saving…">
                              <ShiftFields s={v.shift} />
                              <p className="text-xs text-muted">Raising capacity moves people up from the waitlist. Changing the time emails everyone confirmed.</p>
                            </ActionForm>
                            <ActionForm action={cancelAction} hidden={{ activityId: a.id, shiftId: v.shift.id }} label="Cancel this shift" busy="Cancelling…" confirm={`Cancel this shift? ${v.counts.confirmed + v.counts.waitlisted + v.counts.invited} volunteer(s) on it will get a cancellation email.`}>
                              <Field label="Reason (sent to the volunteers, Hebrew)"><input name="reason" required maxLength={300} dir="auto" className={input} /></Field>
                            </ActionForm>
                          </div>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {write && live ? (
            <Card>
              <CardHeader title="Add shifts" />
              <CardBody>
                <ActionForm action={saveShiftAction} hidden={{ activityId: a.id }} label="Add" busy="Adding…">
                  <ShiftFields repeat />
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {past.length ? (
            <Card>
              <CardHeader title="Past shifts" meta={`${past.length}`} />
              <CardBody>
                <ul className="flex flex-col divide-y divide-line/60 text-sm">
                  {past.slice(0, 30).map((v) => {
                    const mine = res.data!.signups.filter((x) => x.shiftId === v.shift.id && x.status === 'confirmed')
                    const open = mine.filter((x) => x.attendance === 'unknown').length
                    return (
                      <li key={v.shift.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link href={`/volunteers/shifts/${v.shift.id}`} className={linkCls}>{shiftWhen(v.shift)}</Link>
                        <span className="text-xs">{mine.filter((x) => x.attendance === 'present').length} attended of {mine.length}{open ? <span className="text-warn"> · {open} not recorded</span> : null}</span>
                      </li>
                    )
                  })}
                </ul>
              </CardBody>
            </Card>
          ) : null}
          {write && live ? (
            <Card>
              <CardHeader title="Edit details" meta="volunteers on upcoming shifts are told when the place or instructions change" />
              <CardBody>
                <ActionForm action={updateActivityAction} hidden={{ id: a.id, version: a.version }} label="Save" busy="Saving…">
                  <ActivityFields a={a} projects={projects.projects} projectsNote={projects.note} />
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Details" />
              <CardBody>
                <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
                  {([['Summary', a.summary], ['Place', [a.locationName, a.address].filter(Boolean).join(', ')], ['Arrival', a.arrivalInfo], ['Bring', a.equipment], ['Requirements', a.requirements], ['Instructions', a.instructions], ['Skills', a.requiredSkills.map((k) => SKILL_EN[k]).join(', ')], ['Coordinator', a.coordinatorName]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd dir="auto">{v}</dd></div>)}
                </dl>
              </CardBody>
            </Card>
          )}
        </div>
        {write ? (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title="Status" />
              <CardBody className="flex flex-col gap-3">
                {a.status === 'draft' ? <ActionForm action={activityStatusAction} hidden={{ id: a.id, from: 'draft', to: 'published' }} label="Publish" busy="Publishing…" tone="primary" confirm="Publish? Volunteers will see it in the app, and those who asked for new activities in this area get an email."><p className="text-sm text-muted">Hidden from volunteers until published.</p></ActionForm> : null}
                {a.status === 'published' ? <ActionForm action={activityStatusAction} hidden={{ id: a.id, from: 'published', to: 'draft' }} label="Back to draft" busy="Saving…"><p className="text-sm text-muted">Hides it from volunteers. People already signed up stay signed up.</p></ActionForm> : null}
                {a.status === 'published' && upcoming.length === 0 ? <ActionForm action={activityStatusAction} hidden={{ id: a.id, from: 'published', to: 'completed' }} label="Mark completed" busy="Saving…" /> : null}
                {live && a.status !== 'completed' ? (
                  <ActionForm action={cancelAction} hidden={{ activityId: a.id }} label="Cancel the whole activity" busy="Cancelling…" confirm="Cancel every upcoming shift of this activity? Everyone signed up gets a cancellation email.">
                    <Field label="Reason (sent to the volunteers, Hebrew)"><input name="reason" required maxLength={300} dir="auto" className={input} /></Field>
                  </ActionForm>
                ) : null}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Duplicate" />
              <CardBody>
                <ActionForm action={duplicateAction} hidden={{ id: a.id }} label="Copy as a draft" busy="Copying…">
                  <Field label="First shift of the copy on" hint="Every open shift is copied, same times of day, same gaps between them"><input name="date" type="date" required defaultValue={addDays(israelDay(now), 7)} className={input} /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  )
}
