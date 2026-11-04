import { CalendarCheck, CalendarX, Lock } from 'lucide-react'
import { dayLabelHe, hhmm, myDays, myRegularWeekdays, plusDays, WEEKDAY_HE, type ScheduleData } from '@shared/volunteers/schedule'
import { Card, Empty, Notice, Pill, Section } from './ui'
import { ReportAbsence, WithdrawAbsence } from './absence'

export const WEEKS_AHEAD = 6

/**
 * The volunteer's schedule: their regular days, and every scheduled date in
 * the next weeks with one action each: "I will not come" (or take it back).
 */
export function MyDays({ data, volunteerId, today, justReported, back }: { data: ScheduleData; volunteerId: string; today: string; justReported?: string; back?: boolean }) {
  const days = myDays(data, volunteerId, today, plusDays(today, WEEKS_AHEAD * 7))
  const regular = myRegularWeekdays(data, volunteerId, today)
  const places = [...new Set(regular.map((r) => r.location.name))]
  return (
    <Section title="הימים שלי">
      {justReported ? <div className="mb-3"><Notice tone="ok">נרשם שלא תגיעו ב{dayLabelHe(justReported)}. צוות השיבוץ כבר רואה את זה. הימים הקבועים שלכם לא השתנו.</Notice></div> : null}
      {back ? <div className="mb-3"><Notice tone="ok">מעולה, נרשם שאתם מגיעים.</Notice></div> : null}
      {regular.length ? (
        <p className="mb-3 text-base text-ink">
          ימים קבועים{places.length === 1 ? ` ב${places[0]}` : ''}: <span className="font-semibold text-forest">{regular.map((r) => `${WEEKDAY_HE[r.slot.weekday]}${places.length > 1 ? ` (${r.location.name})` : ''}`).join(', ')}</span>
        </p>
      ) : null}
      {days.length === 0 ? (
        <Empty title="עוד לא שובצתם">צוות השיבוץ קובע את הימים. כשתשובצו, הימים יופיעו כאן, ותוכלו לסמן מראש יום שבו לא תוכלו להגיע.</Empty>
      ) : (
        <ul className="grid gap-3">
          {days.map((d) => {
            const hours = d.slot.startsAt && d.slot.endsAt ? `${hhmm(d.slot.startsAt)}–${hhmm(d.slot.endsAt)}` : null
            const label = dayLabelHe(d.date)
            return (
              <li key={`${d.slot.id}:${d.date}`}>
                <Card tone={d.absence || d.closed ? 'cream' : 'paper'}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-forest">{label}{d.date === today ? ' · היום' : ''}</p>
                      <p className="text-base text-slate">{d.location.name}{hours ? <> · <span className="num ltr">{hours}</span></> : null}</p>
                    </div>
                    {d.closed ? <Pill><Lock aria-hidden className="h-3.5 w-3.5" />סגור</Pill>
                      : d.absence ? <Pill tone="warn"><CalendarX aria-hidden className="h-3.5 w-3.5" />לא מגיעים</Pill>
                      : <Pill tone="ok"><CalendarCheck aria-hidden className="h-3.5 w-3.5" />{d.basis === 'assigned' ? 'שובצתם' : 'מגיעים'}</Pill>}
                  </div>
                  {d.closed ? <p className="mt-2 text-sm text-slate">הסדנה סגורה ביום הזה{d.closed.reason ? ` (${d.closed.reason})` : ''}. אין צורך להגיע.</p>
                    : d.absence ? <div className="mt-3"><p className="mb-1 text-sm text-slate">נרשם שלא תגיעו{d.absence.reason ? `: ${d.absence.reason}` : ''}.</p><WithdrawAbsence absenceId={d.absence.id} /></div>
                    : <div className="mt-3"><ReportAbsence slotId={d.slot.id} date={d.date} label={label} /></div>}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
