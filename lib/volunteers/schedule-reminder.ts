/**
 * Messages around the weekly schedule (pure, tested; relative imports only —
 * the volunteer app uses this file too).
 *
 * - The weekly reminder ("can't come? tell us"), sent by the scheduler: by
 *   email to each volunteer scheduled that week (one per volunteer per week,
 *   whatever the number of presses: the outbox dedupe key), and as a WhatsApp
 *   text the scheduler shares to the volunteers' group herself. There is no
 *   WhatsApp sending account; wa.me only opens WhatsApp with the text filled in.
 * - The absence alert: a volunteer reported they will not come, so the people
 *   who schedule that location get an email at once.
 */
import type { NewOutbox } from './store'
import { buildDay, datesOf, dayLabelHe, plusDays, shortDate, weekStart, type ScheduleData, type DayView } from './schedule'

/** The week a reminder is about: this week on Sunday, otherwise the coming one. */
export const reminderWeek = (today: string) => (weekStart(today) === today ? today : plusDays(weekStart(today), 7))

export interface ReminderRecipient {
  volunteerId: string
  /** The dates they are expected (regular, or a confirmed one-date assignment), not absent already. */
  dates: string[]
}

/** The operating days of [week, week+6] from `today` on, open (not closed), each built by buildDay. */
export function weekDays(data: ScheduleData, week: string, today: string): DayView[] {
  const to = plusDays(week, 6)
  const from = week < today ? today : week
  return data.slots
    .filter((s) => s.active)
    .flatMap((s) => datesOf(s, from, to).map((date) => buildDay(data, s, date)))
    .filter((d) => !d.closed)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Who the reminder is for: everyone counted as coming on an operating day of that week. */
export function reminderRecipients(data: ScheduleData, week: string, today: string): ReminderRecipient[] {
  const by = new Map<string, string[]>()
  for (const d of weekDays(data, week, today)) {
    for (const p of [...d.regulars, ...d.assigned]) {
      if (!p.counted) continue
      by.set(p.volunteer.id, [...(by.get(p.volunteer.id) ?? []), d.date])
    }
  }
  return [...by.entries()].map(([volunteerId, dates]) => ({ volunteerId, dates }))
}

const listDates = (dates: string[]) => dates.map(dayLabelHe).join(', ')

export const reminderDedupeKey = (locationId: string, week: string, volunteerId: string) => `sched-reminder:${locationId}:${week}:${volunteerId}`

/** One volunteer's reminder email. Null without an address. */
export function reminderEmail(
  v: { id: string; email: string | null; fullName: string },
  r: ReminderRecipient,
  o: { locationId: string; locationName: string; week: string; appUrl: string | null; notBefore: string },
): NewOutbox | null {
  if (!v.email) return null
  const first = v.fullName.split(' ')[0]
  const app = o.appUrl ? o.appUrl.replace(/\/$/, '') : null
  return {
    volunteerId: v.id,
    toEmail: v.email,
    kind: 'schedule_reminder',
    dedupeKey: reminderDedupeKey(o.locationId, o.week, v.id),
    notBefore: o.notBefore,
    subject: `${o.locationName}: מחכים לך ב${r.dates.length === 1 ? dayLabelHe(r.dates[0]!) : `שבוע ${shortDate(o.week)}`}`,
    body: [
      `היי ${first},`,
      '',
      `בשבוע הקרוב רשום אצלנו שמגיעים ל${o.locationName} ב: ${listDates(r.dates)}.`,
      '',
      'לא מתאים להגיע באחד הימים? חשוב לנו לדעת מראש כדי למצוא מחליף/ה.',
      app ? `לעדכון בשתי לחיצות: ${app}/` : 'אפשר לעדכן אותנו בתשובה למייל הזה.',
      '',
      'אם הכל מתאים, אין צורך לעשות כלום. תודה.',
      '',
      '—',
      'Just A Second · JAS Volunteers',
      app ? `לשינוי העדפות ההתראות: ${app}/profile` : null,
    ].filter((x) => x !== null).join('\n'),
  }
}

/** The text the scheduler shares to the volunteers' WhatsApp group (no names: it goes to a group). */
export function reminderWhatsappText(o: { locationName: string; days: string[]; appUrl: string | null }): string {
  const app = o.appUrl ? `${o.appUrl.replace(/\/$/, '')}/` : null
  return [
    `שלום לכולם, תזכורת לשבוע הקרוב ב${o.locationName}: ${listDates(o.days)}.`,
    'מי שלא יכול/ה להגיע באחד הימים הקבועים, נא לעדכן מראש כדי שנמצא מחליף/ה.',
    app ? `לעדכון: ${app}` : null,
    'תודה.',
  ].filter((x) => x !== null).join('\n')
}

/** Opens WhatsApp (app or web) with the text filled in; the sender picks the group. */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

/** Emails to the location's schedulers: a volunteer will not come on a date. */
export function absenceAlertEmails(
  schedulers: string[],
  o: { absenceId: string; volunteerName: string; date: string; reason: string | null; locationName: string; slotId: string; day: DayView | null; ccUrl: string | null; notBefore: string },
): NewOutbox[] {
  const link = o.ccUrl ? `${o.ccUrl.replace(/\/$/, '')}/schedule/day/${o.slotId}/${o.date}` : null
  const d = o.day
  const status = !d ? null : d.required === null ? `מגיעים עכשיו: ${d.coming} (לא נקבע יעד)` : `מגיעים עכשיו: ${d.coming} מתוך ${d.required}${d.missing ? ` · חסרים ${d.missing}` : ''}`
  return schedulers.map((to) => ({
    volunteerId: null,
    toEmail: to,
    kind: 'schedule_absence',
    dedupeKey: `sched-absence:${o.absenceId}:${to}`,
    notBefore: o.notBefore,
    subject: `${o.volunteerName} לא מגיע/ה ב${dayLabelHe(o.date)}`,
    body: [
      `${o.volunteerName} דיווח/ה באפליקציה שלא יגיע/תגיע ל${o.locationName} ב${dayLabelHe(o.date)}.`,
      o.reason ? `סיבה: ${o.reason}` : null,
      status,
      '',
      link ? `לשיבוץ מחליף/ה: ${link}` : 'אפשר לשבץ מחליף/ה במסך השיבוץ במערכת הניהול.',
      '',
      '—',
      'JAS שיבוץ · הודעה אוטומטית. רק התאריך הזה השתנה; הימים הקבועים לא השתנו.',
    ].filter((x) => x !== null).join('\n'),
  }))
}
