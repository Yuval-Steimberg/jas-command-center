import Link from 'next/link'
import { cn } from '@/lib/cn'
import { ACTIVITY_STATUS_EN, AREAS, AREA_EN, ATTENDANCE_EN, KINDS, KIND_EN, SIGNUP_STATUS_EN, SKILLS, SKILL_EN, type Activity, type ActivityStatus, type Attendance, type Shift, type SignupStatus, type Volunteer } from '@/lib/volunteers/model'
import { israelDay, israelTime } from '@/lib/volunteers/time'
import { input } from '../website/forms'
import { Field } from '../inventory/forms'

const TABS = [
  { href: '/volunteers', label: 'Overview' },
  { href: '/volunteers/activities', label: 'Activities' },
  { href: '/volunteers/calendar', label: 'Calendar' },
  { href: '/volunteers/people', label: 'Volunteers' },
  { href: '/volunteers/reports', label: 'Reports' },
]

export function VolNav({ active }: { active: string }) {
  return (
    <nav aria-label="Volunteers" className="-mt-2 mb-4 flex gap-1 overflow-x-auto border-b border-line/70">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? 'page' : undefined} className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm', active === t.href ? 'border-forest font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

/** Names are personal data: without volunteers:read_pii a volunteer is a short reference, never a name. */
export const personLabel = (v: Pick<Volunteer, 'id' | 'fullName' | 'status'> | undefined, pii: boolean) =>
  !v ? 'Unknown volunteer' : v.status === 'deleted' ? 'Erased volunteer' : pii ? v.fullName : `Volunteer ${v.id.slice(0, 6)}`

const chip = 'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs'

export function ActivityStatusChip({ status }: { status: ActivityStatus }) {
  return <span className={cn(chip, status === 'published' ? 'border-ok/40 bg-ok/10 text-ok' : status === 'cancelled' ? 'border-bad/40 bg-bad/10 text-bad' : status === 'draft' ? 'border-line text-muted' : 'border-line bg-sunken text-muted')}>{ACTIVITY_STATUS_EN[status]}</span>
}

export function SignupChip({ status }: { status: SignupStatus }) {
  return <span className={cn(chip, status === 'confirmed' ? 'border-ok/40 bg-ok/10 text-ok' : status === 'waitlisted' || status === 'invited' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-sunken text-muted')}>{SIGNUP_STATUS_EN[status]}</span>
}

export function AttendanceChip({ a }: { a: Attendance }) {
  return <span className={cn(chip, a === 'present' ? 'border-ok/40 bg-ok/10 text-ok' : a === 'absent' ? 'border-bad/40 bg-bad/10 text-bad' : a === 'excused' ? 'border-line text-ink' : 'border-line text-muted')}>{ATTENDANCE_EN[a]}</span>
}

/** Confirmed against capacity, with the minimum marked. Colour plus the numbers, never colour alone. */
export function Fill({ confirmed, capacity, min, waitlisted }: { confirmed: number; capacity: number; min: number; waitlisted?: number }) {
  const pct = Math.min(100, Math.round((confirmed / Math.max(1, capacity)) * 100))
  const short = confirmed < min
  return (
    <div className="flex min-w-[8rem] items-center gap-2">
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className={cn('h-full', short ? 'bg-warn' : 'bg-sage-deep')} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('num whitespace-nowrap text-xs', short ? 'text-warn' : 'text-ink')}>
        {confirmed}/{capacity}{short ? ` · min ${min}` : ''}{waitlisted ? ` · +${waitlisted} waiting` : ''}
      </span>
    </div>
  )
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'short' })
export const shiftWhen = (s: Pick<Shift, 'startsAt' | 'endsAt'>) => `${dayFmt.format(new Date(s.startsAt))} · ${israelTime(s.startsAt)}–${israelTime(s.endsAt)}`

export interface ProjectOption {
  id: string
  name: string
}

/** The activity form, shared by "new" and "edit". The project list comes from the field app; nothing is typed. */
export function ActivityFields({ a, projects, projectsNote, projectId }: { a?: Activity; projects: ProjectOption[]; projectsNote?: string | null; projectId?: string }) {
  const knownProject = a?.furnitureProjectId && !projects.some((p) => p.id === a.furnitureProjectId)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Title (Hebrew, shown to volunteers)"><input name="title" required maxLength={140} dir="auto" defaultValue={a?.title} className={input} /></Field>
      <Field label="Kind">
        <select name="kind" defaultValue={a?.kind ?? 'collection'} className={input}>{KINDS.map((k) => <option key={k} value={k}>{KIND_EN[k]}</option>)}</select>
      </Field>
      <div className="sm:col-span-2"><Field label="One-line summary"><input name="summary" maxLength={300} dir="auto" defaultValue={a?.summary ?? ''} className={input} /></Field></div>
      <div className="sm:col-span-2"><Field label="Description"><textarea name="description" rows={3} maxLength={4000} dir="auto" defaultValue={a?.description ?? ''} className={`${input} h-auto py-2`} /></Field></div>
      <Field label="Furniture project" hint={projectsNote ?? 'Links this activity to a real project in the field app.'}>
        <select name="furnitureProjectId" defaultValue={a?.furnitureProjectId ?? projectId ?? ''} className={input}>
          <option value="">— none —</option>
          {knownProject ? <option value={a!.furnitureProjectId!}>{a!.furnitureProjectName ?? 'Linked project'} (not found now)</option> : null}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Area">
        <select name="area" defaultValue={a?.area ?? ''} className={input}><option value="">—</option>{AREAS.map((x) => <option key={x} value={x}>{AREA_EN[x]}</option>)}</select>
      </Field>
      <Field label="Place name"><input name="locationName" maxLength={140} dir="auto" defaultValue={a?.locationName ?? ''} className={input} /></Field>
      <Field label="Address" hint="Volunteers get Waze / Google Maps links built from it"><input name="address" maxLength={200} dir="auto" defaultValue={a?.address ?? ''} className={input} /></Field>
      <Field label="Map link (optional, https)"><input name="mapUrl" maxLength={500} dir="ltr" defaultValue={a?.mapUrl ?? ''} className={input} /></Field>
      <Field label="Arrival and parking"><input name="arrivalInfo" maxLength={1000} dir="auto" defaultValue={a?.arrivalInfo ?? ''} className={input} /></Field>
      <Field label="What to bring"><input name="equipment" maxLength={1000} dir="auto" defaultValue={a?.equipment ?? ''} className={input} /></Field>
      <Field label="Physical requirements"><input name="requirements" maxLength={1000} dir="auto" defaultValue={a?.requirements ?? ''} className={input} /></Field>
      <div className="sm:col-span-2"><Field label="Instructions on the day"><textarea name="instructions" rows={2} maxLength={2000} dir="auto" defaultValue={a?.instructions ?? ''} className={`${input} h-auto py-2`} /></Field></div>
      <Field label="Coordinator name (shown to volunteers)"><input name="coordinatorName" maxLength={80} dir="auto" defaultValue={a?.coordinatorName ?? ''} className={input} /></Field>
      <Field label="Contact phone on the day" hint="Shown to signed-up volunteers. Volunteers never see each other's numbers."><input name="contactPhone" maxLength={40} dir="ltr" defaultValue={a?.contactPhone ?? ''} className={input} /></Field>
      <Field label="Sign-up closes (hours before)"><input name="signupClosesHours" type="number" min={0} max={168} defaultValue={a?.signupClosesHours ?? 0} className={input} /></Field>
      <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" name="adultsOnly" defaultChecked={a?.adultsOnly} className="h-4 w-4" /> 18+ only</label>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm text-muted">Required skills (only people with them are recommended; anyone may still sign up)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {SKILLS.map((s) => <label key={s} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="requiredSkills" value={s} defaultChecked={a?.requiredSkills.includes(s)} className="h-4 w-4" />{SKILL_EN[s]}</label>)}
        </div>
      </fieldset>
    </div>
  )
}

