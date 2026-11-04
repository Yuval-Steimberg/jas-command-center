'use server'

import { z } from 'zod'
import { anthropicClient } from '@/lib/anthropic'
import { allowAttempt } from '@/lib/auth/rate-limit'
import { audit } from '@/lib/audit/audit'
import { env } from '@/lib/env'
import { israelDate } from '@/lib/time'
import { currentScheduler } from '@/lib/schedule/store'
import { act, type ActResult } from '@/lib/schedule/act'
import { askSchedule, EXEC_PARAMS, executeProposal, historySchema, isProposalKind, type ScheduleAskResult } from '@/lib/schedule/assistant'

const input = z.object({ question: z.string().trim().min(1, 'נא לכתוב שאלה.').max(2000, 'השאלה ארוכה מדי.'), history: historySchema })

/** 20 questions per 10 minutes per person: a runaway tab cannot burn the API budget. */
const LIMIT = 20
const WINDOW_MS = 10 * 60_000

export async function askScheduleAction(raw: { question: string; history: unknown }): Promise<ScheduleAskResult> {
  const s = await currentScheduler()
  if ('error' in s) return { ok: false, message: 'אין לך הרשאת שיבוץ.' }
  const { apiKey, workspaceId, model } = env().assistant
  if (!apiKey) return { ok: false, message: 'העוזר לא מוגדר: חסר ANTHROPIC_API_KEY בשרת.' }
  const parsed = input.safeParse(raw)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'שאלה לא תקינה.' }
  if (!allowAttempt(`schedule-assistant:${s.user.id}`, Date.now(), LIMIT, WINDOW_MS)) return { ok: false, message: 'יותר מדי שאלות בזמן קצר. אפשר לנסות שוב בעוד כמה דקות.' }
  const client = anthropicClient({ apiKey, workspaceId, timeout: 40_000 })
  try {
    return await askSchedule(parsed.data.question, parsed.data.history, {
      create: (params) => client.beta.messages.create(params),
      model,
      store: s.store,
      locationId: s.location.id,
      today: israelDate(),
      audit: (entry) => audit(s.user, { ...entry, product: 'volunteers', via: 'assistant' }),
    })
  } catch (e) {
    // An audit write that fails stops the answer: nothing unaudited is returned.
    console.error('schedule assistant failed', e instanceof Error ? e.message : e)
    return { ok: false, message: 'העוזר לא הצליח לרשום את הבקשה ביומן, ולכן עצר.' }
  }
}

const DONE: Record<string, string> = {
  replace: 'בוצע: ההחלפה נרשמה.',
  assign: 'בוצע: שובץ/ה.',
  absence: 'בוצע: נרשם שלא יגיע/תגיע.',
  cancel_assignment: 'בוצע: השיבוץ בוטל.',
  withdraw_absence: 'בוצע: ההיעדרות בוטלה.',
  set_required: 'בוצע: היעד נשמר.',
}

/**
 * Runs a change the assistant proposed — only from the person's own Confirm.
 * The proposal came back from the browser, so the kind and every parameter
 * are re-validated, and the change goes through the same database functions
 * as the buttons (which check, again, that this person schedules this place).
 */
export async function confirmScheduleProposalAction(raw: { kind: unknown; params: unknown }): Promise<ActResult> {
  if (!isProposalKind(raw?.kind)) return { ok: false, message: 'פעולה לא מוכרת.' }
  const kind = raw.kind
  const p = EXEC_PARAMS[kind].safeParse(raw.params)
  if (!p.success) return { ok: false, message: 'ההצעה כבר לא תקפה. נא לשאול שוב.' }
  return act(kind, `assistant:${kind}`, p.data, DONE[kind]!, (store) => executeProposal(kind, p.data, store), 'assistant')
}
