import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { formatDateTime, timeAgo } from '@/lib/format'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { AREA_EN, DAYS, DAY_EN, PARTS, PART_EN, SKILL_EN, TRANSPORT_EN, VOLUNTEER_STATUS_EN } from '@/lib/volunteers/model'
import { personRecords, recordOf } from '@/lib/volunteers/admin'
import { hoursText } from '@/lib/volunteers/rules'
import { input } from '../../../website/forms'
import { ActionForm, Field } from '../../../inventory/forms'
import { addNoteAction, forgetVolunteerAction, volunteerStatusAction } from '../../actions'
import { AttendanceChip, SignupChip, VolNav, personLabel, shiftWhen } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function PersonPage({ params }: { params: { id: string } }) {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('volunteers:read_pii')
  const now = Date.now()
  const res = await loadOps(async () => {
    const store = getVolunteerStore()
    const v = await store.getVolunteer(params.id)
    if (!v) return null
    const signups = await store.listSignups({ volunteerId: v.id })
    const shifts = signups.length ? await store.listShifts({ ids: [...new Set(signups.map((x) => x.shiftId))] }) : []
    const activities = shifts.length ? await store.listActivities({ ids: [...new Set(shifts.map((x) => x.activityId))] }) : []
    const [notes, outbox, events] = await Promise.all([
      pii ? store.listNotes(v.id) : Promise.resolve([]),
      pii ? store.listOutbox({ volunteerId: v.id, limit: 30 }) : Promise.resolve([]),
      store.listEvents({ volunteerId: v.id, limit: 40 }),
    ])
    return { v, signups, shifts, activities, notes, outbox, events }
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return <><PageHeader title="Volunteer" /><OpsUnavailable title="Volunteers are not available" message={res.message} /></>
  const { v, signups, shifts, activities, notes, outbox, events } = res.data!
  const r = recordOf(personRecords(signups, shifts, now), v.id)
  const sh = new Map(shifts.map((x) => [x.id, x]))
  const act = new Map(activities.map((x) => [x.id, x]))
  const rows = signups.map((x) => ({ x, shift: sh.get(x.shiftId)!, a: act.get(sh.get(x.shiftId)?.activityId ?? '') })).filter((y) => y.shift && y.a).sort((p, q) => q.shift.startsAt.localeCompare(p.shift.startsAt))
  const write = may('volunteers:write')
  const deleted = v.status === 'deleted'

  return (
    <>
      <PageHeader
        title={personLabel(v, pii)}
        description={<span className="flex flex-wrap gap-x-3">{pii && !deleted ? <><a href={`mailto:${v.email}`} className={linkCls} dir="ltr">{v.email}</a>{v.phone ? <a href={`tel:${v.phone}`} className={linkCls} dir="ltr">{v.phone}</a> : null}</> : null}<span>{VOLUNTEER_STATUS_EN[v.status]}</span><span>Registered {timeAgo(v.createdAt)} ({v.source === 'app' ? 'in the app' : v.source === 'staff' ? 'by staff' : 'from the website'})</span>{v.contactId && may('crm:read') ? <Link href={`/crm/${v.contactId}`} className={linkCls}>CRM contact</Link> : null}</span>}
      />
      <VolNav active="/volunteers/people" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Shifts attended" value={r.attended} />
            <Kpi label="Hours" value={hoursText(r.minutes)} hint="Recorded attendance only" />
            <Kpi label="No-shows" value={r.noShows} tone={r.noShows ? 'warn' : undefined} />
            <Kpi label="Upcoming" value={r.upcoming} />
          </div>
          <Card>
            <CardHeader title="Shifts" meta={`${rows.length}`} />
            <CardBody>
              {rows.length === 0 ? <p className="text-sm text-muted">No sign-ups yet.</p> : (
                <ul className="flex flex-col divide-y divide-line/60 text-sm">
                  {rows.map(({ x, shift, a }) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span><Link href={`/volunteers/shifts/${shift.id}`} className={linkCls}>{shiftWhen(shift)}</Link> · <span dir="auto">{a!.title}</span></span>
                      <span className="flex items-center gap-2"><SignupChip status={x.status} />{x.status === 'confirmed' && Date.parse(shift.endsAt) <= now ? <AttendanceChip a={x.attendance} /> : null}{x.minutes != null ? <span className="num text-xs">{hoursText(x.minutes)} h</span> : null}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {!deleted ? (
            <Card>
              <CardHeader title="Preferences" meta="set by the volunteer" />
              <CardBody>
                <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
                  <dt className="text-muted">Age</dt><dd>{v.adult ? '18+' : '16–17'}</dd>
                  <dt className="text-muted">Areas</dt><dd>{v.areas.map((x) => AREA_EN[x]).join(', ') || '—'}</dd>
                  <dt className="text-muted">Available</dt>
                  <dd>{v.availability.length ? DAYS.map((d) => { const p = PARTS.filter((x) => v.availability.includes(`${d}_${x}`)); return p.length ? `${DAY_EN[d]} ${p.map((x) => PART_EN[x].toLowerCase()).join('/')}` : null }).filter(Boolean).join(' · ') : '—'}</dd>
                  <dt className="text-muted">Skills</dt><dd>{v.skills.map((x) => SKILL_EN[x]).join(', ') || '—'}</dd>
                  <dt className="text-muted">Vehicle</dt><dd>{TRANSPORT_EN[v.transport]}</dd>
                  {pii && v.about ? <><dt className="text-muted">About</dt><dd dir="auto">{v.about}</dd></> : null}
                  <dt className="text-muted">Emails</dt><dd>Shift confirmations always · reminders {v.notifyReminders ? 'on' : 'off'} · new activities {v.notifyOpportunities ? 'on' : 'off'} · WhatsApp consent {v.consentWhatsapp ? 'given (channel not connected)' : 'no'}</dd>
                </dl>
              </CardBody>
            </Card>
          ) : null}
          {pii && outbox.length ? (
            <Card>
              <CardHeader title="Emails" meta="latest 30" />
              <CardBody>
                <ul className="flex flex-col divide-y divide-line/60 text-sm">
                  {outbox.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span dir="auto">{o.subject}</span><span className={`text-xs ${o.status === 'failed' ? 'text-bad' : 'text-muted'}`}>{o.status}{o.sentAt ? ` · ${timeAgo(o.sentAt)}` : o.status === 'pending' ? ` · due ${formatDateTime(o.notBefore)}` : ''}{o.lastError ? ` · ${o.lastError.slice(0, 80)}` : ''}</span></li>)}
                </ul>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="History" meta="every change, who made it" />
            <CardBody>
              <ul className="flex flex-col gap-1 text-xs">
                {events.map((e) => <li key={e.id} className="flex flex-wrap gap-2"><span className="num text-muted">{formatDateTime(e.at)}</span><span>{e.kind.replace(/_/g, ' ')}</span><span className="text-muted">{e.actor.startsWith('volunteer:') ? 'by the volunteer' : e.actor.replace(/^staff:/, '')}</span></li>)}
              </ul>
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {pii && !deleted ? (
            <Card>
              <CardHeader title="Team notes" meta="never shown to the volunteer" />
              <CardBody className="flex flex-col gap-3">
                {notes.map((n) => <div key={n.id} className="text-sm"><p dir="auto" className="whitespace-pre-wrap">{n.body}</p><p className="text-xs text-muted">{n.authorEmail} · {timeAgo(n.at)}</p></div>)}
                {may('volunteers:operate') ? <ActionForm action={addNoteAction} hidden={{ id: v.id }} label="Add note" busy="Saving…"><textarea name="body" required rows={2} maxLength={2000} dir="auto" className={`${input} h-auto py-2`} /></ActionForm> : null}
              </CardBody>
            </Card>
          ) : null}
          {write && !deleted ? (
            <Card>
              <CardHeader title="Account" />
              <CardBody className="flex flex-col gap-4">
                {v.status !== 'active' ? <ActionForm action={volunteerStatusAction} hidden={{ id: v.id, status: 'active' }} label="Reactivate" busy="Saving…" /> : null}
                {v.status === 'active' ? <ActionForm action={volunteerStatusAction} hidden={{ id: v.id, status: 'paused' }} label="Pause" busy="Saving…"><p className="text-xs text-muted">Signs them out, stops sign-ups and emails. Existing sign-ups stay.</p><input name="reason" placeholder="Reason (optional)" maxLength={300} dir="auto" className={input} /></ActionForm> : null}
                {v.status !== 'blocked' ? <ActionForm action={volunteerStatusAction} hidden={{ id: v.id, status: 'blocked' }} label="Block" busy="Saving…" confirm="Block this volunteer? They are signed out and cannot sign up."><input name="reason" required placeholder="Reason (required)" maxLength={300} dir="auto" className={input} /></ActionForm> : null}
                {pii ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-bad">Erase personal data</summary>
                    <ActionForm action={forgetVolunteerAction} hidden={{ id: v.id }} label="Erase" busy="Erasing…" className="mt-2 flex flex-col gap-2" confirm="Erase this volunteer's name, email, phone and preferences? This cannot be undone.">
                      <p className="text-xs text-muted">For a deletion request. Future sign-ups are cancelled; recorded hours stay as anonymous numbers. The CRM contact keeps its own history.</p>
                      <Field label='Type DELETE'><input name="confirm" autoComplete="off" className={input} /></Field>
                    </ActionForm>
                  </details>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
