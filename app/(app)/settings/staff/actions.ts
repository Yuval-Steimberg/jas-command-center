'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { env } from '@/lib/env'
import { authMode } from '@/lib/auth/mode'
import { ROLES, type Role } from '@/lib/auth/rbac'
import { refuseInvite, refuseStaffChange } from '@/lib/staff/rules'
import { invite, listStaff, setActive, setRole } from '@/lib/staff/store'

export type StaffState = { ok?: boolean; message?: string }

const role = z.enum(ROLES)
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function actor() {
  try {
    const user = await requirePermission('users:manage')
    if (authMode().kind !== 'supabase') return { error: 'Staff can only be managed when Supabase Auth is configured.' } as const
    return { user } as const
  } catch {
    return { error: 'You do not have permission to manage staff.' } as const
  }
}

export async function inviteAction(_prev: StaffState, form: FormData): Promise<StaffState> {
  const a = await actor()
  if ('error' in a) return { ok: false, message: a.error }
  const input = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().min(1).max(100), role }).safeParse({ email: form.get('email'), name: form.get('name'), role: form.get('role') })
  if (!input.success) return { ok: false, message: 'Enter a name, a valid email and a role.' }
  const { email, name } = input.data
  const r = input.data.role as Role
  const refused = refuseInvite(a.user, await listStaff(), email, r)
  if (refused) return { ok: false, message: refused }
  const detail = { email, role: r }
  await audit(a.user, { action: 'staff.invite', product: null, target: email, outcome: 'requested', detail })
  try {
    await invite(email, name, r, a.user.id, `${env().cc.appUrl}/login/set-password`)
    await audit(a.user, { action: 'staff.invite', product: null, target: email, outcome: 'succeeded', detail })
    revalidatePath('/settings/staff')
    return { ok: true, message: `Invitation sent to ${email}. The link lets them set a password.` }
  } catch (e) {
    await audit(a.user, { action: 'staff.invite', product: null, target: email, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not invited: ${fail(e)}` }
  }
}

export async function setRoleAction(_prev: StaffState, form: FormData): Promise<StaffState> {
  const a = await actor()
  if ('error' in a) return { ok: false, message: a.error }
  const id = z.string().uuid().safeParse(form.get('id'))
  const r = role.safeParse(form.get('role'))
  if (!id.success || !r.success) return { ok: false, message: 'Pick a role.' }
  const staff = await listStaff()
  const refused = refuseStaffChange(a.user, staff, { kind: 'role', targetId: id.data, role: r.data })
  if (refused) return { ok: false, message: refused }
  const target = staff.find((s) => s.id === id.data)!
  if (target.role === r.data) return { ok: false, message: 'They already have that role.' }
  const detail = { email: target.email, from: target.role, to: r.data }
  await audit(a.user, { action: 'staff.role', product: null, target: `profile:${id.data}`, outcome: 'requested', detail })
  try {
    await setRole(id.data, r.data, a.user.id)
    await audit(a.user, { action: 'staff.role', product: null, target: `profile:${id.data}`, outcome: 'succeeded', detail })
    revalidatePath('/settings/staff')
    return { ok: true, message: 'Role changed. It applies on their next page load.' }
  } catch (e) {
    await audit(a.user, { action: 'staff.role', product: null, target: `profile:${id.data}`, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

export async function setActiveAction(_prev: StaffState, form: FormData): Promise<StaffState> {
  const a = await actor()
  if ('error' in a) return { ok: false, message: a.error }
  const id = z.string().uuid().safeParse(form.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid person.' }
  const active = form.get('active') === 'true'
  const staff = await listStaff()
  const refused = refuseStaffChange(a.user, staff, { kind: 'active', targetId: id.data, active })
  if (refused) return { ok: false, message: refused }
  const target = staff.find((s) => s.id === id.data)!
  const action = active ? 'staff.reactivate' : 'staff.deactivate'
  await audit(a.user, { action, product: null, target: `profile:${id.data}`, outcome: 'requested', detail: { email: target.email } })
  try {
    await setActive(id.data, active)
    await audit(a.user, { action, product: null, target: `profile:${id.data}`, outcome: 'succeeded', detail: { email: target.email } })
    revalidatePath('/settings/staff')
    return { ok: true, message: active ? 'Reactivated.' : 'Deactivated. They are signed out on their next page load.' }
  } catch (e) {
    await audit(a.user, { action, product: null, target: `profile:${id.data}`, outcome: 'failed', detail: { email: target.email, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}
