import type { Metadata } from 'next'
import Image from 'next/image'
import { loadMine } from '@shared/volunteers/views'
import { hoursText } from '@shared/volunteers/rules'
import { dayLabelHe, israelDay } from '@shared/volunteers/time'
import { requireVolunteer } from '@/lib/session'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { Empty, Notice, Page, Title } from '@/components/ui'
import { PrintButton } from './print'

export const metadata: Metadata = { title: 'אישור השתתפות' }

/**
 * A participation statement built only from recorded attendance: a shift a
 * volunteer signed up for but nobody recorded them at is not on it.
 */
export default async function Certificate() {
  const v = await requireVolunteer('/my/certificate')
  const res = await load(() => loadMine(getStore(), v.id))
  if (!res.ok) return <Page><Title>אישור השתתפות</Title><Notice tone="bad">{res.message}</Notice></Page>
  const rows = res.data.filter((r) => r.signup.status === 'confirmed' && r.signup.attendance === 'present' && r.signup.minutes != null)
  if (!rows.length) return <Page><Title>אישור השתתפות</Title><Empty title="עוד אין שעות רשומות" href="/activities" cta="למצוא משמרת">האישור נבנה רק מהגעה שנרשמה במקום. אחרי המשמרת הראשונה הוא יופיע כאן.</Empty></Page>
  const minutes = rows.reduce((n, r) => n + (r.signup.minutes ?? 0), 0)
  const from = israelDay(rows[0]!.shift.startsAt)
  const to = israelDay(rows.at(-1)!.shift.startsAt)
  return (
    <Page className="print:max-w-none print:p-0">
      <div className="print:hidden"><Title sub="אפשר להדפיס או לשמור כ-PDF מתפריט ההדפסה.">אישור השתתפות</Title></div>
      <article className="rounded-lg border border-line bg-paper p-6 shadow-1 print:border-0 print:shadow-none">
        <Image src="/logo.png" alt="Just A Second" width={180} height={60} className="h-12 w-auto" priority />
        <h2 className="mt-6 font-display text-2xl text-forest">אישור השתתפות בהתנדבות</h2>
        <p className="mt-4 text-base leading-relaxed text-ink">
          אנו מאשרים כי <strong>{v.fullName}</strong> התנדב/ה ב-Just A Second ב-{rows.length} משמרות, בין {from.split('-').reverse().join('.')} ל-{to.split('-').reverse().join('.')}, בהיקף של <strong className="num">{hoursText(minutes)}</strong> שעות.
        </p>
        <table className="mt-5 w-full border-collapse text-start text-sm">
          <thead><tr className="border-b border-line text-slate"><th className="py-2 text-start font-semibold">תאריך</th><th className="py-2 text-start font-semibold">פעילות</th><th className="py-2 text-start font-semibold">שעות</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.signup.id} className="border-b border-line/60 break-inside-avoid">
                <td className="py-2 align-top">{dayLabelHe(r.shift.startsAt)}</td>
                <td className="py-2 align-top">{r.activity.title}</td>
                <td className="num py-2 align-top">{hoursText(r.signup.minutes ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-sm text-slate">השעות נספרות רק לפי הגעה שנרשמה במקום הפעילות. הופק ב-{dayLabelHe(new Date().toISOString())}.</p>
        <p className="mt-1 text-sm text-slate">Just A Second · מנחם בגין 34, תל אביב</p>
      </article>
      <PrintButton />
    </Page>
  )
}
