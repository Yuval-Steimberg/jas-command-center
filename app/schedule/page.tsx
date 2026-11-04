import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { currentScheduler } from '@/lib/schedule/store'
import { loadWeek, realtimeConfig } from '@/lib/schedule/load'
import { scheduleErrorHe } from '@/lib/volunteers/schedule-messages'
import { dayLabelHe, hhmm, plusDays, shortDate, type DayView } from '@/lib/volunteers/schedule'
import { LiveSchedule } from '@/components/schedule/live'
import { DayStatus, Stat } from '@/components/schedule/bits'

export const dynamic = 'force-dynamic'

/** Dafna's primary screen: the three operating days of one week, each with its staffing at a glance. */
export default async function WeekPage({ searchParams }: { searchParams?: { week?: string } }) {
  const s = await currentScheduler()
  if ('error' in s) return null
  let view
  try {
    view = await loadWeek(s, searchParams?.week)
  } catch (e) {
    return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{scheduleErrorHe(e)}</p>
  }
  const { week, today, days } = view
  const open = days.filter((d) => !d.closed && d.date >= today)
  const missing = open.reduce((n, d) => n + (d.missing ?? 0), 0)
  const unset = open.filter((d) => d.required === null).length
  const thisWeek = week === plusDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay())

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/schedule?week=${plusDays(week, -7)}`} aria-label="השבוע הקודם" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface hover:bg-sunken"><ChevronRight aria-hidden className="h-5 w-5" /></Link>
        <div className="text-center">
          <h1 className="text-xl font-bold text-ink">{thisWeek ? 'השבוע' : 'שבוע'} <span className="num" dir="ltr">{shortDate(days[0]?.date ?? week)}–{shortDate(days.at(-1)?.date ?? plusDays(week, 6))}</span></h1>
          <LiveSchedule {...realtimeConfig(s)} />
        </div>
        <Link href={`/schedule?week=${plusDays(week, 7)}`} aria-label="השבוע הבא" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface hover:bg-sunken"><ChevronLeft aria-hidden className="h-5 w-5" /></Link>
      </div>

      {open.length ? (
        <p className={`rounded-lg px-4 py-3 text-base font-semibold ${missing > 0 ? 'bg-warn/10 text-warn' : unset ? 'bg-sunken text-muted' : 'bg-ok/10 text-ok'}`}>
          {missing > 0 ? `חסרים ${missing} מתנדבים בשבוע הזה` : unset === open.length ? 'עוד לא נקבע כמה מתנדבים צריך בכל יום' : 'כל הימים מאוישים'}
          {missing > 0 && unset ? ` · ב-${unset} ימים לא נקבע יעד` : ''}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {days.map((d) => <DayCard key={`${d.slot.id}:${d.date}`} d={d} past={d.date < today} />)}
      </div>
      {!thisWeek ? <Link href="/schedule" className="self-center text-sm font-semibold text-forest underline underline-offset-4">חזרה לשבוע הנוכחי</Link> : null}
    </div>
  )
}

function DayCard({ d, past }: { d: DayView; past: boolean }) {
  const hours = d.slot.startsAt && d.slot.endsAt ? `${hhmm(d.slot.startsAt)}–${hhmm(d.slot.endsAt)}` : null
  return (
    <Link href={`/schedule/day/${d.slot.id}/${d.date}`} className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card transition-colors duration-150 hover:bg-sunken/60 active:scale-[0.99] ${d.missing ? 'border-warn/40' : 'border-line'} ${past ? 'opacity-60' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{dayLabelHe(d.date)}</h2>
        {hours ? <span className="num text-xs text-muted" dir="ltr">{hours}</span> : null}
      </div>
      <DayStatus d={d} past={past} />
      {d.closed ? null : (
        <dl className="grid grid-cols-3 gap-2">
          <Stat label="נדרשים" value={d.required} />
          <Stat label="קבועים" value={d.regulars.length} />
          <Stat label="היעדרויות" value={d.absent.length} tone={d.absent.length ? 'warn' : undefined} />
          <Stat label="מגיעים" value={d.coming} tone="strong" />
          <Stat label="ממתינים" value={d.tentative} />
          <Stat label="זמינים" value={d.declaredCandidates} hint={d.candidates.length > d.declaredCandidates ? `+${d.candidates.length - d.declaredCandidates}` : undefined} />
        </dl>
      )}
      {d.absent.length ? (
        <p className="text-sm text-muted">לא יגיעו: <span className="text-ink">{d.absent.map((p) => p.volunteer.fullName).join(', ')}</span></p>
      ) : null}
    </Link>
  )
}
