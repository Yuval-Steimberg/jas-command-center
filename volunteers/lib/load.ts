import 'server-only'
import { getStore, NotConfiguredError } from './store'

/** Page reads: the data, or the reason it cannot be shown (never an empty list in its place). */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    getStore()
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof NotConfiguredError) return { ok: false, message: 'האפליקציה עדיין לא מחוברת למאגר הנתונים. נא לנסות שוב מאוחר יותר.' }
    const setup = e instanceof Error && /0005_volunteers/.test(e.message)
    console.error('volunteer page read failed:', e instanceof Error ? e.message : e)
    return { ok: false, message: setup ? 'מערכת המתנדבים עוד לא הופעלה. נא לנסות שוב מאוחר יותר.' : 'לא הצלחנו לטעון את המידע כרגע. נא לרענן בעוד רגע.' }
  }
}
