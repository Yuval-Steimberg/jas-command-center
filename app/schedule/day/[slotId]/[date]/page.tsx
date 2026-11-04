import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentScheduler } from '@/lib/schedule/store'
import { loadDay, realtimeConfig } from '@/lib/schedule/load'
import { scheduleErrorHe } from '@/lib/volunteers/schedule-messages'
import { dayLabelHe, hhmm, WEEKDAY_HE, type Candidate, type PersonOnDay } from '@/lib/volunteers/schedule'
import { assignAction, cancelAssignmentAction, markAbsentAction, setAssignmentStatusAction, withdrawAbsenceAction } from '@/app/schedule/actions'
import { ActButton } from '@/components/schedule/act-button'
import { LiveSchedule } from '@/components/schedule/live'
import { DayStatus, Phone, Section, Stat, empty, rowCls } from '@/components/schedule/bits'
import { ClosureForm } from '@/components/schedule/forms'

export const dynamic = 'force-dynamic'

const SHOWN = 8

/**
 * One operating day: who is coming, who asked to be excused, who was asked to
 * fill in, and who could. Every change is one tap, and nothing is assigned
 * unless Dafna taps it.
 */
export default async function DayPage({ params, searchParams }: { params: { slotId: string; date: string }; searchParams?: { all?: string } }) {
  const s = await currentScheduler()
  if ('error' in s) return null
  let res
  try {
    res = await loadDay(s, params.slotId, params.date)
  } catch (e) {
    return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{scheduleErrorHe(e)}</p>
  }
  if (!res) notFound()
  const { day: d, today } = res
  const past = d.date < today
  const name = new Map(res.data.volunteers.map((v) => [v.id, v.fullName]))
  const coming = [...d.regulars, ...d.assigned].filter((p) => p.counted)
  const asked = d.assigned.filter((p) => p.why === 'tentative')
  const inactive = d.regulars.filter((p) => p.why === 'inactive')
  // Absentees nobody has been put in for yet: a new replacement is recorded as replacing the first of them.
  const covered = new Set(d.assigned.map((p) => p.assignment?.replacesVolunteerId).filter(Boolean))
  const uncovered = d.absent.filter((p) => !covered.has(p.volunteer.id))
  const replaces = uncovered[0]?.volunteer.id ?? null
  const all = searchParams?.all === '1'
  const candidates = all ? d.candidates : d.candidates.slice(0, SHOWN)
  const hours = d.slot.startsAt && d.slot.endsAt ? `${hhmm(d.slot.startsAt)}–${hhmm(d.slot.endsAt)}` : null
  const base = { slotId: d.slot.id, date: d.date }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-ink">{dayLabelHe(d.date)}</h1>
          {hours ? <span className="num text-sm text-muted" dir="ltr">{hours}</span> : null}
        </div>
        <LiveSchedule {...realtimeConfig()} />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-card">
        <DayStatus d={d} past={past} big />
        {d.closed ? null : (
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="נדרשים" value={d.required} />
            <Stat label="מגיעים" value={d.coming} tone="strong" />
            <Stat label="חסרים" value={d.missing} tone={d.missing ? 'warn' : undefined} />
          </dl>
        )}
        {d.required === null && !d.closed ? <Link href="/schedule/team" className="text-sm font-semibold text-forest underline underline-offset-4">לקבוע כמה מתנדבים צריך בימי {WEEKDAY_HE[d.slot.weekday]}</Link> : null}
      </div>
      {past ? <p className="rounded-lg bg-sunken px-4 py-3 text-sm text-muted">היום הזה עבר. מוצג כפי שהיה; אי אפשר לשנות אותו.</p> : null}

      {d.closed ? null : (
        <>
          <Section title="מגיעים" count={coming.length}>
            {coming.length ? (
              <ul className="flex flex-col gap-2">
                {coming.map((p) => (
                  <li key={p.volunteer.id} className={rowCls}>
                    <Person p={p} name={name} />
                    {past ? null : p.basis === 'regular' ? (
                      <ActButton action={markAbsentAction} args={{ ...base, volunteerId: p.volunteer.id }} label="לא יגיע/תגיע" small confirm={`לרשום ש${p.volunteer.fullName} לא יגיע/תגיע ב${dayLabelHe(d.date)}? רק התאריך הזה; הימים הקבועים לא משתנים.`} />
                    ) : (
                      <ActButton action={cancelAssignmentAction} args={{ assignmentId: p.assignment!.id }} label="ביטול שיבוץ" small tone="danger" confirm={`לבטל את השיבוץ של ${p.volunteer.fullName} ב${dayLabelHe(d.date)}?`} />
                    )}
                  </li>
                ))}
              </ul>
            ) : empty('אף אחד עוד לא משובץ ליום הזה.')}
          </Section>

          {asked.length ? (
            <Section title="ממתינים לאישור" count={asked.length}>
              <p className="text-xs text-muted">התבקשו להגיע ועוד לא אישרו. לא נספרים כמגיעים עד הסימון “אישר/ה”, ולא רואים את השיבוץ באפליקציה שלהם.</p>
              <ul className="flex flex-col gap-2">
                {asked.map((p) => (
                  <li key={p.volunteer.id} className={rowCls}>
                    <Person p={p} name={name} />
                    {past ? null : (
                      <>
                        <ActButton action={setAssignmentStatusAction} args={{ assignmentId: p.assignment!.id, status: 'confirmed' as const }} label="אישר/ה שמגיע/ה" small tone="strong" />
                        <ActButton action={cancelAssignmentAction} args={{ assignmentId: p.assignment!.id }} label="לא יכול/ה" small tone="danger" />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {d.absent.length ? (
            <Section title="דיווחו שלא יגיעו" count={d.absent.length} tone="warn">
              <ul className="flex flex-col gap-2">
                {d.absent.map((p) => (
                  <li key={p.volunteer.id} className={rowCls}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{p.volunteer.fullName}</p>
                      <p className="text-xs text-muted">
                        {p.absence!.source === 'volunteer' ? 'דיווח/ה באפליקציה' : 'נרשם על ידך'}
                        {p.absence!.reason ? ` · ${p.absence!.reason}` : ''}
                        {covered.has(p.volunteer.id) ? ' · יש מחליף/ה' : ''}
                      </p>
                    </div>
                    {past ? null : <ActButton action={withdrawAbsenceAction} args={{ absenceId: p.absence!.id }} label="בכל זאת מגיע/ה" small />}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {inactive.length ? (
            <Section title="חשבון לא פעיל" count={inactive.length}>
              <p className="text-xs text-muted">קבועים שהחשבון שלהם מושהה או חסום. הם לא נספרים. אפשר להסיר אותם מהקבועים במסך “קבועים”.</p>
              <ul className="flex flex-col gap-2">{inactive.map((p) => <li key={p.volunteer.id} className={rowCls}><Person p={p} name={name} /></li>)}</ul>
            </Section>
          ) : null}

          {past ? null : (
            <Section title={d.missing ? `מחליפים אפשריים · חסרים ${d.missing}` : 'מתנדבים נוספים'} tone={d.missing ? 'warn' : undefined}>
              <p className="text-xs text-muted">
                {replaces ? `שיבוץ חדש יירשם כמחליף/ה של ${uncovered[0]!.volunteer.fullName}. ` : ''}
                “אמר/ה שפנוי/ה” = כך כתוב בפרופיל שלהם, לא אישור לתאריך הזה. אפשר לשבץ ישר, או לסמן “ביקשתי” ולאשר אחרי שענו.
              </p>
              {candidates.length ? (
                <ul className="flex flex-col gap-2">
                  {candidates.map((c) => (
                    <li key={c.volunteer.id} className={rowCls}>
                      <CandidateInfo c={c} weekday={d.slot.weekday} />
                      <Phone phone={c.volunteer.phone} />
                      <ActButton action={assignAction} args={{ ...base, volunteerId: c.volunteer.id, status: 'confirmed' as const, replaces }} label="שיבוץ" small tone="strong" />
                      <ActButton action={assignAction} args={{ ...base, volunteerId: c.volunteer.id, status: 'tentative' as const, replaces }} label="ביקשתי, ממתין/ה" small />
                    </li>
                  ))}
                </ul>
              ) : empty('אין מתנדבים פעילים נוספים שאפשר לשבץ ביום הזה.')}
              {!all && d.candidates.length > SHOWN ? (
                <Link href={`/schedule/day/${d.slot.id}/${d.date}?all=1`} className="self-start text-sm font-semibold text-forest underline underline-offset-4">להציג את כל {d.candidates.length} המתנדבים</Link>
              ) : null}
            </Section>
          )}
        </>
      )}

      {past ? null : <ClosureForm slotId={d.slot.id} date={d.date} closed={d.closed} />}
    </div>
  )
}

function Person({ p, name }: { p: PersonOnDay; name: Map<string, string> }) {
  const replaces = p.assignment?.replacesVolunteerId
  const tag = p.basis === 'regular' ? 'קבוע/ה' : replaces ? `במקום ${name.get(replaces) ?? 'מתנדב/ת'}` : 'תוספת ליום הזה'
  return (
    <>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{p.volunteer.fullName}</p>
        <p className="text-xs text-muted">{tag}{p.why === 'inactive' ? ' · חשבון לא פעיל' : ''}</p>
      </div>
      <Phone phone={p.volunteer.phone} />
    </>
  )
}

function CandidateInfo({ c, weekday }: { c: Candidate; weekday: number }) {
  return (
    <div className="min-w-0 flex-1 basis-40">
      <p className="font-semibold text-ink">{c.volunteer.fullName}</p>
      <p className="text-xs text-muted">
        {c.availability === 'declared' ? <span className="text-forest">אמר/ה שפנוי/ה בימי {WEEKDAY_HE[weekday]}</span> : 'אין מידע על זמינות'}
        {c.regularWeekdays.length ? ` · קבוע/ה בימי ${c.regularWeekdays.map((w) => WEEKDAY_HE[w]).join(', ')}` : ''}
      </p>
    </div>
  )
}
