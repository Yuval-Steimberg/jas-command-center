import 'server-only'
import { revalidatePath } from 'next/cache'
import { audit } from '@/lib/audit/audit'
import { currentScheduler } from '@/lib/schedule/store'
import type { ScheduleStore } from '@/lib/volunteers/schedule-store'
import { scheduleErrorHe } from '@/lib/volunteers/schedule-messages'

export type ActResult = { ok: boolean; message: string }

/**
 * Every schedule change from the screens. The DATABASE decides whether this
 * person may make it (0011: auth.uid() must be the location's admin); this
 * wrapper only signs it, audits requested → outcome, and refreshes the screens.
 */
export async function act(action: string, target: string, detail: Record<string, unknown>, done: string, run: (store: ScheduleStore, who: string) => Promise<unknown>, via: 'user' | 'assistant' = 'user'): Promise<ActResult> {
  const s = await currentScheduler()
  if ('error' in s) return { ok: false, message: s.error === 'signed_out' ? 'פג תוקף ההתחברות. נא להתחבר מחדש.' : 'אין לך הרשאת שיבוץ.' }
  if (!s.canEdit) return { ok: false, message: 'יש לך הרשאת צפייה בלבד בלוח הזה.' }
  const entry = { action: `volunteers.schedule.${action}`, product: 'volunteers', target, via }
  try {
    await audit(s.user, { ...entry, outcome: 'requested', detail })
  } catch {
    return { ok: false, message: 'לא ניתן היה לרשום את הפעולה ביומן, ולכן היא לא בוצעה.' }
  }
  try {
    await run(s.store, s.user.email)
  } catch (e) {
    const forbidden = Boolean(e && typeof e === 'object' && 'forbidden' in e)
    await audit(s.user, { ...entry, outcome: forbidden ? 'denied' : 'failed', detail: { ...detail, error: e instanceof Error ? e.message : String(e) } }).catch(() => undefined)
    return { ok: false, message: scheduleErrorHe(e) }
  }
  await audit(s.user, { ...entry, outcome: 'succeeded', detail }).catch((e) => console.error('schedule audit (outcome) failed', e))
  revalidatePath('/schedule', 'layout')
  return { ok: true, message: done }
}

