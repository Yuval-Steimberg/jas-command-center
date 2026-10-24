import type { Metadata } from 'next'
import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { requireVolunteer } from '@/lib/session'
import { ActionForm } from '@/components/forms'
import { PreferenceFields, Toggle } from '@/components/profile-fields'
import { Card, Field, Page, Section, Title, input, primaryBtn, quietBtn, secondaryBtn } from '@/components/ui'
import { deleteAccountAction, signOutAction, updateProfileAction } from '../actions'

export const metadata: Metadata = { title: 'הפרופיל שלי' }

export default async function Profile() {
  const v = await requireVolunteer('/profile')
  return (
    <Page>
      <Title sub={<>מחובר/ת כ-<span className="ltr font-semibold text-forest">{v.email}</span></>}>הפרופיל שלי</Title>
      <ActionForm action={updateProfileAction} submit="שמירה" busy="שומרים…" btnClass={`${primaryBtn} mt-6`}>
        <div className="grid gap-4">
          <Field label="שם מלא" htmlFor="fullName"><input id="fullName" name="fullName" required autoComplete="name" maxLength={80} defaultValue={v.fullName} className={input} /></Field>
          <Field label="טלפון נייד" htmlFor="phone" hint="רק הצוות רואה אותו. מתנדבים אחרים לא רואים אותו לעולם."><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required dir="ltr" defaultValue={v.phone ?? ''} className={`${input} text-left`} /></Field>
          <Toggle name="adult" defaultChecked={v.adult} label="אני בן/בת 18 ומעלה" hint="חלק מהפעילויות פתוחות רק מגיל 18." />
        </div>
        <Section title="העדפות">
          <PreferenceFields v={v} />
        </Section>
        <Section title="התראות">
          <div className="grid gap-3">
            <Toggle name="notifyReminders" defaultChecked={v.notifyReminders} label="תזכורת יום לפני משמרת" />
            <Toggle name="notifyOpportunities" defaultChecked={v.notifyOpportunities} label="אימייל כשנפתחת פעילות באזורים שבחרתי" hint="לכל היותר פעם בשלושה ימים." />
            <Toggle name="consentWhatsapp" defaultChecked={v.consentWhatsapp} label="מאשר/ת גם הודעות WhatsApp בעתיד" hint="עדיין לא פעיל." />
          </div>
          <p className="mt-3 text-sm text-slate">אישורים וביטולים של משמרות שנרשמת אליהן נשלחים תמיד, כי בלעדיהם לא נוכל לעדכן אותך. אין הודעות בין 21:00 ל-08:00.</p>
        </Section>
      </ActionForm>

      <Section title="החשבון">
        <div className="grid gap-3">
          <form action={signOutAction}>
            <button className={`${secondaryBtn} w-full`}><LogOut aria-hidden className="h-5 w-5" strokeWidth={1.75} />יציאה</button>
          </form>
          <Link href="/privacy" className={quietBtn}>מה אנחנו שומרים ולמה</Link>
        </div>
      </Section>

      <Section title="מחיקת החשבון">
        <Card tone="cream">
          <p className="text-base leading-relaxed text-ink">המחיקה מבטלת את כל ההרשמות העתידיות שלך ומוחקת את השם, הטלפון, האימייל וההעדפות. שעות שכבר נרשמו נשארות כמספר אנונימי בסיכומים, בלי שום פרט מזהה. אי אפשר לבטל את המחיקה.</p>
          <ActionForm action={deleteAccountAction} submit="מחיקת החשבון" busy="מוחקים…" btnClass={`${secondaryBtn} mt-3 w-full border-bad/40 text-bad`}>
            <Field label='כדי לאשר, נא להקליד "מחיקה"' htmlFor="confirm"><input id="confirm" name="confirm" autoComplete="off" className={`${input} mt-1`} /></Field>
          </ActionForm>
        </Card>
      </Section>
    </Page>
  )
}
