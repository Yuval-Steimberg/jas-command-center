import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { formatCount, timeAgo } from '@/lib/format'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { listWebsiteInquiries } from '@/lib/integrations/website/manage'
import { AREA_EN, VOLUNTEER_STATUSES, VOLUNTEER_STATUS_EN, normalizeEmail, type VolunteerStatus } from '@/lib/volunteers/model'
import { personRecords, recordOf } from '@/lib/volunteers/admin'
import { hoursText } from '@/lib/volunteers/rules'
import { input } from '../../website/forms'
import { ActionForm, Field } from '../../inventory/forms'
import { addVolunteerAction } from '../actions'
import { VolNav, personLabel } from '../ui'

export const dynamic = 'force-dynamic'

export default async function PeoplePage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  await requirePageAccess('volunteers:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('volunteers:read_pii')
  const q = pii ? (searchParams.q ?? '').trim().slice(0, 80) : ''
  const status = (VOLUNTEER_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? (searchParams.status as VolunteerStatus) : null
  const now = Date.now()
  const res = await loadOps(async () => {
    const store = getVolunteerStore()
    const people = await store.listVolunteers({ q: q || undefined, statuses: status ? [status] : ['active', 'paused', 'blocked'], limit: 5000 })
    const signups = people.length ? await store.listSignups({ volunteerIds: people.map((p) => p.id), limit: 100_000 }) : []
    const shifts = signups.length ? await store.listShifts({ ids: [...new Set(signups.map((x) => x.shiftId))] }) : []
    return { people, records: personRecords(signups, shifts, now) }
  })
  // Volunteer forms sent on the website (site_inquiries). Names and emails need both read_pii permissions.
  const applicants = pii && may('website:read_pii') ? await listWebsiteInquiries('open') : null
  const registered = new Set<string>()
  if (applicants?.state === 'ok') {
    const emails = [...new Set(applicants.data.inquiries.filter((i) => i.kind === 'volunteer').slice(0, 20).map((i) => normalizeEmail(i.email ?? '')).filter((e): e is string => Boolean(e)))]
    const found = await Promise.all(emails.map((e) => getVolunteerStore().getVolunteerByEmail(e).catch(() => null)))
    for (const v of found) if (v?.email) registered.add(v.email)
  }

  return (
    <>
      <PageHeader title="Volunteers" description="Everyone registered in the volunteer app or by staff. Each volunteer is also a CRM contact with the Volunteer role, so nobody exists twice." />
      <VolNav active="/volunteers/people" />
      {!res.ok ? <OpsUnavailable title="Volunteers are not available" message={res.message} /> : (() => {
        const { people, records } = res.data
        const active = people.filter((p) => p.status === 'active')
        const attendedEver = people.filter((p) => recordOf(records, p.id).attended > 0).length
        const forms = applicants?.state === 'ok' ? applicants.data.inquiries.filter((i) => i.kind === 'volunteer') : []
        return (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="Shown" value={formatCount(people.length)} />
                <Kpi label="Active" value={formatCount(active.length)} />
                <Kpi label="Have attended" value={formatCount(attendedEver)} />
                <Kpi label="Never attended" value={formatCount(people.length - attendedEver)} hint="Registered but no recorded attendance yet" />
              </div>
              <form className="flex flex-wrap items-end gap-2" method="get">
                {pii ? <Field label="Search"><input name="q" defaultValue={q} placeholder="Name, email or phone" dir="auto" className={`${input} w-64`} /></Field> : null}
                <Field label="Status">
                  <select name="status" defaultValue={status ?? ''} className={input}>
                    <option value="">Not deleted</option>
                    {VOLUNTEER_STATUSES.map((x) => <option key={x} value={x}>{VOLUNTEER_STATUS_EN[x]}</option>)}
                  </select>
                </Field>
                <button className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Show</button>
              </form>
              <Card>
                <CardBody>
                  {people.length === 0 ? <p className="text-sm text-muted">{q ? 'Nobody matches.' : 'No volunteers yet. They register in the volunteer app, or add someone on the right.'}</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[46rem] text-sm">
                        <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Volunteer</th>{pii ? <th className="font-normal">Contact</th> : null}<th className="font-normal">Areas</th><th className="font-normal">Attended</th><th className="font-normal">Hours</th><th className="font-normal">Upcoming</th><th className="font-normal">Last time</th><th className="font-normal">Status</th></tr></thead>
                        <tbody className="divide-y divide-line/60">
                          {people.map((p) => {
                            const r = recordOf(records, p.id)
                            return (
                              <tr key={p.id}>
                                <td className="py-2" dir="auto"><Link href={`/volunteers/people/${p.id}`} className={`${linkCls} font-medium`}>{personLabel(p, pii)}</Link>{p.adult ? null : <span className="text-xs text-muted"> · under 18</span>}</td>
                                {pii ? <td className="text-xs text-muted" dir="ltr">{p.email}{p.phone ? <><br />{p.phone}</> : null}</td> : null}
                                <td className="text-xs text-muted">{p.areas.map((x) => AREA_EN[x]).join(', ') || '—'}</td>
                                <td className="num">{r.attended}{r.noShows ? <span className="text-xs text-bad"> · {r.noShows} no-show</span> : null}</td>
                                <td className="num">{hoursText(r.minutes)}</td>
                                <td className="num">{r.upcoming || '—'}</td>
                                <td className="whitespace-nowrap text-muted">{r.lastAttendedAt ? timeAgo(r.lastAttendedAt) : 'never'}</td>
                                <td className="text-xs">{p.status === 'active' ? <span className="text-ok">Active</span> : <span className="text-warn">{VOLUNTEER_STATUS_EN[p.status]}</span>}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
            <div className="flex flex-col gap-4">
              {may('volunteers:write') ? (
                <Card>
                  <CardHeader title="Register a volunteer" />
                  <CardBody>
                    <ActionForm action={addVolunteerAction} hidden={{}} label="Register" busy="Saving…">
                      <Field label="Full name"><input name="fullName" required maxLength={80} dir="auto" className={input} /></Field>
                      <Field label="Email" hint="They sign in to the app with it"><input name="email" type="email" required maxLength={200} dir="ltr" className={input} /></Field>
                      <Field label="Mobile"><input name="phone" required maxLength={20} dir="ltr" placeholder="050-123-4567" className={input} /></Field>
                      <Field label="Notes for the team (optional)"><input name="about" maxLength={500} dir="auto" className={input} /></Field>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="adult" className="h-4 w-4" /> 18 or older</label>
                      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agreed" required className="mt-0.5 h-4 w-4" /> They agreed to be registered and are 16 or older</label>
                      <p className="text-xs text-muted">They get emails only about shifts they are on. Reminders and new-activity emails stay off until they turn them on in the app.</p>
                    </ActionForm>
                  </CardBody>
                </Card>
              ) : null}
              {applicants ? (
                <Card>
                  <CardHeader title="Volunteer forms from the website" meta={<Link href="/website/inquiries" className={linkCls}>All messages</Link>} />
                  <CardBody>
                    {applicants.state !== 'ok' ? <p className="text-sm text-muted">The website cannot be read right now{applicants.state === 'not_configured' ? ' (not connected)' : ''}.</p> : forms.length === 0 ? <p className="text-sm text-muted">No open volunteer forms.</p> : (
                      <ul className="flex flex-col divide-y divide-line/60 text-sm">
                        {forms.slice(0, 20).map((i) => {
                          const email = normalizeEmail(i.email ?? '')
                          return (
                            <li key={i.id} className="py-2">
                              <div className="flex items-center justify-between gap-2"><span className="font-medium" dir="auto">{i.name}</span><span className="text-xs text-muted">{timeAgo(i.created_at)}</span></div>
                              <div className="text-xs text-muted" dir="ltr">{[i.email, i.phone].filter(Boolean).join(' · ')}</div>
                              <div className="text-xs">{email && registered.has(email) ? <span className="text-ok">Registered</span> : <span className="text-warn">Not registered yet: send them the app link, or register them here once they agree</span>}</div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </div>
        )
      })()}
    </>
  )
}
