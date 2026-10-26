import type { Role } from '@/lib/auth/rbac'

/**
 * Staff changes the command center refuses, stated once and pure so they are
 * tested without a database. Every one of them is a way to lock the business
 * out of its own console, or to let someone raise their own access.
 */
export interface StaffMember {
  id: string
  email: string
  name: string
  role: Role | null
  active: boolean
}

export type StaffChange =
  | { kind: 'role'; targetId: string; role: Role }
  | { kind: 'active'; targetId: string; active: boolean }
  | { kind: 'delete'; targetId: string }

export function refuseStaffChange(actor: { id: string; role: Role }, staff: readonly StaffMember[], change: StaffChange): string | null {
  const target = staff.find((s) => s.id === change.targetId)
  if (!target) return 'That person is not on the staff list.'
  if (target.id === actor.id) return change.kind === 'delete' ? 'You cannot delete yourself. Ask another owner.' : 'You cannot change your own role or access. Ask another owner.'
  // Only an owner may make, or unmake, an owner.
  if (actor.role !== 'owner' && (target.role === 'owner' || (change.kind === 'role' && change.role === 'owner'))) return 'Only an owner can grant or remove the owner role.'
  const activeOwners = staff.filter((s) => s.active && s.role === 'owner')
  const removesOwner = target.role === 'owner' && target.active && ((change.kind === 'role' && change.role !== 'owner') || (change.kind === 'active' && !change.active) || change.kind === 'delete')
  if (removesOwner && activeOwners.length <= 1) return 'This is the last active owner. Make someone else owner first.'
  return null
}

export function refuseInvite(actor: { role: Role }, staff: readonly StaffMember[], email: string, role: Role): string | null {
  if (actor.role !== 'owner' && role === 'owner') return 'Only an owner can invite another owner.'
  if (staff.some((s) => s.email.toLowerCase() === email.toLowerCase())) return 'That email is already on the staff list. Change their role or reactivate them instead.'
  return null
}

/**
 * Sending someone a fresh invitation / set-password link: for a person whose
 * invitation expired or went to the wrong address, or who forgot their password.
 * Never for yourself (that is the sign-in page's job), never for a deactivated
 * person, and an owner's link only from an owner.
 */
export function refuseResend(actor: { id: string; role: Role }, staff: readonly StaffMember[], targetId: string): string | null {
  const target = staff.find((s) => s.id === targetId)
  if (!target) return 'That person is not on the staff list.'
  if (target.id === actor.id) return 'You cannot send a link to yourself from here.'
  if (!target.active) return 'Reactivate them first.'
  if (actor.role !== 'owner' && target.role === 'owner') return 'Only an owner can send an owner a sign-in link.'
  return null
}
