import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Backpack, CalendarPlus, ClipboardList, Clock, MapPin, Navigation, Phone, UserRound } from 'lucide-react'
import { ATTENDANCE_HE, SIGNUP_STATUS_HE } from '@shared/volunteers/model'
import { hoursText } from '@shared/volunteers/rules'
import { requireVolunteer } from '@/lib/session'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { directions, placeHe, relativeDayHe, telHref, whenHe } from '@/lib/format'
import { env } from '@/lib/env'
import { joinAction, leaveAction } from '@/app/actions'
import { ActionForm } from '@/components/forms'
import { Card, Notice, Page, Pill, Section, input, quietBtn, secondaryBtn } from '@/components/ui'

export const metadata: Metadata = { title: 'פרטי המשמרת' }

const DONE = {
  joined: { tone: 'ok', text: 'נרשמת. שלחנו אישור לאימייל. כל הפרטים כאן, ואפשר להוסיף ליומן.' },
  waitlisted: { tone: 'neutral', text: 'המשמרת מלאה, ונכנסת לרשימת ההמתנה. אם יתפנה מקום, הוא יעבור אלייך לפי הסדר ונעדכן באימייל.' },
  cancelled: { tone: 'ok', text: 'ההרשמה בוטלה. תודה שעדכנת, ככה מישהו אחר יכול להגיע במקומך.' },
  declined: { tone: 'ok', text: 'ההזמנה נדחתה. תודה שעדכנת.' },
} as const

