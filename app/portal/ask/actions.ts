'use server'

import { anthropicClient, aiErrorCode } from '@/lib/anthropic'
import { z } from 'zod'
import { getSession, requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { allowAttempt } from '@/lib/auth/rate-limit'
import { audit } from '@/lib/audit/audit'
import { env } from '@/lib/env'
import { israelDate } from '@/lib/time'
import { ask, historySchema } from '@/lib/assistant/run'

const input = z.object({ question: z.string().trim().min(1).max(2000), history: historySchema })

const AI_ERROR: Record<ReturnType<typeof aiErrorCode>, string> = {
  workspace: 'החיבור ל-Claude דורש הגדרה נוספת (ANTHROPIC_WORKSPACE_ID).',
  key: 'מפתח החיבור ל-Claude לא תקין.',
  rate: 'Claude עמוס כרגע. נסו שוב בעוד רגע.',
  timeout: 'לקח יותר מדי זמן. נסו לשאול שאלה קצרה יותר.',
  unreachable: 'אין חיבור ל-Claude כרגע. נסו שוב.',
  service: 'משהו השתבש. נסו שוב.',
}

export type PortalAskResult = { ok: true; answer: string } | { ok: false; message: string }

/**
 * "לשאול" on the portal: the console's assistant (same loop, same tools for
 * the person's role, same audit rows), asked in Hebrew and for questions
 * only. No confirmation cards here: an action is done on its own screen.
 */
export async function portalAskAct(raw: { question: string; history: unknown }): Promise<PortalAskResult> {
  let user
  try {
    user = await requirePermission('assistant:use')
  } catch {
    return { ok: false, message: 'אין לך גישה לשאלות.' }
  }
  const session = await getSession()
  if (!session) return { ok: false, message: 'צריך להתחבר מחדש.' }
  const { apiKey, workspaceId, model } = env().assistant
  if (!apiKey) return { ok: false, message: 'החיבור ל-Claude עוד לא הוגדר.' }
  const parsed = input.safeParse(raw)
  if (!parsed.success) return { ok: false, message: 'מה רוצים לדעת? כתבו או הקליטו שאלה.' }
  if (!allowAttempt(`assistant:${user.id}`, Date.now(), 20, 10 * 60_000)) return { ok: false, message: 'יותר מדי שאלות בזמן קצר. נסו שוב בעוד כמה דקות.' }

  const client = anthropicClient({ apiKey, workspaceId, timeout: 40_000 })
  try {
    const res = await ask(parsed.data.question, parsed.data.history, {
      create: (params) => client.beta.messages.create(params),
      model,
      today: israelDate(),
      readOnly: true,
      ctx: { can: (p) => can(session.user.role, p, session.overrides) },
      audit: (entry) => audit(user, { ...entry, via: 'assistant' }),
    })
    if (res.ok) return { ok: true, answer: res.answer }
    // The loop's own messages are English (the console's); the cause is kept, in Hebrew.
    const m = res.message
    if (/workspace/i.test(m)) return { ok: false, message: AI_ERROR.workspace }
    if (/API key/i.test(m)) return { ok: false, message: AI_ERROR.key }
    if (/rate-limited|spend limit/i.test(m)) return { ok: false, message: AI_ERROR.rate }
    if (/too long/i.test(m)) return { ok: false, message: AI_ERROR.timeout }
    if (/Could not reach/i.test(m)) return { ok: false, message: AI_ERROR.unreachable }
    return { ok: false, message: 'לא הצלחנו לענות על זה. נסו לנסח אחרת, או לשאול על דבר אחד בכל פעם.' }
  } catch (e) {
    // The loop throws only when an audit write fails, or before it starts on a client error.
    const code = aiErrorCode(e)
    return { ok: false, message: code === 'service' ? 'לא הצלחנו לרשום את השאלה ביומן, ולכן לא נענתה. נסו שוב.' : AI_ERROR[code] }
  }
}
