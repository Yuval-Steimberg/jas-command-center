import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, CalendarCheck, HandHeart, Search } from 'lucide-react'
import { currentVolunteer } from '@/lib/session'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { loadMine, loadUpcoming } from '@shared/volunteers/views'
import { milestones, recordedMinutes, hoursText, scoreMatch } from '@shared/volunteers/rules'
import { ActivityCard, byActivity } from '@/components/shift'
import { Card, Empty, Notice, Page, Pill, Section, primaryBtn, secondaryBtn } from '@/components/ui'
import { placeHe, relativeDayHe, whenHe } from '@/lib/format'
import { SIGNUP_STATUS_HE } from '@shared/volunteers/model'
import { env } from '@/lib/env'

export default async function Home({ searchParams }: { searchParams: { deleted?: string } }) {
  const v = await currentVolunteer().catch(() => null)
  const res = await load(async () => {
    const store = getStore()
    const [up, mine] = await Promise.all([loadUpcoming(store), v ? loadMine(store, v.id) : Promise.resolve([])])
    return { up, mine }
  })

  if (!v) {
    return (
      <>
        <section className="relative isolate overflow-hidden">
          <Image src="/hero.jpg" alt="" fill priority sizes="100vw" className="-z-10 object-cover" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(51,61,54,0.15)_0%,rgba(51,61,54,0.78)_100%)]" />
          <div className="mx-auto flex min-h-[30rem] max-w-xl flex-col justify-end px-5 pb-8 pt-16 text-ground">
            <Image src="/logo.png" alt="Just A Second" width={180} height={34} className="mb-auto h-auto w-40 brightness-0 invert" />
            <p className="text-sm font-semibold tracking-[0.14em]">JAS VOLUNTEERS</p>
            <h1 className="mt-2 font-display text-[2.4rem] leading-[1.08]">מתנדבים איתנו, נותנים לדברים חיים שניים</h1>
            <p className="mt-3 max-w-md text-lg leading-relaxed text-ground/90">איסוף רהיטים מבניינים לפני פינוי, מיון, הכנה לשימוש חוזר ואירועים קהילתיים. בוחרים משמרת שמתאימה לכם, ונרשמים בלחיצה.</p>
          </div>
        </section>
        <Page className="pt-6">
          {searchParams.deleted ? <div className="mb-5"><Notice tone="ok">החשבון והפרטים האישיים שלך נמחקו. תודה על כל מה שעשית איתנו.</Notice></div> : null}
          <Link href="/login" className={primaryBtn}>אני רוצה להתנדב</Link>
          <p className="mt-3 text-center text-base text-slate">כבר רשומים? <Link href="/login" className="font-semibold text-forest underline underline-offset-4">כניסה</Link></p>
          <ol className="mt-8 grid gap-3">
            {[
              { icon: Search, t: 'בוחרים פעילות', d: 'רואים מה פתוח, איפה ומתי, ובלי להירשם קודם.' },
              { icon: CalendarCheck, t: 'נרשמים למשמרת', d: 'שם, טלפון ואימייל. זה הכול, ואפשר לבטל עד תחילת המשמרת.' },
              { icon: HandHeart, t: 'מגיעים ועושים טוב', d: 'מקבלים תזכורת יום לפני, והשעות נרשמות אחרי שהגעתם.' },
            ].map((s, i) => (
              <li key={s.t} className="flex gap-3 rounded-lg border border-line bg-paper p-4 shadow-1">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-soft text-forest"><s.icon aria-hidden className="h-5 w-5" strokeWidth={1.75} /></span>
                <div><p className="font-bold text-forest">{i + 1}. {s.t}</p><p className="text-base leading-relaxed text-slate">{s.d}</p></div>
              </li>
            ))}
          </ol>
          <Section title="פעילויות קרובות" action={<Link href="/activities" className="inline-flex min-h-11 items-center gap-1 text-base font-semibold text-forest underline-offset-4 hover:underline">לכולן <ArrowLeft aria-hidden className="h-4 w-4" /></Link>}>
            {!res.ok ? <Notice tone="bad">{res.message}</Notice> : res.data.up.views.length === 0 ? <Empty title="אין כרגע פעילויות פתוחות">פעילויות חדשות נפתחות כל הזמן. כדאי להירשם, ונעדכן כשתיפתח פעילות באזור שלכם.</Empty> : (
              <div className="grid gap-3">{byActivity(res.data.up.views).slice(0, 3).map((g) => <ActivityCard key={g[0]!.activity.id} views={g} href={`/activities/${g[0]!.activity.id}`} />)}</div>
            )}
          </Section>
          <Footer />
        </Page>
      </>
    )
  }

  const first = v.fullName.split(' ')[0]
  return (
    <Page>
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-base text-slate">שלום {first},</p>
          <h1 className="font-display text-[1.75rem] leading-tight text-forest">טוב שבאת</h1>
        </div>
        <Image src="/logo.png" alt="Just A Second" width={120} height={22} className="h-auto w-28 opacity-90" />
      </header>
      {!res.ok ? <Notice tone="bad">{res.message}</Notice> : (() => {
        const { up, mine } = res.data
        const now = Date.now()
        const invites = mine.filter((m) => m.signup.status === 'invited' && Date.parse(m.shift.startsAt) > now)
        const upcoming = mine.filter((m) => (m.signup.status === 'confirmed' || m.signup.status === 'waitlisted') && Date.parse(m.shift.endsAt) > now && m.shift.status === 'open')
        const next = upcoming.find((m) => m.signup.status === 'confirmed')
        const minutes = recordedMinutes(mine.map((m) => m.signup))
        const attended = mine.filter((m) => m.signup.status === 'confirmed' && m.signup.attendance === 'present').length
        const reached = milestones(attended, minutes).filter((m) => m.reached)
        const taken = new Set(mine.filter((m) => ['confirmed', 'waitlisted', 'invited'].includes(m.signup.status)).map((m) => m.shift.id))
        const theirs = mine.map((m) => ({ signup: m.signup, shift: m.shift }))
        const history = { attended: mine.filter((m) => m.signup.attendance === 'present').map((m) => ({ activity: m.activity })), noShows: mine.filter((m) => m.signup.attendance === 'absent').length }
        const picks = up.views
          .filter((x) => x.phase === 'open' && !taken.has(x.shift.id))
          .map((x) => ({ x, m: scoreMatch(v, x.shift, x.activity, theirs, history) }))
          .filter((p) => p.m)
          .sort((a, b) => b.m!.score - a.m!.score || a.x.shift.startsAt.localeCompare(b.x.shift.startsAt))
        const seen = new Set<string>()
        const recommended = picks.filter((p) => (seen.has(p.x.activity.id) ? false : (seen.add(p.x.activity.id), true))).slice(0, 3)
        return (
          <>
            {invites.length ? (
              <Section title="הוזמנת">
                <div className="grid gap-3">
                  {invites.map((m) => (
                    <Link key={m.signup.id} href={`/my/${m.signup.id}`} className="block rounded-lg border border-brand/40 bg-brand/10 p-4">
                      <p className="font-bold text-forest">{m.activity.title}</p>
                      <p className="text-base text-ink">{whenHe(m.shift)}</p>
                      <p className="mt-1 text-sm font-semibold text-brand-ink">לאישור או לדחייה ←</p>
                    </Link>
                  ))}
                </div>
              </Section>
            ) : null}
            {next ? (
              <Card tone="sage" className="mt-1">
                <p className="text-sm font-semibold text-forest/80">המשמרת הבאה שלך{relativeDayHe(next.shift.startsAt) ? ` · ${relativeDayHe(next.shift.startsAt)}` : ''}</p>
                <p className="mt-1 text-xl font-bold leading-snug text-forest">{next.activity.title}</p>
                <p className="mt-1 text-base text-ink">{whenHe(next.shift)}</p>
                <p className="text-base text-ink">{placeHe(next.activity)}</p>
                <Link href={`/my/${next.signup.id}`} className={`${secondaryBtn} mt-4 w-full bg-ground`}>איפה, מתי ומה להביא</Link>
              </Card>
            ) : (
              <Card tone="cream">
                <p className="text-lg font-bold text-forest">אין לך משמרת קרובה</p>
                <p className="mt-1 text-base text-slate">יש פעילויות פתוחות שמחכות לידיים טובות.</p>
                <Link href="/activities" className={`${primaryBtn} mt-4`}>למצוא משמרת</Link>
              </Card>
            )}
            {upcoming.filter((m) => m !== next).length ? (
              <ul className="mt-3 grid gap-2">
                {upcoming.filter((m) => m !== next).slice(0, 3).map((m) => (
                  <li key={m.signup.id}>
                    <Link href={`/my/${m.signup.id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-2">
                      <span className="min-w-0"><span className="block truncate font-semibold text-forest">{m.activity.title}</span><span className="text-sm text-slate">{whenHe(m.shift)}</span></span>
                      <Pill tone={m.signup.status === 'waitlisted' ? 'warn' : 'ok'}>{SIGNUP_STATUS_HE[m.signup.status]}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <Section title="ההתנדבות שלך">
              <div className="grid grid-cols-2 gap-3">
                <Card><p className="text-sm text-slate">שעות שנרשמו</p><p className="num text-3xl font-bold text-forest">{hoursText(minutes)}</p></Card>
                <Card><p className="text-sm text-slate">משמרות שהשתתפת</p><p className="num text-3xl font-bold text-forest">{attended}</p></Card>
              </div>
              {reached.length ? <div className="mt-3 flex flex-wrap gap-2">{reached.map((m) => <Pill key={m.id} tone="sage">{m.he}</Pill>)}</div> : <p className="mt-2 text-sm text-slate">השעות נרשמות אחרי שהרכז/ת מאשר/ת שהגעת.</p>}
            </Section>

            <Section title="מתאים לך" action={<Link href="/activities" className="inline-flex min-h-11 items-center gap-1 text-base font-semibold text-forest underline-offset-4 hover:underline">כל הפעילויות <ArrowLeft aria-hidden className="h-4 w-4" /></Link>}>
              {recommended.length === 0 ? <Empty title="אין כרגע משמרות פתוחות שמתאימות">כשתיפתח פעילות חדשה היא תופיע כאן. אפשר לעדכן אזורים וזמנים נוחים בפרופיל.</Empty> : (
                <div className="grid gap-3">{recommended.map((p) => <ActivityCard key={p.x.shift.id} views={up.views.filter((w) => w.activity.id === p.x.activity.id && w.phase === 'open')} href={`/activities/${p.x.activity.id}`} />)}</div>
              )}
            </Section>
            <Footer />
          </>
        )
      })()}
    </Page>
  )
}

function Footer() {
  const phone = env().teamPhone
  return (
    <footer className="mt-10 border-t border-line pt-5 text-center text-sm leading-relaxed text-slate">
      <p>Just A Second · מנחם בגין 34, תל אביב · <a className="ltr underline underline-offset-4" href={`tel:${phone.replace(/\D/g, '')}`}>{phone}</a></p>
      <p className="mt-1"><Link href="/privacy" className="underline underline-offset-4">פרטיות ומה אנחנו שומרים</Link></p>
    </footer>
  )
}
