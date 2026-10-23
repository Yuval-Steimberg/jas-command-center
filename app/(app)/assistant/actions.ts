'use server'

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getSession, requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { allowAttempt } from '@/lib/auth/rate-limit'
import { audit } from '@/lib/audit/audit'
import { env } from '@/lib/env'
import { PRODUCT_HREF } from '@/lib/products'
import { israelDate } from '@/lib/time'
import { ask, historySchema, type AskResult } from '@/lib/assistant/run'
import { EXEC_PARAMS, proposalDef } from '@/lib/assistant/proposals'
import { revalidatePath } from 'next/cache'

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

const PATHS: Record<string, string> = PRODUCT_HREF

/**
 * Runs an action the assistant proposed — only from the person's own click on
 * the confirmation card. The proposal came back from the browser, so it is
 * untrusted: the kind must exist, every permission is re-checked for THIS
 * user, and the parameters are re-validated. Audited requested → outcome,
 * via = assistant, under the same product as the page action.
 */
export async function confirmProposalAction(raw: { kind: unknown; params: unknown }): Promise<{ ok: boolean; message: string }> {
  const def = typeof raw?.kind === 'string' ? proposalDef(raw.kind) : undefined
  if (!def) return { ok: false, message: 'Unknown action.' }
  let user
  try {
    user = await requirePermission('assistant:use')
  } catch {
    return { ok: false, message: 'You do not have access to the assistant.' }
  }
  const session = await getSession()
  if (!session) return { ok: false, message: 'Your session expired. Sign in again.' }
  if (!def.permissions.every((p) => can(session.user.role, p, session.overrides))) return { ok: false, message: 'Your role cannot do this.' }
  const params = EXEC_PARAMS[def.kind]!.safeParse(raw.params)
  if (!params.success) return { ok: false, message: 'This proposal is no longer valid. Ask again.' }

  const action = `${def.product}.${def.kind}`
  const target = def.kind
  try {
    await audit(user, { action, product: def.product, target, outcome: 'requested', detail: { params: params.data }, via: 'assistant' })
  } catch {
    return { ok: false, message: 'Could not record the action in the audit log, so it was not run.' }
  }
  try {
    const res = await def.execute(params.data, { email: user.email, role: user.role })
    await audit(user, { action, product: def.product, target, outcome: res.ok ? 'succeeded' : 'failed', detail: { params: params.data, message: res.message, ...res.detail }, via: 'assistant' })
    revalidatePath(PATHS[def.product] ?? '/')
    return res
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await audit(user, { action, product: def.product, target, outcome: 'failed', detail: { params: params.data, error: message }, via: 'assistant' }).catch(() => {})
    return { ok: false, message: `Failed: ${message}` }
  }
}
