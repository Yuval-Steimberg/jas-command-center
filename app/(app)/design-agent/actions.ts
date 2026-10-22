'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { retryDeadJob } from '@/lib/integrations/design-agent/adapter'

export type RetryState = { ok?: boolean; message?: string }

/**
 * Re-queue a dead design-agent job via the bot's own admin endpoint.
 * The result shown is what the bot confirmed — never an optimistic "done".
 */
export async function retryJobAction(_prev: RetryState, form: FormData): Promise<RetryState> {
  let user
  try {
    user = await requirePermission('design_agent:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to retry jobs.' }
  }
  const parsed = z.coerce.number().int().positive().safeParse(form.get('jobId'))
  if (!parsed.success) return { ok: false, message: 'Invalid job id.' }
  const jobId = parsed.data
  const target = `job:${jobId}`
  await audit(user, { action: 'design_agent.job.retry', product: 'design_agent', target, outcome: 'requested', detail: {} })
  try {
    const { retried } = await retryDeadJob(jobId)
    await audit(user, { action: 'design_agent.job.retry', product: 'design_agent', target, outcome: retried ? 'succeeded' : 'failed', detail: { retried } })
    revalidatePath('/design-agent')
    return retried
      ? { ok: true, message: `Job ${jobId} is queued again. The design agent will pick it up.` }
      : { ok: false, message: `Job ${jobId} is no longer dead (already retried or gone). Nothing changed.` }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await audit(user, { action: 'design_agent.job.retry', product: 'design_agent', target, outcome: 'failed', detail: { error: message } })
    return { ok: false, message: `Retry failed: ${message}` }
  }
}
