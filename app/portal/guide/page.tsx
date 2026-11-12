import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  BookOpen,
  Copy,
  Eye,
  HelpCircle,
  LayoutGrid,
  ListChecks,
  MessageCircleQuestion,
  MessagesSquare,
  Mic,
  ScanFace,
  ScanLine,
  Search,
  Share2,
  Smartphone,
  Star,
  type LucideIcon,
} from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { AudienceTag } from '@/components/portal/bits'
import { SharePortalButton, ShareButtons } from '@/components/portal/share'

export const dynamic = 'force-dynamic'

/**
 * The portal guide, for people who are not technical: what each part of the
 * home page does, how to scan, ask and share, and how to install it on a
 * phone. The manager part (links, the change chat) only for portal:manage.
 * Plain Hebrew, short sentences, one idea per paragraph.
 */
function Section({ id, icon: Icon, title, children }: { id: string; icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 rounded-lg border border-line bg-surface p-5 shadow-card">
      <h2 id={`${id}-h`} className="flex items-center gap-3 text-xl font-extrabold text-ink">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-sage-soft text-forest">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-base leading-relaxed text-ink [&_li]:ms-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ul]:list-disc [&_ul]:space-y-1.5">{children}</div>
    </section>
  )
}

const Tip = ({ children }: { children: React.ReactNode }) => <p className="rounded-md bg-sunken px-4 py-3 text-sm text-muted">{children}</p>
const B = ({ children }: { children: React.ReactNode }) => <strong className="font-bold">{children}</strong>

