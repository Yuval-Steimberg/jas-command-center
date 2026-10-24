import type { Metadata } from 'next'
import { env } from '@/lib/env'
import { Page, Section, Title } from '@/components/ui'

export const metadata: Metadata = { title: 'פרטיות' }

export default function Privacy() {
  const phone = env().teamPhone
  return (
    <Page>
      <Title sub="בקצרה ובלי אותיות קטנות.">מה אנחנו שומרים ולמה</Title>
      <div className="grid gap-1 text-base leading-relaxed text-ink">
        <Section title="מה נשמר">
          <p>שם, אימייל, טלפון נייד, אישור גיל, ההעדפות שבחרת (אזורים, זמינות, כישורים, רכב), המשמרות שנרשמת אליהן, והגעה שנרשמה במקום.</p>
        </Section>
        <Section title="מי רואה">
          <p>רק צוות Just A Second שמנהל מתנדבים. מתנדבים אחרים לא רואים את הטלפון, האימייל או רשימת המשתתפים. בדף פעילות מוצג רק כמה מקומות נשארו.</p>
        </Section>
        <Section title="למה">
          <p>כדי לשבץ, לעדכן על שינויים, לתזכר לפני משמרת, ולהפיק אישור השתתפות. ההעדפות משמשות רק כדי להציע לך פעילויות מתאימות. אף אחד לא משובץ בלי שבחר בעצמו.</p>
        </Section>
        <Section title="הודעות">
          <p>אישורים וביטולים של משמרות שלך נשלחים תמיד. תזכורות והצעות לפעילויות נשלחות רק אם בחרת בהן, ואפשר לכבות אותן בפרופיל. אין הודעות בין 21:00 ל-08:00.</p>
        </Section>
        <Section title="מחיקה">
          <p>בפרופיל אפשר למחוק את החשבון בכל רגע. הפרטים המזהים נמחקים, וההרשמות העתידיות מתבטלות. שעות שכבר נרשמו נשארות רק כמספר אנונימי בסיכומים.</p>
        </Section>
        {phone ? <Section title="שאלות"><p>אפשר לפנות לצוות בטלפון <span className="ltr">{phone}</span>.</p></Section> : null}
      </div>
    </Page>
  )
}
