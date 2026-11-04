/**
 * Hebrew for the refusals the scheduling functions (0011) and the memory store
 * give. The database speaks English (`cc_conflict: …`); people read Hebrew.
 * Shared by the Command Center's schedule mode and the volunteer app.
 */
const RULES: [RegExp, string][] = [
  [/already a regular on this day/, 'כבר קבוע/ה ביום הזה.'],
  [/already a regular (at|elsewhere)/, 'כבר קבוע/ה במקום אחר באותו יום בשבוע.'],
  [/already comes that day as a regular/, 'כבר מגיע/ה ביום הזה כקבוע/ה.'],
  [/take the absence back/, 'דיווח/ה שלא יגיע/תגיע ביום הזה. אפשר לבטל את ההיעדרות במקום לשבץ.'],
  [/account is not active/, 'החשבון של המתנדב/ת לא פעיל.'],
  [/that day has passed/, 'היום הזה כבר עבר.'],
  [/closed/, 'הסדנה סגורה ביום הזה.'],
  [/not scheduled on that day/, 'לא משובץ/ת ביום הזה.'],
  [/person being replaced is not scheduled/, 'מי שמוחלף/ת לא משובץ/ת ביום הזה.'],
  [/cannot replace themselves/, 'אי אפשר להחליף מישהו בעצמו.'],
  [/changed this day in the meantime/, 'מישהו שינה את היום הזה בינתיים. נא לרענן ולנסות שוב.'],
  [/already scheduled at/, 'כבר משובץ/ת במקום אחר באותה שעה.'],
  [/is not a (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|day of this schedule)/, 'התאריך לא נופל על יום הפעילות.'],
  [/today or later/, 'שיבוץ קבוע מתחיל היום או אחר כך.'],
  [/yesterday at the earliest/, 'אפשר לסיים החל מאתמול. שבועות שעברו נשמרים כפי שהיו.'],
  [/not part of the schedule/, 'היום הזה כבר לא חלק מהלוח.'],
  [/required number/, 'מספר נדרש: בין 0 ל-200.'],
  [/end after it starts/, 'שעת הסיום חייבת להיות אחרי שעת ההתחלה.'],
  [/was cancelled/, 'השיבוץ הזה בוטל.'],
  [/not found/, 'לא נמצא. ייתכן שזה השתנה בינתיים; נא לרענן.'],
]

export function scheduleErrorHe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (e && typeof e === 'object' && 'forbidden' in e) return 'אין לך הרשאה לשנות את הלוח של המקום הזה.'
  if (/0011_volunteer_schedule/.test(msg)) return 'טבלאות השיבוץ עוד לא הותקנו. יש להריץ את migration 0011 במסד הנתונים.'
  for (const [re, he] of RULES) if (re.test(msg)) return he
  return `הפעולה לא בוצעה: ${msg}`
}