/** Date + Israel times. `repeat` adds the weekly copies field (new shifts only). */
export function ShiftFields({ s, repeat }: { s?: Shift; repeat?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Date"><input name="date" type="date" required defaultValue={s ? israelDay(s.startsAt) : ''} className={input} /></Field>
      <Field label="Starts (Israel time)"><input name="start" type="time" required defaultValue={s ? israelTime(s.startsAt) : '09:00'} className={input} /></Field>
      <Field label="Ends" hint="Earlier than the start = past midnight"><input name="end" type="time" required defaultValue={s ? israelTime(s.endsAt) : '13:00'} className={input} /></Field>
      <Field label="Capacity"><input name="capacity" type="number" min={1} max={500} required defaultValue={s?.capacity ?? 6} className={input} /></Field>
      <Field label="Minimum to run"><input name="minVolunteers" type="number" min={0} max={500} defaultValue={s?.minVolunteers ?? 2} className={input} /></Field>
      <Field label="Label (e.g. בוקר)"><input name="label" maxLength={60} dir="auto" defaultValue={s?.label ?? ''} className={input} /></Field>
      <Field label="Role (optional, e.g. נהג/ת)"><input name="role" maxLength={60} dir="auto" defaultValue={s?.role ?? ''} className={input} /></Field>
      {repeat ? <Field label="Repeat weekly" hint="Extra weekly copies, 0–26"><input name="repeatWeeks" type="number" min={0} max={26} defaultValue={0} className={input} /></Field> : null}
    </div>
  )
}
