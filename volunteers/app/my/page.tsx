import type { Metadata } from 'next'
import Link from 'next/link'
import { FileCheck2 } from 'lucide-react'
import { ATTENDANCE_HE, SIGNUP_STATUS_HE } from '@shared/volunteers/model'
import { loadMine } from '@shared/volunteers/views'
import { hoursText, recordedMinutes } from '@shared/volunteers/rules'
import { requireVolunteer } from '@/lib/session'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { whenHe } from '@/lib/format'
import { Card, Empty, Notice, Page, Pill, Section, Title, secondaryBtn } from '@/components/ui'

export const metadata: Metadata = { title: 'המשמרות שלי' }

type Row = Awaited<ReturnType<typeof loadMine>>[number]

export default async function MyShifts() {
  const v = await requireVolunteer('/my')
  const res = await load(() => loadMine(getStore(), v.id))
  if (!res.ok) return <Page><Title>המשמרות שלי</Title><Notice tone="bad">{res.message}</Notice></Page>
  const now = Date.now()
  const rows = res.data
  const live = (r: Row) => r.shift.status === 'open' && r.activity.status !== 'cancelled'
  const invites = rows.filter((r) => r.signup.status === 'invited' && live(r) && Date.parse(r.shift.startsAt) > now)
  const upcoming = rows.filter((r) => (r.signup.status === 'confirmed' || r.signup.status === 'waitlisted') && live(r) && Date.parse(r.shift.endsAt) > now)
  const past = rows.filter((r) => r.signup.status === 'confirmed' && Date.parse(r.shift.endsAt) <= now).reverse()
  const cancelled = rows.filter((r) => ['cancelled', 'removed', 'declined'].includes(r.signup.status) || (!live(r) && r.signup.status !== 'confirmed')).reverse().slice(0, 10)
  const minutes = recordedMinutes(rows.map((r) => r.signup))

  return (
    <Page>
      <Title>המשמרות שלי</Title>
      <Card tone="sage">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-forest/80">שעות התנדבות שנרשמו</p>
            <p className="num text-3xl font-bold text-forest">{hoursText(minutes)}</p>
          </div>
          {minutes > 0 ? <Link href="/my/certificate" className={`${secondaryBtn} bg-ground`}><FileCheck2 aria-hidden className="h-5 w-5" strokeWidth={1.75} />אישור השתתפות</Link> : null}
        </div>
      </Card>
      {invites.length ? <List title="הזמנות שמחכות לך" rows={invites} /> : null}
      <Section title="קרובות">
        {upcoming.length ? <Rows rows={upcoming} /> : <Empty title="אין משמרות קרובות" href="/activities" cta="למצוא משמרת">כשתירשם/י למשמרת, היא תופיע כאן עם כל הפרטים.</Empty>}
      </Section>
      {past.length ? <List title="השתתפת" rows={past} past /> : null}
      {cancelled.length ? <List title="בוטלו" rows={cancelled} quiet /> : null}
    </Page>
  )
}

function List({ title, rows, past, quiet }: { title: string; rows: Row[]; past?: boolean; quiet?: boolean }) {
  return <Section title={title}><Rows rows={rows} past={past} quiet={quiet} /></Section>
}

function Rows({ rows, past, quiet }: { rows: Row[]; past?: boolean; quiet?: boolean }) {
  return (
    <ul className="grid gap-2">
      {rows.map((r) => {
        const s = r.signup
        const pill = past
          ? { text: s.attendance === 'present' ? `${ATTENDANCE_HE.present}${s.minutes ? ` · ${hoursText(s.minutes)} ש׳` : ''}` : ATTENDANCE_HE[s.attendance], tone: s.attendance === 'present' ? ('ok' as const) : ('neutral' as const) }
          : { text: r.shift.status === 'cancelled' || r.activity.status === 'cancelled' ? 'הפעילות בוטלה' : SIGNUP_STATUS_HE[s.status], tone: s.status === 'confirmed' ? ('ok' as const) : s.status === 'waitlisted' || s.status === 'invited' ? ('warn' as const) : ('neutral' as const) }
        return (
          <li key={s.id}>
            <Link href={`/my/${s.id}`} className={`flex min-h-16 items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 transition hover:shadow-2 ${quiet ? 'bg-cream2/60' : 'bg-paper shadow-1'}`}>
              <span className="min-w-0">
                <span className={`block truncate font-semibold ${quiet ? 'text-slate' : 'text-forest'}`}>{r.activity.title}</span>
                <span className="text-sm text-slate">{whenHe(r.shift)}</span>
              </span>
              <Pill tone={pill.tone}>{pill.text}</Pill>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
