import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { env } from '@/lib/env'
import { qrSvg } from '@/lib/inventory/qr'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { recommend } from '@/lib/volunteers/admin'
import { REASON_EN, countSignups, hoursText, shiftPhase } from '@/lib/volunteers/rules'
import { israelDay, israelTime } from '@/lib/volunteers/time'
import type { Signup, Volunteer } from '@/lib/volunteers/model'
import { input } from '../../../website/forms'
import { ActionForm, Field } from '../../../inventory/forms'
import { assignAction, attendanceAction, inviteAction, messageShiftAction, removeAction } from '../../actions'
import { AutoRefresh, OpButtons, PrintButton } from '../../client'
import { AttendanceChip, Fill, SignupChip, VolNav, personLabel, shiftWhen } from '../../ui'

export const dynamic = 'force-dynamic'

const SOURCE: Record<Signup['source'], string> = { self: 'app', invite: 'invited', staff: 'added by staff', walk_in: 'walk-in' }

export default async function ShiftPage({ params }: { params: { id: string } }) {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('volunteers:read_pii')
  const operate = may('volunteers:operate')
  const now = Date.now()
  const res = await loadOps(async () => {
    const store = getVolunteerStore()
    const shift = await store.getShift(params.id)
    if (!shift) return null
    const activity = (await store.getActivity(shift.activityId))!
    const signups = await store.listSignups({ shiftIds: [shift.id] })
    const people = signups.length ? await store.listVolunteers({ ids: [...new Set(signups.map((x) => x.volunteerId))] }) : []
    const live = shift.status === 'open' && activity.status !== 'cancelled' && Date.parse(shift.endsAt) > now - 12 * 3_600_000
    const [recs, everyone] = operate && pii && live
      ? await Promise.all([recommend(store, shift, activity, 10), store.listVolunteers({ statuses: ['active'], limit: 5000 })])
      : [[], [] as Volunteer[]]
    return { shift, activity, signups, people, recs, everyone }
  })
  if (res.ok && !res.data) notFound()
  if (!res.ok) return <><PageHeader title="Shift" /><OpsUnavailable title="Volunteers are not available" message={res.message} /></>
  const { shift, activity: a, signups, people, recs, everyone } = res.data!
  const who = new Map(people.map((p) => [p.id, p]))
  const counts = countSignups(signups)
  const phase = shiftPhase(shift, a, counts.confirmed, now)
  const confirmed = signups.filter((x) => x.status === 'confirmed')
  const waiting = signups.filter((x) => x.status === 'waitlisted').sort((x, y) => (x.queuedAt ?? '').localeCompare(y.queuedAt ?? ''))
  const invited = signups.filter((x) => x.status === 'invited')
  const gone = signups.filter((x) => ['cancelled', 'declined', 'removed'].includes(x.status))
  const started = Date.parse(shift.startsAt) - 3_600_000 <= now
  const live = shift.status === 'open' && a.status !== 'cancelled'
  const appUrl = env().volunteers.appUrl
  const checkinUrl = appUrl ? `${appUrl}/checkin/${shift.id}?c=${shift.checkinCode}` : null
  const qr = operate && live && checkinUrl ? await qrSvg(checkinUrl) : null
  const taken = new Set(signups.filter((x) => ['confirmed', 'waitlisted', 'invited'].includes(x.status)).map((x) => x.volunteerId))
  const minutes = confirmed.reduce((n, x) => n + (x.attendance === 'present' ? x.minutes ?? 0 : 0), 0)

  return (
    <>
      {phase === 'underway' ? <AutoRefresh /> : null}
      <PageHeader
        title={a.title}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>{shiftWhen(shift)}{shift.label ? ` · ${shift.label}` : ''}{shift.role ? ` · ${shift.role}` : ''}</span><Link href={`/volunteers/activities/${a.id}`} className={linkCls}>Activity</Link>{a.address || a.locationName ? <span dir="auto">{[a.locationName, a.address].filter(Boolean).join(', ')}</span> : null}{shift.status === 'cancelled' ? <span className="text-bad">Cancelled</span> : null}</span>}
      />
      <VolNav active="/volunteers/activities" />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="On this shift" meta={<span className="flex items-center gap-3"><Fill confirmed={counts.confirmed} capacity={shift.capacity} min={shift.minVolunteers} waitlisted={counts.waitlisted} />{phase === 'underway' ? <span className="text-xs text-muted">refreshes every 30 s</span> : null}</span>} />
            <CardBody>
              {confirmed.length === 0 ? <p className="text-sm text-muted">Nobody is confirmed yet.</p> : (
                <ul className="flex flex-col divide-y divide-line/60">
                  {confirmed.map((x) => {
                    const v = who.get(x.volunteerId)
                    return (
                      <li key={x.id} className="flex flex-col gap-2 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap items-center gap-2">
                            {pii && v ? <Link href={`/volunteers/people/${v.id}`} className={`${linkCls} font-medium`} dir="auto">{personLabel(v, pii)}</Link> : <span className="font-medium">{personLabel(v, pii)}</span>}
                            {pii && v?.phone ? <a href={`tel:${v.phone}`} className={`${linkCls} text-muted`} dir="ltr">{v.phone}</a> : null}
                            <span className="text-xs text-muted">{SOURCE[x.source]}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <AttendanceChip a={x.attendance} />
                            {x.checkInAt ? <span className="num text-xs text-muted">{israelTime(x.checkInAt)}–{x.checkOutAt ? israelTime(x.checkOutAt) : '…'}</span> : null}
                            {x.minutes != null ? <span className="num text-xs">{hoursText(x.minutes)} h</span> : null}
                          </span>
                        </div>
                        {operate && started && shift.status === 'open' ? (
                          <OpButtons action={attendanceAction} hidden={{ signupId: x.id, shiftId: shift.id, version: x.version }} ops={[
                            ...(!x.checkInAt ? [{ op: 'check_in', label: 'Arrived' }] : []),
                            ...(x.checkInAt && !x.checkOutAt ? [{ op: 'check_out', label: 'Left' }] : []),
                            ...(x.attendance !== 'present' || x.attendanceMethod !== 'full_shift' ? [{ op: 'full_shift', label: 'Whole shift' }] : []),
                            ...(x.attendance !== 'absent' ? [{ op: 'absent', label: 'No-show', tone: 'bad' as const }] : []),
                            ...(x.attendance !== 'excused' ? [{ op: 'excused', label: 'Excused' }] : []),
                            ...(x.attendance !== 'unknown' ? [{ op: 'reset', label: 'Clear' }] : []),
                          ]} />
                        ) : null}
                        {operate && (started || x.attendance !== 'unknown') ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted">Correct the times{x.attendanceNote ? ` · note: ${x.attendanceNote}` : ''}</summary>
                            <ActionForm action={attendanceAction} hidden={{ signupId: x.id, shiftId: shift.id, op: 'correct', version: x.version, date: israelDay(x.checkInAt ?? shift.startsAt) }} label="Save correction" busy="Saving…" className="mt-2 grid gap-2 sm:grid-cols-3">
                              <Field label="Arrived"><input name="in" type="time" required defaultValue={israelTime(x.checkInAt ?? shift.startsAt)} className={input} /></Field>
                              <Field label="Left"><input name="out" type="time" required defaultValue={israelTime(x.checkOutAt ?? new Date(Math.min(now, Date.parse(shift.endsAt))).toISOString())} className={input} /></Field>
                              <Field label="Why (required, audited)"><input name="note" required maxLength={300} dir="auto" className={input} /></Field>
                            </ActionForm>
                          </details>
                        ) : null}
                        {operate && live && Date.parse(shift.startsAt) > now ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted">Remove from the shift</summary>
                            <ActionForm action={removeAction} hidden={{ signupId: x.id, shiftId: shift.id }} label="Remove" busy="Removing…" className="mt-2 flex flex-col gap-2" confirm="Remove this volunteer from the shift? The place goes to the first person on the waitlist.">
                              <Field label="Reason (sent to them unless you tick below)"><input name="reason" maxLength={300} dir="auto" className={input} /></Field>
                              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="silent" className="h-4 w-4" /> Do not email them (e.g. they asked by phone)</label>
                            </ActionForm>
                          </details>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
              {confirmed.some((x) => x.attendance === 'present') ? <p className="mt-2 text-xs text-muted">Recorded: {confirmed.filter((x) => x.attendance === 'present').length} present, {hoursText(minutes)} hours. Hours come only from recorded attendance.</p> : null}
            </CardBody>
          </Card>

          {waiting.length || invited.length ? (
            <Card>
              <CardHeader title="Waiting and invited" />
              <CardBody>
                <ul className="flex flex-col divide-y divide-line/60 text-sm">
                  {waiting.map((x, i) => <Row key={x.id} x={x} v={who.get(x.volunteerId)} pii={pii} lead={`#${i + 1}`} operate={operate && live} shiftId={shift.id} />)}
                  {invited.map((x) => <Row key={x.id} x={x} v={who.get(x.volunteerId)} pii={pii} operate={operate && live} shiftId={shift.id} />)}
                </ul>
                {waiting.length ? <p className="mt-2 text-xs text-muted">A freed place goes to #1 automatically and they are emailed.</p> : null}
              </CardBody>
            </Card>
          ) : null}

          {gone.length ? (
            <details className="rounded-md border border-line/70 p-3 text-sm">
              <summary className="cursor-pointer text-muted">Cancelled, declined or removed ({gone.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {gone.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2"><SignupChip status={x.status} /><span dir="auto">{personLabel(who.get(x.volunteerId), pii)}</span>{x.cancelReason ? <span className="text-xs text-muted" dir="auto">{x.cancelReason}</span> : null}</li>)}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {qr ? (
            <Card>
              <CardHeader title="QR check-in" meta={<PrintButton label="Print" />} />
              <CardBody>
                <div className="mx-auto w-48" dangerouslySetInnerHTML={{ __html: qr }} />
                <p className="mt-2 text-xs text-muted">Hang it at the activity. Volunteers scan it, sign in, and tap &quot;arrived&quot;; a second scan at least 15 minutes later records leaving. Works from an hour before the start until two hours after the end. Someone not signed up joins as a walk-in.</p>
              </CardBody>
            </Card>
          ) : operate && live && !checkinUrl ? <p className="rounded-md border border-dashed border-line p-3 text-xs text-muted">QR check-in needs VOLUNTEER_APP_URL set on this deployment.</p> : null}

          {operate && pii && live ? (
            <Card>
              <CardHeader title="Add someone" />
              <CardBody>
                <ActionForm action={assignAction} hidden={{ shiftId: shift.id }} label="Add to the shift" busy="Adding…">
                  <Field label="Volunteer">
                    <select name="volunteerId" required defaultValue="" className={input}>
                      <option value="" disabled>Choose…</option>
                      {everyone.filter((v) => !taken.has(v.id)).sort((x, y) => x.fullName.localeCompare(y.fullName)).map((v) => <option key={v.id} value={v.id}>{v.fullName}{v.phone ? ` · ${v.phone}` : ''}</option>)}
                    </select>
                  </Field>
                  {started ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="walkIn" className="h-4 w-4" /> Walk-in (turned up today; capacity does not apply)</label> : null}
                  <p className="text-xs text-muted">For someone who agreed by phone. They get a confirmation email. To ask instead, use Invite below. <Link href="/volunteers/people" className={linkCls}>Register a new volunteer</Link></p>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {operate && pii && live && Date.parse(shift.startsAt) > now ? (
            <Card>
              <CardHeader title="Suggested to invite" meta="ranked, never assigned" />
              <CardBody>
                {recs.length === 0 ? <p className="text-sm text-muted">Nobody else fits: everyone eligible is already on it, or nobody is free then.</p> : (
                  <ul className="flex flex-col divide-y divide-line/60 text-sm">
                    {recs.map((r) => (
                      <li key={r.volunteerId} className="flex flex-col gap-1 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/volunteers/people/${r.volunteerId}`} className={`${linkCls} font-medium`} dir="auto">{r.volunteer.fullName}</Link>
                          <ActionForm action={inviteAction} hidden={{ shiftId: shift.id, volunteerId: r.volunteerId }} label="Invite" busy="…" className="flex flex-col items-end gap-1" />
                        </div>
                        <p className="text-xs text-muted">{r.reasons.map((x) => REASON_EN[x.key]).join(' · ')}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}

          {operate && live && confirmed.length ? (
            <Card>
              <CardHeader title="Message everyone confirmed" />
              <CardBody>
                <ActionForm action={messageShiftAction} hidden={{ shiftId: shift.id, requestId: randomUUID() }} label={`Email ${confirmed.length} volunteer${confirmed.length === 1 ? '' : 's'}`} busy="Sending…" confirm={`Send this email to ${confirmed.length} volunteer(s)?`}>
                  <Field label="Message (Hebrew)" hint="Their addresses stay hidden from each other: each gets their own email."><textarea name="text" required rows={4} maxLength={2000} dir="auto" className={`${input} h-auto py-2`} /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}

function Row({ x, v, pii, lead, operate, shiftId }: { x: Signup; v: Volunteer | undefined; pii: boolean; lead?: string; operate: boolean; shiftId: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex items-center gap-2">{lead ? <span className="num text-xs text-muted">{lead}</span> : null}<span dir="auto">{personLabel(v, pii)}</span><SignupChip status={x.status} /></span>
      {operate ? <ActionForm action={removeAction} hidden={{ signupId: x.id, shiftId }} label={x.status === 'invited' ? 'Withdraw invitation' : 'Remove'} busy="…" className="flex flex-col items-end gap-1" confirm="Remove this person from the shift?"><input type="hidden" name="silent" value="on" /></ActionForm> : null}
    </li>
  )
}
