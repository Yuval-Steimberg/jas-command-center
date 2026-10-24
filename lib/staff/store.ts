import 'server-only'
import { supabaseAdmin } from '@/lib/supabase'
import { primaryRole, type Role } from '@/lib/auth/rbac'
import { PROFILE_WITH_ROLES } from '@/lib/auth/profile-query'
import { dropProfileCache } from '@/lib/auth/session'
import type { StaffMember } from './rules'

/**
 * Staff = cc_profiles + cc_user_roles in the command center's own database,
 * linked to a Supabase Auth user. A person acts with ONE role (the
 * highest-ranked), so changing a role replaces all of theirs.
 */
export async function listStaff(): Promise<StaffMember[]> {
  const { data, error } = await supabaseAdmin().from('cc_profiles').select(PROFILE_WITH_ROLES).order('created_at')
  if (error) throw new Error(`staff: ${error.message}`)
  return (data ?? []).map((p) => ({
    id: p.id as string,
    email: p.email as string,
    name: (p.full_name as string) || '',
    role: primaryRole(((p.cc_user_roles ?? []) as { role: string }[]).map((r) => r.role)),
    active: Boolean(p.is_active),
  }))
}

export async function setRole(profileId: string, role: Role, grantedBy: string): Promise<void> {
  const db = supabaseAdmin()
  // Insert first, then drop the others: a failure in between leaves an extra role, never none.
  const ins = await db.from('cc_user_roles').upsert({ profile_id: profileId, role, granted_by: grantedBy }, { onConflict: 'profile_id,role' })
  if (ins.error) throw new Error(`staff: ${ins.error.message}`)
  const del = await db.from('cc_user_roles').delete().eq('profile_id', profileId).neq('role', role)
  dropProfileCache()
  if (del.error) throw new Error(`staff: ${del.error.message}`)
}

export async function setActive(profileId: string, active: boolean): Promise<void> {
  const { error } = await supabaseAdmin().from('cc_profiles').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', profileId)
  dropProfileCache()
  if (error) throw new Error(`staff: ${error.message}`)
}

/**
 * Supabase sends the invitation email itself (its own mailer, rate-limited by
 * Supabase); the link lands on /login/set-password. The profile is created
 * already linked to the new auth user, with the chosen role.
 */
export async function invite(email: string, name: string, role: Role, grantedBy: string, redirectTo: string): Promise<void> {
  const db = supabaseAdmin()
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (error || !data.user) throw new Error(`invite: ${error?.message ?? 'no user returned'}`)
  const prof = await db
    .from('cc_profiles')
    .upsert({ auth_user_id: data.user.id, email, full_name: name, is_active: true }, { onConflict: 'email' })
    .select('id')
    .single()
  if (prof.error) throw new Error(`staff: ${prof.error.message}`)
  await setRole(prof.data.id as string, role, grantedBy)
}