export default async function MyShift({ params, searchParams }: { params: { id: string }; searchParams: { done?: string } }) {
  const done = searchParams.done && searchParams.done in DONE ? DONE[searchParams.done as keyof typeof DONE] : null
  const v = await requireVolunteer(`/my/${params.id}`)
  const res = await load(async () => {
    const store = getStore()
    const s = await store.getSignup(params.id)
    if (!s || s.volunteerId !== v.id) return null
    const shift = (await store.getShift(s.shiftId))!
    const activity = (await store.getActivity(shift.activityId))!
    return { s, shift, activity }
  })
  if (!res.ok) return <Page><Notice tone="bad">{res.message}</Notice></Page>
  if (!res.data) notFound()
  const { s, shift, activity: a } = res.data
  const now = Date.now()
  const live = shift.status === 'open' && a.status !== 'cancelled'
  const upcoming = live && Date.parse(shift.startsAt) > now
  const dir = directions(a)
  const phone = a.contactPhone || env().teamPhone
  const rel = relativeDayHe(shift.startsAt)

  return (
    <Page>
      <Link href="/my" className="mb-3 inline-flex min-h-11 items-center text-base text-slate underline-offset-4 hover:underline">→ המשמרות שלי</Link>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.status === 'confirmed' ? 'ok' : s.status === 'waitlisted' || s.status === 'invited' ? 'warn' : 'neutral'}>{live ? SIGNUP_STATUS_HE[s.status] : 'הפעילות בוטלה'}</Pill>
        {rel && live ? <Pill tone="sage">{rel}</Pill> : null}
        {s.attendance !== 'unknown' ? <Pill tone={s.attendance === 'present' ? 'ok' : 'neutral'}>{ATTENDANCE_HE[s.attendance]}{s.minutes ? ` · ${hoursText(s.minutes)} שעות` : ''}</Pill> : null}
      </div>
      {done ? <div className="mt-3"><Notice tone={done.tone}>{done.text}</Notice></div> : null}
      <h1 className="mt-2 font-display text-[1.75rem] leading-tight text-forest">{a.title}</h1>
      {!live ? <div className="mt-3"><Notice tone="bad">הפעילות בוטלה ואין צורך להגיע.{s.cancelReason && s.cancelReason !== 'shift cancelled' ? ` ${s.cancelReason}` : ''}</Notice></div> : null}
      {s.status === 'waitlisted' && live && !done ? <div className="mt-3"><Notice>המשמרת מלאה ואת/ה ברשימת ההמתנה. אם יתפנה מקום, הוא יעבור אלייך אוטומטית ונשלח אימייל.</Notice></div> : null}

      {s.status === 'invited' && upcoming ? (
        <Card tone="cream" className="mt-4">
          <p className="text-base text-ink">הצוות חשב שהמשמרת הזאת מתאימה לך. שום דבר לא נקבע בלי אישור שלך.</p>
          <div className="mt-3 grid gap-2">
            <ActionForm action={joinAction} hidden={{ shiftId: shift.id }} submit="כן, אני מגיע/ה" busy="נרשמים…" btnClass="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-bold text-forest hover:bg-brand-pressed active:scale-[0.98]" />
            <ActionForm action={leaveAction} hidden={{ signupId: s.id, mode: 'decline' }} submit="לא הפעם" busy="רגע…" btnClass={`${secondaryBtn} w-full`} />
          </div>
        </Card>
      ) : null}

      <ul className="mt-5 grid gap-4 text-base leading-relaxed">
        <Item icon={Clock} label="מתי">
          <p className="text-lg font-semibold text-forest">{whenHe(shift)}</p>
          {shift.label || shift.role ? <p className="text-slate">{[shift.label, shift.role].filter(Boolean).join(' · ')}</p> : null}
          {upcoming && s.status === 'confirmed' ? <a href={`/api/ics/${s.id}`} className={`${secondaryBtn} mt-2`}><CalendarPlus aria-hidden className="h-4 w-4" />הוספה ליומן</a> : null}
        </Item>
        <Item icon={MapPin} label="לאן מגיעים">
          <p className="font-semibold text-forest">{placeHe(a)}</p>
          {a.arrivalInfo ? <p className="text-slate">{a.arrivalInfo}</p> : null}
          {dir.waze || dir.google ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {dir.waze ? <a href={dir.waze} target="_blank" rel="noopener noreferrer" className={secondaryBtn}><Navigation aria-hidden className="h-4 w-4" />ניווט ב-Waze</a> : null}
              {dir.google ? <a href={dir.google} target="_blank" rel="noopener noreferrer" className={secondaryBtn}><MapPin aria-hidden className="h-4 w-4" />Google Maps</a> : null}
            </div>
          ) : null}
        </Item>
        {a.equipment ? <Item icon={Backpack} label="מה להביא"><p className="whitespace-pre-line">{a.equipment}</p></Item> : null}
        {a.instructions || a.description ? <Item icon={ClipboardList} label="מה עושים">{a.instructions ? <p className="whitespace-pre-line">{a.instructions}</p> : null}{a.description ? <p className="mt-1 whitespace-pre-line text-slate">{a.description}</p> : null}</Item> : null}
        {a.requirements ? <Item icon={ClipboardList} label="כדאי לדעת"><p className="whitespace-pre-line">{a.requirements}</p></Item> : null}
        <Item icon={UserRound} label="רכז/ת">{a.coordinatorName ? <p>{a.coordinatorName}</p> : <p className="text-slate">יעודכן</p>}</Item>
        <Item icon={Phone} label="צריך את הצוות?"><a href={telHref(phone)} className="ltr text-lg font-semibold text-forest underline underline-offset-4">{phone}</a></Item>
      </ul>

      {upcoming && (s.status === 'confirmed' || s.status === 'waitlisted') ? (
        <Section title={s.status === 'waitlisted' ? 'לצאת מרשימת ההמתנה' : 'לא יכול/ה להגיע?'}>
          <p className="mb-3 text-base text-slate">{s.status === 'confirmed' ? 'חשוב לבטל מראש: המקום יעבור אוטומטית למי שמחכה ברשימת ההמתנה.' : 'אפשר לצאת מהרשימה בכל רגע.'}</p>
          <details className="rounded-lg border border-line bg-paper">
            <summary className={`${quietBtn} w-full cursor-pointer list-none justify-center text-bad`}>{s.status === 'waitlisted' ? 'יציאה מהרשימה' : 'ביטול ההרשמה'}</summary>
            <div className="border-t border-line p-4">
              <ActionForm action={leaveAction} hidden={{ signupId: s.id }} submit="כן, לבטל" busy="מבטלים…" btnClass="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-bad/40 bg-bad/10 px-5 text-base font-bold text-bad hover:bg-bad/15">
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm font-semibold text-forest">סיבה (לא חובה, עוזר לנו לתכנן)</span>
                  <input name="reason" maxLength={300} className={input} />
                </label>
              </ActionForm>
            </div>
          </details>
        </Section>
      ) : null}
      {live && Date.parse(shift.startsAt) <= now && Date.parse(shift.endsAt) > now && s.status === 'confirmed' ? <p className="mt-6 text-base text-slate">במקום יש קוד QR לרישום הגעה: סורקים אותו עם המצלמה של הטלפון.</p> : null}
    </Page>
  )
}

function Item({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-soft text-forest"><Icon aria-hidden className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate">{label}</p>{children}</div>
    </li>
  )
}
