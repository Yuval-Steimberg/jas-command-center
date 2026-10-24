import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MIN_AGE } from '@shared/volunteers/model'
import { currentVolunteer, pendingEmail, safeNext } from '@/lib/session'
import { ActionForm } from '@/components/forms'
import { PreferenceFields, Toggle } from '@/components/profile-fields'
import { Field, Page, Section, Title, input, primaryBtn } from '@/components/ui'
import { registerAction } from './actions'

export const metadata: Metadata = { title: 'הצטרפות' }

export default async function Join({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNext(searchParams.next)
  if (await currentVolunteer().catch(() => null)) redirect(next)
  const email = pendingEmail()
  if (!email) redirect(`/login?next=${encodeURIComponent(next)}`)
  return (
    <Page>
      <Title sub={<>האימייל <span className="ltr font-semibold text-forest">{email}</span> אומת. נשארו שלושה פרטים, וכל השאר לא חובה.</>}>נעים להכיר</Title>
      <ActionForm action={registerAction} hidden={{ next }} submit="סיום והצטרפות" busy="שומרים…" btnClass={`${primaryBtn} mt-6`}>
        <div className="grid gap-4">
          <Field label="שם מלא" htmlFor="fullName"><input id="fullName" name="fullName" required autoComplete="name" maxLength={80} className={input} /></Field>
          <Field label="טלפון נייד" htmlFor="phone" hint="רק הצוות רואה אותו, למקרה שצריך לתאם ביום הפעילות. מתנדבים אחרים לא רואים אותו."><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required dir="ltr" placeholder="050-123-4567" className={`${input} text-left`} /></Field>
          <Toggle name="age16" required label={`אני בן/בת ${MIN_AGE} ומעלה`} />
          <Toggle name="adult" label="אני בן/בת 18 ומעלה" hint="חלק מהפעילויות (הרמה, עבודה בבניינים) פתוחות רק מגיל 18." />
          <Toggle name="consent" required defaultChecked label="אני מסכים/ה לקבל אימיילים על המשמרות שאני נרשם/ת אליהן" hint="אישורים, שינויים וביטולים. בלי זה לא נוכל לעדכן אותך." />
        </div>
        <Section title="כדי להציע לך פעילויות מתאימות (לא חובה)">
          <PreferenceFields />
        </Section>
        <Section title="התראות">
          <div className="grid gap-3">
            <Toggle name="notifyReminders" defaultChecked label="תזכורת יום לפני משמרת" />
            <Toggle name="notifyOpportunities" label="אימייל כשנפתחת פעילות באזורים שבחרתי" hint="לכל היותר פעם בשלושה ימים." />
            <Toggle name="consentWhatsapp" label="מאשר/ת גם הודעות WhatsApp בעתיד" hint="עדיין לא פעיל. נשמור את ההסכמה לכשנחבר מספר וואטסאפ עסקי." />
          </div>
        </Section>
        <p className="mt-6 text-sm text-slate">אין הודעות בין 21:00 ל-08:00, חוץ מעדכון דחוף על משמרת של אותו יום. <Link href="/privacy" className="underline underline-offset-4">מה אנחנו שומרים ולמה</Link>.</p>
      </ActionForm>
    </Page>
  )
}
