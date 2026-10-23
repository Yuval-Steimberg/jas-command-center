import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { authMode } from './mode'
import { DEV_COOKIE, verifyDevSession } from './dev-session'
import { assertCan, can, primaryRole, type Permission, type Role, type PermissionOverrides } from './rbac'
import { supabaseAdmin, supabaseUserClient } from '@/lib/supabase'
import { diagnoseSetupError, SetupError } from './setup-error'
import { PROFILE_WITH_ROLES } from './profile-query'

export { SetupError }

export interface CurrentUser {
  id: string
  email: string
  name: string
  role: Role
  /** True only for the local development login. */
  dev: boolean
}

export async function loadOverrides(): Promise<PermissionOverrides> {
  const { data, error } = await supabaseAdmin().from('cc_role_permissions').select('role, permission, allowed')
  if (error) throw diagnoseSetupError(error)
  const out: PermissionOverrides = {}
  for (const row of data ?? []) {
    const role = row.role as Role
    ;(out[role] ??= {})[row.permission as Permission] = Boolean(row.allowed)
  }
  return out
}

type Session = { user: CurrentUser; overrides: PermissionOverrides }

/**
 * One auth resolution per request, shared by layout, page and actions. A setup
 * problem means "nobody is signed in" for every page (so they redirect to
 * /login) and is reported on /login itself.
 */
export const sessionState = cache(async (): Promise<{ session: Session | null; setupError: string | null }> => {
  try {
    return { session: await loadSession(), setupError: null }
  } catch (e) {
    if (e instanceof SetupError) {
      console.error('command center setup problem:', e.message)
      return { session: null, setupError: e.message }
    }
    throw e
  }
})

export const getSession = cache(async (): Promise<Session | null> => (await sessionState()).session)

async function loadSession(): Promise<Session | null> {
  const mode = authMode()
  if (mode.kind === 'unconfigured') return null
  if (mode.kind === 'dev') {
    if (!verifyDevSession(cookies().get(DEV_COOKIE)?.value, mode.secret)) return null
    return { user: { id: 'dev-owner', email: 'owner@localhost', name: 'Local owner', role: 'owner', dev: true }, overrides: {} }
  }

  const { data, error } = await supabaseUserClient().auth.getUser()
  if (error || !data.user) return null
  return resolveProfile(data.user.id)
}

/** Map a Supabase Auth user to an active command-center profile with a role, or null. */
export async function resolveProfile(authUserId: string): Promise<{ user: CurrentUser; overrides: PermissionOverrides } | null> {
  const db = supabaseAdmin()
  const [{ data: profile, error: pErr }, overrides] = await Promise.all([
    db.from('cc_profiles').select(PROFILE_WITH_ROLES).eq('auth_user_id', authUserId).maybeSingle(),
    loadOverrides(),
  ])
  if (pErr) throw diagnoseSetupError(pErr)
  if (!profile || !profile.is_active) return null
  const roles = ((profile.cc_user_roles ?? []) as { role: string }[]).map((r) => r.role)
  const role = primaryRole(roles)
  if (!role) return null
  return {
    user: { id: profile.id as string, email: profile.email as string, name: (profile.full_name as string) || (profile.email as string), role, dev: false },
    overrides,
  }
}

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const s = await getSession()
  if (!s) redirect('/login')
  return s.user
}

/** For server actions and route handlers: authorization is checked HERE, never by hiding a button. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const s = await getSession()
  if (!s) throw Object.assign(new Error('Not signed in'), { status: 401 })
  assertCan(s.user.role, permission, s.overrides)
  return s.user
}

export async function userCan(permission: Permission): Promise<boolean> {
  const s = await getSession()
  return !!s && can(s.user.role, permission, s.overrides)
}

/** For pages: signed out → /login; signed in without the permission → /forbidden. */
export async function requirePageAccess(permission: Permission): Promise<CurrentUser> {
  const s = await getSession()
  if (!s) redirect('/login')
  if (!can(s.user.role, permission, s.overrides)) redirect('/forbidden')
  return s.user
}
