
/**
 * The database explains refusals in English (staff read them in the Command
 * Center). Volunteers get the same reason in Hebrew. Unknown errors are never
 * shown raw: they are logged and a plain apology is returned.
 */
const RULES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/overlaps another shift you joined \((.*)\)/, (m) => `המשמרת חופפת למשמרת אחרת שנרשמת אליה (${m[1]}). אפשר לבטל אחת מהן ולנסות שוב.`],
  [/sign-up for this shift has closed/, 'ההרשמה למשמרת הזאת כבר נסגרה.'],
  [/already started/, 'המשמרת כבר התחילה.'],
  [/shift was cancelled|activity is cancelled/, 'הפעילות בוטלה.'],
  [/activity is (draft|completed)/, 'הפעילות לא פתוחה להרשמה.'],
  [/aged 18 and over/, 'הפעילות הזאת מגיל 18 ומעלה.'],
  [/volunteer account is (paused|blocked)/, 'החשבון שלך מושהה כרגע. לשאלות אפשר לפנות לצוות.'],
  [/shift has started; please call/, 'המשמרת כבר התחילה, ולכן אי אפשר לבטל דרך האפליקציה. נא להתקשר לרכז/ת.'],
  [/attendance is already recorded/, 'כבר נרשמה נוכחות למשמרת הזאת.'],
  [/only an invitation can be declined/, 'אפשר לדחות רק הזמנה.'],
  [/check-in code is not valid/, 'הקוד לא תקין. נא לסרוק שוב את הקוד של המשמרת.'],
  [/walk-in can be added only on the day/, 'אפשר להצטרף במקום רק ביום המשמרת עצמה.'],
  [/check-in is open from/, 'אפשר להירשם בקוד משעה לפני המשמרת ועד שעתיים אחריה.'],
  [/not confirmed for this shift/, 'לא מצאנו הרשמה מאושרת שלך למשמרת הזאת. הרכז/ת יכול/ה לרשום אותך.'],
  [/phone number is already registered/, 'מספר הטלפון הזה כבר רשום עם כתובת אימייל אחרת. אפשר להיכנס עם הכתובת ההיא.'],
  [/email is already registered/, 'כתובת האימייל הזאת כבר רשומה. אפשר פשוט להיכנס.'],
  [/account was deleted/, 'החשבון הזה נמחק.'],
  [/not found/, 'לא מצאנו את מה שחיפשת. ייתכן שהוא עודכן בינתיים.'],
  [/shift is not open/, 'המשמרת לא פתוחה כרגע.'],
]

/**
 * Duck-typed on purpose: Next bundles pages and server actions separately, and
 * the store is kept on globalThis, so an error thrown by a store created in one
 * bundle is not an `instanceof` the other bundle's ConflictError class.
 */
const isConflict = (e: unknown): e is Error => e instanceof Error && (e as { conflict?: unknown }).conflict === true

export function heMessage(e: unknown): string {
  if (isConflict(e)) {
    for (const [re, he] of RULES) {
      const m = e.message.match(re)
      if (m) return typeof he === 'string' ? he : he(m)
    }
    return 'הפעולה לא בוצעה כי משהו השתנה בינתיים. נא לרענן ולנסות שוב.'
  }
  console.error('volunteer app error:', e instanceof Error ? e.message : e)
  return 'משהו השתבש אצלנו. נא לנסות שוב בעוד רגע.'
}
