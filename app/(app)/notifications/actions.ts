'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSession, requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { authMode } from '@/lib/auth/mode'
import { audit } from '@/lib/audit/audit'
import { notificationStore } from '@/lib/notifications/store'
import { prefsSchema } from '@/lib/notifications/prefs'
import { listStaff } from '@/lib/staff/store'

/**
 * Mark notifications read for the signed-in user only. This is the person's
 * own inbox state, not a change to any business system, so it is not audited
 * (the audit log records actions on sources and on access).
 */
export async function markReadAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const ids = z.array(z.string().uuid()).max(200).safeParse(form.getAll('id'))
  if (!ids.success || !ids.data.length) return
  await notificationStore().markRead(user.id, ids.data, new Date().toISOString())
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
}

export type AssignState = { ok?: boolean; message?: string }

/**
 * Give an open alert to one person. Unlike "read", this changes what the whole
 * team sees, so it needs operate rights on that product and is audited.
 */
export async function assignAction(_prev: AssignState, form: FormData): Promise<AssignState> {
  const user = await requireUser()
  const s = (await getSession())!
  const id = z.string().uuid().safeParse(form.get('id'))
  const raw = String(form.get('to') ?? '')
  const to = raw ? z.string().uuid().safeParse(raw) : ({ success: true, data: null } as const)
  if (!id.success || !to.success) return { ok: false, message: 'Pick a person.' }
  const store = notificationStore()
  const n = (await store.listOpen()).find((x) => x.id === id.data)
  if (!n) return { ok: false, message: 'That alert has already closed.' }
  if (!can(s.user.role, `${n.product}:operate`, s.overrides)) return { ok: false, message: 'Your role cannot assign alerts for this product.' }
  if (to.data && authMode().kind === 'supabase') {
    const staff = await listStaff()
    if (!staff.some((p) => p.id === to.data && p.active)) return { ok: false, message: 'That person is not active staff.' }
  }
  const detail = { alert: n.alertKey, from: n.assignedTo, to: to.data }
  await audit(user, { action: 'notification.assign', product: n.product, target: `notification:${n.id}`, outcome: 'requested', detail })
  try {
    const ok = await store.assign(n.id, to.data)
    await audit(user, { action: 'notification.assign', product: n.product, target: `notification:${n.id}`, outcome: ok ? 'succeeded' : 'failed', detail })
    revalidatePath('/notifications')
    return ok ? { ok: true, message: to.data ? 'Assigned.' : 'Unassigned.' } : { ok: false, message: 'That alert has already closed.' }
  } catch (e) {
    await audit(user, { action: 'notification.assign', product: n.product, target: `notification:${n.id}`, outcome: 'failed', detail: { ...detail, error: e instanceof Error ? e.message : String(e) } })
    return { ok: false, message: 'Not assigned.' }
  }
}

export type PrefsState = { ok?: boolean; message?: string }

/** The person's own settings. Not audited, like "read": it changes nothing anyone else sees. */
export async function savePrefsAction(_prev: PrefsState, form: FormData): Promise<PrefsState> {
  const user = await requireUser()
  const p = prefsSchema.safeParse({
    mutedProducts: form.getAll('muted'),
    minSeverity: form.get('minSeverity'),
    emailAlerts: form.get('emailAlerts'),
    emailReport: form.get('emailReport'),
  })
  if (!p.success) return { ok: false, message: 'Check the form.' }
  try {
    await notificationStore().savePrefs(user.id, p.data)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/', 'layout')
  return { ok: true, message: 'Saved.' }
}
