import 'server-only'
import { revalidatePath } from 'next/cache'
import { requirePermission, userCan, type CurrentUser } from '@/lib/auth/session'
import type { Permission } from '@/lib/auth/rbac'
import { audit } from '@/lib/audit/audit'
import { OpsSetupError } from './store'

export type ActionState = { ok?: boolean; message?: string; warning?: string }
export type ActResult = { ok: boolean; message: string; warning?: string }

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Every write on the operational pages (inventory, customers, sales,
 * deliveries, tasks): check every permission here (never by hiding a button),
 * audit `requested`, run, audit the confirmed outcome, refresh the pages that
 * show the record. A failed audit write aborts before anything changes.
 */
export async function runAct(
  product: 'inventory' | 'crm' | 'website' | 'volunteers',
  perms: Permission[],
  action: string,
  target: string,
  detail: Record<string, unknown>,
  run: (u: CurrentUser) => Promise<ActResult>,
  paths: string[],
): Promise<ActionState> {
  let user: CurrentUser
  try {
    user = await requirePermission(perms[0]!)
    for (const p of perms.slice(1)) if (!(await userCan(p))) throw new Error(p)
  } catch {
    return { ok: false, message: `Your role cannot do this (needs ${perms.join(' + ')}).` }
  }
  await audit(user, { action, product, target, outcome: 'requested', detail })
  try {
    const r = await run(user)
    await audit(user, { action, product, target, outcome: r.ok ? 'succeeded' : 'failed', detail: { ...detail, message: r.message, ...(r.warning ? { warning: r.warning } : {}) } })
    for (const p of paths) revalidatePath(p)
    return { ok: r.ok, message: r.message, warning: r.warning }
  } catch (e) {
    await audit(user, { action, product, target, outcome: 'failed', detail: { ...detail, error: errText(e) } })
    return { ok: false, message: e instanceof OpsSetupError ? e.message : `Not changed: ${errText(e)}` }
  }
}

export const formStr = (f: FormData, k: string, max = 2000) => {
  const v = String(f.get(k) ?? '').trim()
  return v ? v.slice(0, max) : null
}

/** "1,250.50" / "1250" → agorot; null for empty; NaN for anything else. */
export function formShekels(f: FormData, k: string): number | null {
  const raw = String(f.get(k) ?? '').replace(/[₪,\s]/g, '')
  if (!raw) return null
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return NaN
  const n = Math.round(Number(raw) * 100)
  return n > 0 && n <= 100_000_000 ? n : NaN
}

/** A <input type="date"> value → end of that day in Israel (approximated as 18:00 UTC), or null. */
export function formDate(f: FormData, k: string): string | null | 'invalid' {
  const raw = String(f.get(k) ?? '').trim()
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) return 'invalid'
  return `${raw}T18:00:00.000Z`
}
