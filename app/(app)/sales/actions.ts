'use server'

import { runAct, type ActionState } from '@/lib/ops/act'
import { runOpsSync } from '@/lib/sync/run'

/** Run the website → command center sync now instead of waiting for the hourly sweep. Idempotent. */
export async function syncNowAction(_p: ActionState, _f: FormData): Promise<ActionState> {
  return runAct('inventory', ['inventory:operate'], 'ops.sync', 'sync:now', {}, async () => {
    const r = await runOpsSync()
    if (r.state === 'not_set_up') return { ok: false, message: r.message ?? 'Not set up.' }
    const bad = r.steps.filter((s) => s.state === 'error')
    return { ok: bad.length === 0, message: r.steps.map((s) => s.message).join(' '), warning: bad.length ? `${bad.length} step(s) failed; see below.` : undefined }
  }, ['/sales', '/inventory', '/crm', '/tasks', '/'])
}