export default async function GuidePage() {
  const s = await getSession()
  if (!s) redirect('/login?next=%2Fportal%2Fguide')
  const manager = can(s.user.role, 'portal:manage', s.overrides)

  const toc = [
    ['home', 'מה יש במסך הראשי'],
    ['today', 'מה מחכה לי היום'],
    ['scan', 'סריקה'],
    ['ask', 'לשאול'],
    ['buttons', 'כפתורים וקטגוריות'],
    ['share', 'שיתוף קישורים'],
    ['install', 'הפורטל כאפליקציה בטלפון'],
    ['faceid', 'כניסה עם Face ID'],
    ...(manager ? [['manage', 'למנהלת הפורטל']] : []),
    ['help', 'כשמשהו לא עובד'],
  ] as const

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/portal" className="-ms-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted hover:bg-sunken hover:text-ink">
        <ArrowRight aria-hidden className="size-4" />
        חזרה לפורטל
      </Link>
      <h1 className="flex items-center gap-3 text-3xl font-extrabold text-ink">
        <BookOpen aria-hidden className="size-7 text-forest" strokeWidth={1.75} />
        מדריך לפורטל
      </h1>
      <p className="mt-2 text-lg text-muted">הפורטל הוא נקודת הכניסה לכל העבודה היומית ב-Just A Second. לא צריך לזכור איזו מערכת עושה מה: נכנסים לכאן, ומכאן מגיעים לכל מקום.</p>

      <nav aria-label="תוכן המדריך" className="mt-6 rounded-lg border border-line bg-surface p-4">
        <p className="mb-2 text-sm font-bold text-ink">במדריך</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {toc.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex min-h-11 items-center text-base text-forest underline-offset-4 hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex flex-col gap-5">
        <Section id="home" icon={LayoutGrid} title="מה יש במסך הראשי">
          <p>מלמעלה למטה:</p>
          <ol>
            <li><B>סריקה</B> ו<B>לשאול</B>: שני הכפתורים הגדולים. מוסבר בהמשך.</li>
            <li><B>חיפוש</B>: כותבים מה רוצים לעשות (למשל &quot;מכירה&quot; או &quot;מתנדבים&quot;) והכפתור המתאים מופיע מיד.</li>
            <li><B>מה מחכה לי היום</B>: מה צריך לטפל בו עכשיו.</li>
            <li><B>השימושים שלך</B>: הכפתורים שאתם פותחים הכי הרבה, ראשונים.</li>
            <li><B>הקטגוריות</B>: כל העבודה מסודרת לפי נושאים.</li>
          </ol>
          <Tip>כל אחד רואה רק את מה שרלוונטי לתפקיד שלו. אם חסר לכם כפתור, פנו למנהלת הפורטל.</Tip>
        </Section>

        <Section id="today" icon={ListChecks} title="מה מחכה לי היום">
          <p>רשימה קצרה של מה שמחכה לכם היום. כל שורה היא כפתור: לוחצים, והמסך שמטפל בזה נפתח.</p>
          <ul>
            <li>משלוחים באיחור, ומשלוחים שיוצאים היום.</li>
            <li>לקוחות שקנו פריט ועוד צריכים לאסוף אותו.</li>
            <li>פריטים ששמרנו ללקוח, שהשמירה עליהם נגמרת היום.</li>
            <li>משימות שלכם, ומשימות להיום שעוד אף אחד לא לקח.</li>
          </ul>
          <p>שורה עם נקודה כהה ובכתב מודגש היא דחופה, ולכן היא תמיד למעלה.</p>
          <Tip>כשהכול מטופל כתוב &quot;אין כרגע משהו שמחכה לך&quot;. אם כתוב &quot;לא הצלחנו לבדוק עכשיו&quot;, זה לא אומר שאין כלום: כדאי להציץ במסך עצמו.</Tip>
        </Section>

        <Section id="scan" icon={ScanLine} title="סריקה">
          <p>כפתור אחד לכל קוד בחנות:</p>
          <ul>
            <li><B>מדבקה של פריט</B>: נפתח כרטיס הפריט, עם המחיר, המיקום והמצב שלו.</li>
            <li><B>שובר מתנה</B> (הריבוע השחור או הקוד שמתחיל ב-JAS): נפתח מסך הפדיון של מערכת השוברים, עם השובר כבר מוכן. סכום הפדיון ואישורו נשארים בידיים שלכם.</li>
          </ul>
          <ol>
            <li>לוחצים <B>סריקה</B> ואז <B>פתיחת המצלמה</B>.</li>
            <li>בפעם הראשונה הטלפון שואל אם לאפשר מצלמה. עונים כן.</li>
            <li>מכוונים אל הקוד. המסך הנכון נפתח לבד.</li>
          </ol>
          <Tip>באייפון המצלמה קוראת את הריבוע (QR) בלבד. את הפס של הברקוד אפשר להקליד בשדה שמתחת, או לסרוק עם סורק שמחובר למחשב. למערכת השוברים צריך להיות מחוברים עם המשתמש שלכם שם.</Tip>
        </Section>

        <Section id="ask" icon={MessageCircleQuestion} title="לשאול">
          <p>שואלים שאלה רגילה, בעברית, והתשובה מגיעה מהמערכות עצמן. למשל:</p>
          <ul>
            <li>&quot;יש לנו במלאי כיסא עץ?&quot;</li>
            <li>&quot;אילו משלוחים יוצאים היום?&quot;</li>
            <li>&quot;אילו משימות פתוחות יש בחנות?&quot;</li>
          </ul>
          <p className="flex items-start gap-2">
            <Mic aria-hidden className="mt-1 size-5 shrink-0 text-forest" />
            <span>
              אפשר גם לדבר: לוחצים על <B>המיקרופון</B>, אומרים את השאלה, ולוחצים שוב כדי לעצור. המילים מופיעות בתיבה, ואפשר לתקן לפני השליחה.
            </span>
          </p>
          <Tip>כאן רק שואלים. שינויים (מכירה, שמירה, עדכון) עושים במסכים עצמם. התשובות מבוססות רק על מה שמותר לכם לראות.</Tip>
        </Section>

        <Section id="buttons" icon={Star} title="כפתורים וקטגוריות">
          <p>בטלפון, לוחצים על קטגוריה ורואים את הכפתורים שלה. במחשב הכפתורים הנפוצים מופיעים כבר על הכרטיס.</p>
          <p>ליד חלק מהכפתורים יש תווית שאומרת למי הם מיועדים:</p>
          <ul>
            <li className="flex flex-wrap items-center gap-2"><AudienceTag audience="customer" /> קישור ציבורי. מותר לשלוח אותו ללקוחות, למתנדבים ולכל מי שמחוץ לצוות.</li>
            <li className="flex flex-wrap items-center gap-2"><AudienceTag audience="manager" /> מסך ניהול.</li>
            <li>כפתור בלי תווית הוא לעבודה הרגילה של הצוות.</li>
          </ul>
          <p>כפתור שנפתח בחלון חדש מסומן כך. הפורטל נשאר פתוח בחלון הקודם, כדי שיהיה קל לחזור.</p>
          <p className="flex items-start gap-2">
            <Star aria-hidden className="mt-1 size-5 shrink-0 text-forest" />
            <span>
              <B>השימושים שלך</B> מתעדכנים לבד: כפתור שפתחתם לפחות פעמיים מופיע למעלה. אף אחד אחר לא רואה את הרשימה שלכם.
            </span>
          </p>
        </Section>

        <Section id="share" icon={Share2} title="שיתוף קישורים">
          <p>ליד כל כפתור יש שני כפתורים קטנים:</p>
          <ul>
            <li className="flex items-start gap-2"><Copy aria-hidden className="mt-1 size-5 shrink-0 text-forest" /><span><B>העתקה</B>: מעתיק את הקישור, ואפשר להדביק אותו בוואטסאפ, במייל או בכל מקום.</span></li>
            <li className="flex items-start gap-2"><Share2 aria-hidden className="mt-1 size-5 shrink-0 text-forest" /><span><B>שיתוף</B>: פותח את חלון השיתוף של הטלפון, ושולחים ישר לאדם או לקבוצה.</span></li>
          </ul>
          <p>מה קורה למי שמקבל את הקישור:</p>
          <ul>
            <li><B>קישור של הצוות</B>: מי שמקבל אותו מתבקש להיכנס עם המשתמש שלו, ומגיע ישר למסך. מי שאין לו הרשאה למסך הזה לא יראה אותו, גם אם קיבל את הקישור.</li>
            <li><AudienceTag audience="customer" /> <B>קישור ציבורי</B>: נפתח לכל אחד, בלי כניסה. רק את אלה שולחים החוצה.</li>
          </ul>
          <p>כדי לשלוח למישהו מהצוות את הכתובת של הפורטל עצמו, משתמשים בכפתור <B>שליחת קישור לפורטל</B> (הוא נמצא גם במסך הראשי). כדי להיכנס צריך משתמש: עובד חדש מקבל משתמש ממנהלת הפורטל, במסך צוות והרשאות.</p>
          <div>
            <SharePortalButton />
          </div>
          <p>
            <B>לשלוח את המדריך</B>: יש ממנו גרסה שנפתחת לכל אחד, בלי כניסה, גם מוואטסאפ. אפשר לשלוח אותה לעובד חדש עוד לפני שיש לו משתמש:
          </p>
          <div>
            <ShareButtons url="/portal-guide.html" title="מדריך לפורטל הצוות של Just A Second" />
          </div>
        </Section>

        <Section id="install" icon={Smartphone} title="הפורטל כאפליקציה בטלפון">
          <p>כדי לפתוח את הפורטל בלחיצה אחת, כמו אפליקציה:</p>
          <p><B>באייפון (Safari)</B></p>
          <ol>
            <li>פותחים את הפורטל ב-Safari.</li>
            <li>לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה).</li>
            <li>בוחרים <B>הוספה למסך הבית</B>, ואז <B>הוספה</B>.</li>
          </ol>
          <p><B>באנדרואיד (Chrome)</B></p>
          <ol>
            <li>פותחים את הפורטל ב-Chrome.</li>
            <li>לוחצים על שלוש הנקודות למעלה.</li>
            <li>בוחרים <B>התקנת אפליקציה</B> או <B>הוספה למסך הבית</B>.</li>
          </ol>
          <Tip>אחרי ההתקנה מופיע אייקון JAS במסך הבית של הטלפון. פותחים אותו משם בלחיצה אחת.</Tip>
        </Section>

        <Section id="faceid" icon={ScanFace} title="כניסה עם Face ID">
          <p>אפשר להיכנס בלי להקליד סיסמה: מסתכלים בטלפון (או נוגעים בטביעת האצבע) ונכנסים.</p>
          <ol>
            <li>נכנסים פעם אחת כרגיל, עם המייל והסיסמה.</li>
            <li>פותחים את <Link href="/portal/face-id" className="font-bold text-forest underline underline-offset-4">כניסה עם Face ID</Link> (או לוחצים על ההצעה שמופיעה במסך הראשי).</li>
            <li>לוחצים על <B>הפעלת Face ID במכשיר הזה</B> ומאשרים בטלפון.</li>
          </ol>
          <p>מעכשיו, במסך הכניסה לוחצים על <B>כניסה עם Face ID</B>.</p>
          <Tip>מפעילים בכל מכשיר בנפרד: בטלפון, ואם רוצים גם במחשב. טלפון שאבד או הוחלף? מסירים אותו מאותו מסך.</Tip>
        </Section>

        {manager ? (
          <Section id="manage" icon={Eye} title="למנהלת הפורטל">
            <p>שתי דרכים לשנות את הפורטל, שתיהן בקטגוריה <B>ניהול</B>:</p>
            <p className="flex items-start gap-2">
              <MessagesSquare aria-hidden className="mt-1 size-5 shrink-0 text-forest" />
              <span>
                <B>שינוי בפורטל בשיחה</B>: כותבים, מקליטים או שולחים צילום מסך, ואומרים מה לשנות. Claude מציע כל שינוי בכרטיס של &quot;עכשיו&quot; ו&quot;אחרי&quot;, ושום דבר לא משתנה עד שלוחצים <B>אישור ופרסום</B>. שינויים בכפתורים ובקטגוריות עולים מיד. שינוי בעיצוב או פיצ׳ר חדש נשלחים לפיתוח, ועולים רק אחרי שמישהו בודק ומאשר.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <LayoutGrid aria-hidden className="mt-1 size-5 shrink-0 text-forest" />
              <span>
                <B>ניהול קישורים</B>: הוספה, עריכה, סדר, הפעלה וכיבוי של כל כפתור, ובחירה מי רואה אותו. כדי למחוק כפתור קודם מכבים אותו.
              </span>
            </p>
            <ul>
              <li><B>תצוגה מקדימה</B>: במסך ניהול הקישורים אפשר לראות את הפורטל כמו שעובד בתפקיד מסוים רואה אותו.</li>
              <li><B>יומן השינויים</B>: בתחתית מסך ניהול הקישורים. כל שינוי, מי עשה אותו ומתי.</li>
            </ul>
          </Section>
        ) : null}

        <Section id="help" icon={HelpCircle} title="כשמשהו לא עובד">
          <ul>
            <li><B>חסר לי כפתור</B>: כל אחד רואה רק את מה שמתאים לתפקיד שלו. פנו למנהלת הפורטל.</li>
            <li><B>הקישור ששלחו לי מבקש סיסמה</B>: זה קישור של הצוות. נכנסים עם המשתמש שלכם.</li>
            <li><B>המצלמה לא נפתחת</B>: צריך לאשר לדפדפן גישה למצלמה (בהגדרות הטלפון, תחת הדפדפן). בינתיים אפשר להקליד את הקוד.</li>
            <li><B>המיקרופון לא מופיע</B>: הקלטה עובדת ב-Chrome, Edge ו-Safari. בדפדפן אחר פשוט כותבים.</li>
            <li><B>כתוב &quot;לא הצלחנו לבדוק עכשיו&quot;</B>: מערכת אחת לא ענתה. נסו שוב בעוד רגע, או פתחו את המסך עצמו.</li>
          </ul>
          <p className="flex items-start gap-2">
            <Search aria-hidden className="mt-1 size-5 shrink-0 text-forest" />
            <span>לא מוצאים משהו? כותבים אותו בחיפוש במסך הראשי.</span>
          </p>
        </Section>
      </div>

      <p className="mt-8 text-center">
        <Link href="/portal" className="inline-flex h-12 items-center rounded-full bg-forest px-6 text-base font-bold text-cream hover:bg-forest/90">
          חזרה לפורטל
        </Link>
      </p>
    </div>
  )
}
