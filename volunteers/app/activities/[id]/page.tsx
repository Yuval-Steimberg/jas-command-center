import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Backpack, ClipboardList, Dumbbell, MapPin, Navigation, Phone, UserRound } from 'lucide-react'
import { KIND_HE, SIGNUP_STATUS_HE, SKILL_HE } from '@shared/volunteers/model'
import { loadActivity } from '@shared/volunteers/views'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { currentVolunteer } from '@/lib/session'
import { directions, placeHe, placesHe, telHref, whenHe } from '@/lib/format'
import { env } from '@/lib/env'
import { joinAction } from '@/app/actions'
import { ActionForm } from '@/components/forms'
import { Card, Notice, Page, Pill, Section, secondaryBtn } from '@/components/ui'

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const a = await getStore().getActivity(params.id).catch(() => null)
  return { title: a?.status === 'published' ? a.title : 'פעילות' }
}

const joinBtn = 'inline-flex min-h-12 w-full items-center justify-center rounded-full bg-forest px-5 text-base font-bold text-ground transition hover:bg-forest/90 active:scale-[0.98] disabled:opacity-60'

export default async function ActivityPage({ params }: { params: { id: string } }) {
  const v = await currentVolunteer().catch(() => null)
  const res = await load(async () => {
    const d = await loadActivity(getStore(), params.id)
    const mine = v && d ? await getStore().listSignups({ volunteerId: v.id, shiftIds: d.shifts.map((s) => s.id) }) : []
    return d ? { ...d, mine } : null
  })
  if (res.ok && (!res.data || (res.data.activity.status !== 'published' && res.data.activity.status !== 'cancelled'))) notFound()
  if (!res.ok) return <Page><Notice tone="bad">{res.message}</Notice></Page>
  const { activity: a, views, mine } = res.data!
  const now = Date.now()
  const shown = views.filter((x) => Date.parse(x.shift.endsAt) > now && x.shift.status === 'open')
  const dir = directions(a)
  const phone = a.contactPhone || env().teamPhone
  const minor = v && a.adultsOnly && !v.adult

  return (
    <Page>
      <Link href="/activities" className="mb-3 inline-flex min-h-11 items-center text-base text-slate underline-offset-4 hover:underline">→ כל הפעילויות</Link>
      <p className="text-sm font-medium text-slate">{KIND_HE[a.kind]}</p>
      <h1 className="mt-1 font-display text-[1.75rem] leading-tight text-forest">{a.title}</h1>
      {a.status === 'cancelled' ? <div className="mt-3"><Notice tone="bad">הפעילות הזאת בוטלה.{a.cancelReason ? ` ${a.cancelReason}` : ''}</Notice></div> : null}
      {a.summary ? <p className="mt-2 text-lg leading-relaxed text-ink">{a.summary}</p> : null}
      {a.photoUrls.length ? (
        <div className="-mx-4 mt-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
          {a.photoUrls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="" className="h-44 w-72 shrink-0 snap-start rounded-lg object-cover" loading="lazy" />
          ))}
        </div>
      ) : null}

      <Section title="משמרות">
        {shown.length === 0 ? <p className="text-base text-slate">אין משמרות קרובות בפעילות הזאת.</p> : (
          <ul className="grid gap-3">
            {shown.map((x) => {
              const s = mine.find((m) => m.shiftId === x.shift.id && ['confirmed', 'waitlisted', 'invited'].includes(m.status))
              const p = placesHe(x)
              return (
                <li key={x.shift.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-forest">{whenHe(x.shift)}</p>
                        {x.shift.label || x.shift.role ? <p className="text-base text-slate">{[x.shift.label, x.shift.role].filter(Boolean).join(' · ')}</p> : null}
                      </div>
                      <Pill tone={p.tone}>{p.text}</Pill>
                    </div>
                    <div className="mt-3">
                      {s ? (
                        <Link href={`/my/${s.id}`} className={`${secondaryBtn} w-full`}>{s.status === 'invited' ? 'הוזמנת · לאישור' : `${SIGNUP_STATUS_HE[s.status]} · לפרטים`}</Link>
                      ) : !v ? (
                        x.phase === 'open' || x.phase === 'full' ? <Link href={`/login?next=${encodeURIComponent(`/activities/${a.id}`)}`} className={joinBtn}>להרשמה (כניסה קצרה)</Link> : null
                      ) : minor ? (
                        <p className="text-base text-slate">הפעילות הזאת מגיל 18.</p>
                      ) : x.phase === 'open' || x.phase === 'full' ? (
                        <ActionForm action={joinAction} hidden={{ shiftId: x.shift.id }} submit={x.phase === 'full' ? 'להצטרף לרשימת ההמתנה' : 'להירשם למשמרת'} busy="נרשמים…" btnClass={x.phase === 'full' ? `${secondaryBtn} w-full` : joinBtn} />
                      ) : null}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="פרטים">
        <ul className="grid gap-4 text-base leading-relaxed">
          <Detail icon={MapPin} label="איפה">
            <p>{placeHe(a)}</p>
            {a.arrivalInfo ? <p className="text-slate">{a.arrivalInfo}</p> : null}
            {dir.waze || dir.google ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {dir.waze ? <a href={dir.waze} target="_blank" rel="noopener noreferrer" className={secondaryBtn}><Navigation aria-hidden className="h-4 w-4" />Waze</a> : null}
                {dir.google ? <a href={dir.google} target="_blank" rel="noopener noreferrer" className={secondaryBtn}><MapPin aria-hidden className="h-4 w-4" />Google Maps</a> : null}
              </div>
            ) : null}
          </Detail>
          {a.description || a.instructions ? <Detail icon={ClipboardList} label="מה עושים">{a.description ? <p className="whitespace-pre-line">{a.description}</p> : null}{a.instructions ? <p className="mt-1 whitespace-pre-line text-slate">{a.instructions}</p> : null}</Detail> : null}
          {a.equipment ? <Detail icon={Backpack} label="מה להביא"><p className="whitespace-pre-line">{a.equipment}</p></Detail> : null}
          {a.requirements || a.adultsOnly || a.requiredSkills.length ? (
            <Detail icon={Dumbbell} label="כדאי לדעת">
              {a.requirements ? <p className="whitespace-pre-line">{a.requirements}</p> : null}
              {a.adultsOnly ? <p>מגיל 18 ומעלה.</p> : null}
              {a.requiredSkills.length ? <p>נדרש: {a.requiredSkills.map((s) => SKILL_HE[s]).join(', ')}</p> : null}
            </Detail>
          ) : null}
          {a.coordinatorName ? <Detail icon={UserRound} label="רכז/ת"><p>{a.coordinatorName}</p></Detail> : null}
          <Detail icon={Phone} label="שאלות"><a href={telHref(phone)} className="ltr font-semibold text-forest underline underline-offset-4">{phone}</a></Detail>
        </ul>
      </Section>
    </Page>
  )
}

function Detail({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-soft text-forest"><Icon aria-hidden className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate">{label}</p>{children}</div>
    </li>
  )
}
