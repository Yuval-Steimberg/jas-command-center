'use server'

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getSession, requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { allowAttempt } from '@/lib/auth/rate-limit'
import { audit } from '@/lib/audit/audit'
import { env } from '@/lib/env'
import { israelDate } from '@/lib/time'
import { ask, historySchema, type AskResult } from '@/lib/assistant/run'

const input = z.object({ question: z.string().trim().min(1, 'Ask a question.').max(2000, 'Keep the question under 2,000 characters.'), history: historySchema })

/** 20 questions per 10 minutes per person: a runaway tab cannot burn the API budget. */
const LIMIT = 20
const WINDOW_MS = 10 * 60_000

export async function askAction(raw: { question: string; history: unknown }): Promise<AskResult> {
  let user
  try {
    user = await requirePermission('assistant:use')
  } catch {
    return { ok: false, message: 'You do not have access to the assistant.' }
  }
  const session = await getSession()
  if (!session) return { ok: false, message: 'Your session expired. Sign in again.' }

  const { apiKey, model } = env().assistant
  if (!apiKey) return { ok: false, message: 'The assistant is not configured: ANTHROPIC_API_KEY is not set on this deployment.' }

  const parsed = input.safeParse(raw)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid question.' }
  if (!allowAttempt(`assistant:${user.id}`, Date.now(), LIMIT, WINDOW_MS)) return { ok: false, message: 'Too many questions in a short time. Wait a few minutes and try again.' }

  const client = new Anthropic({ apiKey, timeout: 40_000, maxRetries: 1 })
  try {
    return await ask(parsed.data.question, parsed.data.history, {
      create: (params) => client.beta.messages.create(params),
      model,
      today: israelDate(),
      ctx: { can: (p) => can(session.user.role, p, session.overrides) },
      audit: (entry) => audit(user, { ...entry, via: 'assistant' }),
    })
  } catch (e) {
    // Reached only when an audit write fails: an unaudited answer is not returned.
    console.error('assistant failed', e instanceof Error ? e.message : e)
    return { ok: false, message: 'The assistant could not record this request in the audit log, so it stopped.' }
  }
}
