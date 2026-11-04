import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentScheduler } from '@/lib/schedule/store'
import { israelDate } from '@/lib/time'
import { scheduleErrorHe } from '@/lib/volunteers/schedule-messages'
import { dayLabelHe, isDate, plusDays, shortDate, weekdayOf } from '@/lib/volunteers/schedule'
import { reminderRecipients, reminderWeek, reminderWhatsappText, weekDays, whatsappShareUrl } from '@/lib/volunteers/schedule-reminder'
import { getVolunteerStore, volunteerContext } from '@/lib/volunteer-store'
import { formatDayTime } from '@/lib/format'
import { Section, empty, rowCls } from '@/components/schedule/bits'
import { ReminderButtons } from './buttons'

export const dynamic = 'force-dynamic'

/**
 * The weekly reminder, sent by the scheduler when she chooses: one email to
 * each volunteer expected that week (never twice for the same week), and the
 * same message for the volunteers' WhatsApp group, which she sends herself.
 */
export default async function RemindPage({ searchParams }: { searchParams?: { week?: string } }) {
  const s = await currentScheduler()
  if ('error' in s) return null
  if (!s.canEdit) redirect('/schedule')
  const today = israelDate()
  const def = reminderWeek(today)
  const week = searchParams?.week && isDate(searchParams.week) && weekdayOf(searchParams.week) === 0 && searchParams.week >= plusDays(def, -7) ? searchParams.week : def
  let data, history
  try {
    ;[data, history] = await Promise.all([s.store.load(s.location.id, week, plusDays(week, 6)), s.store.listReminders(s.location.id, 8)])
  } catch (e) {
    return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{scheduleErrorHe(e)}</p>
  }
  const days = weekDays(data, week, today)
  const recipients = reminderRecipients(data, week, today)
  const vols = recipients.length ? new Map((await getVolunteerStore().listVolunteers({ ids: recipients.map((r) => r.volunteerId), limit: 5000 })).map((v) => [v.id, v])) : new Map()
  const names = new Map(data.volunteers.map((v) => [v.id, v.fullName]))
  const noEmail = recipients.filter((r) => { const v = vols.get(r.volunteerId); return !v?.email || !v.notifyReminders })
  const thisWeek = history.filter((h) => h.weekStart === week)
  const text = reminderWhatsappText({ locationName: s.location.name, days: days.map((d) => d.date), appUrl: volunteerContext().appUrl })
  const other = week === def ? plusDays(def, week > today ? -7 : 7) : def

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">תזכורת שבועית</h1>
        <p className="text-sm text-muted">מבקשים מהמתנדבים לעדכן מראש אם לא יגיעו. מי שמדווח/ת, מופיע/ה מיד בלוח כחסר/ה.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-card">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-ink">שבוע <span className="num" dir="ltr">{shortDate(week)}–{shortDate(plusDays(week, 6))}</span></h2>
          {other >= plusDays(today, -6) ? <Link href={`/schedule/remind?week=${other}`} className="text-sm font-semibold text-forest underline underline-offset-4">{other > week ? 'השבוע הבא' : 'השבוע הנוכחי'}</Link> : null}
        </div>
        <p className="text-sm text-ink">{days.length ? `ימי פעילות: ${days.map((d) => dayLabelHe(d.date)).join(', ')}` : 'אין ימי פעילות פתוחים בשבוע הזה.'}</p>
        <p className="text-sm text-ink"><span className="num font-bold">{recipients.length}</span> מתנדבים משובצים · <span className="num font-bold">{recipients.length - noEmail.length}</span> יקבלו מייל</p>
        {thisWeek.length ? (
          <p className="rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">כבר נשלחה תזכורת לשבוע הזה: {thisWeek.map((h) => `${h.channel === 'email' ? 'מייל' : 'וואטסאפ'} ${formatDayTime(h.createdAt)}`).join(' · ')}. מייל נוסף לא יישלח למי שכבר קיבל.</p>
        ) : null}
        <ReminderButtons week={week} recipients={recipients.length} whatsappUrl={whatsappShareUrl(text)} sentBefore={thisWeek.length > 0} disabled={!recipients.length} />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">נוסח ההודעה לקבוצה</summary>
          <p className="mt-2 whitespace-pre-line rounded-md bg-sunken/60 p-3 text-ink">{text}</p>
        </details>
      </div>

      {noEmail.length ? (
        <Section title="לא יקבלו מייל" count={noEmail.length} tone="warn">
          <p className="text-xs text-muted">אין להם כתובת מייל, או שביקשו לא לקבל תזכורות. הם יראו את ההודעה רק בוואטסאפ.</p>
          <ul className="flex flex-col gap-2">{noEmail.map((r) => <li key={r.volunteerId} className={rowCls}><span className="font-semibold text-ink">{names.get(r.volunteerId) ?? 'מתנדב/ת'}</span></li>)}</ul>
        </Section>
      ) : null}

      <Section title="נשלחו לאחרונה">
        {history.length ? (
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.id} className={rowCls}>
                <span className="flex-1 text-sm text-ink">שבוע {shortDate(h.weekStart)} · {h.channel === 'email' ? `מייל ל-${h.recipients}` : 'וואטסאפ (נפתח לשליחה)'}</span>
                <span className="text-xs text-muted">{formatDayTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : empty('עוד לא נשלחו תזכורות.')}
      </Section>
    </div>
  )
}
