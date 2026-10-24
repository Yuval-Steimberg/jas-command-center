/**
 * Role-based access control. Pure (no I/O) so it is shared by server code and
 * tests. The browser may use it to decide what to SHOW, never what is ALLOWED:
 * every server action and route calls assertPermission itself.
 */

export const ROLES = ['owner', 'admin', 'operations_manager', 'project_manager', 'volunteer_coordinator', 'seller', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  operations_manager: 'Operations manager',
  project_manager: 'Project manager',
  volunteer_coordinator: 'Volunteer coordinator',
  seller: 'Shop seller',
  viewer: 'Read-only viewer',
}

/** The same roles in Hebrew, for shop mode. */
export const ROLE_LABELS_HE: Record<Role, string> = {
  owner: 'בעלים',
  admin: 'מנהל/ת מערכת',
  operations_manager: 'מנהל/ת תפעול',
  project_manager: 'מנהל/ת פרויקטים',
  volunteer_coordinator: 'רכז/ת מתנדבים',
  seller: 'מוכר/ת בחנות',
  viewer: 'צפייה בלבד',
}

/** Most privileged first: a user with several roles acts with the first one listed here. */
const RANK: Role[] = ['owner', 'admin', 'operations_manager', 'project_manager', 'volunteer_coordinator', 'seller', 'viewer']

/**
 * The five source systems, plus the modules whose data the command center
 * itself owns: `crm` (contacts, leads, interactions, tasks) and `inventory`
 * (physical items after intake, locations, in-store sales, deliveries) from
 * migration 0003, and `volunteers` (volunteers, activities, shifts,
 * attendance; migration 0005, shared with the volunteer app).
 */
export const PRODUCTS = ['website', 'gift_cards', 'furniture', 'design_agent', 'map', 'crm', 'inventory', 'volunteers'] as const
export type Product = (typeof PRODUCTS)[number]

/**
 * `read`      — aggregates and operational state
 * `read_pii`  — customer names, emails, phones, addresses
 * `operate`   — reversible operational actions (retry a job, resend an email)
 * `write`     — edits to source data (prices, items, places)
 * `financial` — money-moving or irreversible actions (refund, void, mark paid)
 */
export const ACTIONS = ['read', 'read_pii', 'operate', 'write', 'financial'] as const
export type Action = (typeof ACTIONS)[number]

export type Permission =
  | `${Product}:${Action}`
  | 'integrations:read'
  | 'audit:read'
  | 'users:manage'
  | 'assistant:use'

const all = (actions: readonly Action[], products: readonly Product[] = PRODUCTS): Permission[] =>
  products.flatMap((p) => actions.map((a) => `${p}:${a}` as Permission))

/**
 * Defaults. Payment and gift-card money actions (`gift_cards:financial`) are
 * owner-only by default — they get extra protection, per the brief.
 */
export const DEFAULT_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    ...all(ACTIONS),
    'integrations:read',
    'audit:read',
    'users:manage',
    'assistant:use',
  ]),
  admin: new Set<Permission>([
    ...all(['read', 'read_pii', 'operate', 'write']),
    'website:financial',
    'inventory:financial',
    'integrations:read',
    'audit:read',
    'assistant:use',
  ]),
  operations_manager: new Set<Permission>([
    ...all(['read', 'operate']),
    'gift_cards:read_pii',
    'furniture:read_pii',
    'furniture:write',
    'crm:read_pii',
    'crm:write',
    'inventory:write',
    'volunteers:read_pii',
    'volunteers:write',
    'integrations:read',
    'assistant:use',
  ]),
  project_manager: new Set<Permission>([
    'furniture:read',
    'furniture:read_pii',
    'furniture:operate',
    'furniture:write',
    'map:read',
    // Intake of collected items into the warehouse is the end of a project manager's flow.
    'inventory:read',
    'inventory:operate',
    // Field projects need people: a project manager staffs the activities on their projects.
    'volunteers:read',
    'volunteers:read_pii',
    'volunteers:operate',
    'volunteers:write',
    'assistant:use',
  ]),
  /**
   * Runs the volunteer programme: activities, shifts, assignments, attendance,
   * messages to volunteers. Sees which furniture projects exist (to link an
   * activity to one) and nothing about money, customers or other products.
   */
  volunteer_coordinator: new Set<Permission>([
    'volunteers:read',
    'volunteers:read_pii',
    'volunteers:operate',
    'volunteers:write',
    'furniture:read',
    'map:read',
    'assistant:use',
  ]),
  /**
   * Works the shop floor through /shop: takes items in (photo, AI fields),
   * sells, records payments, hands over and takes returns, and adds customers.
   * Purchase cost is visible to them (the shop prices from it). Nothing about
   * the website's content, gift cards, the field app or volunteers.
   */
  seller: new Set<Permission>([
    'inventory:read',
    'inventory:operate',
    'inventory:write',
    'inventory:financial',
    'crm:read',
    'crm:read_pii',
    'crm:write',
  ]),
  viewer: new Set<Permission>([...all(['read']), 'integrations:read']),
}

/** Per-deployment overrides (stored in cc_role_permissions). `false` revokes a default. */
export type PermissionOverrides = Partial<Record<Role, Partial<Record<Permission, boolean>>>>

export function primaryRole(roles: readonly string[]): Role | null {
  return RANK.find((r) => roles.includes(r)) ?? null
}

export function can(role: Role | null, permission: Permission, overrides?: PermissionOverrides): boolean {
  if (!role) return false
  const override = overrides?.[role]?.[permission]
  if (override !== undefined) {
    // The owner can never lose user management — otherwise a bad override locks everyone out.
    if (role === 'owner' && permission === 'users:manage') return true
    return override
  }
  return DEFAULT_PERMISSIONS[role].has(permission)
}

export class ForbiddenError extends Error {
  readonly status = 403
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`)
  }
}

export function assertCan(role: Role | null, permission: Permission, overrides?: PermissionOverrides): void {
  if (!can(role, permission, overrides)) throw new ForbiddenError(permission)
}
