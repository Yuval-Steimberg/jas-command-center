import { ROLES, ROLE_LABELS_HE, can, type Permission, type PermissionOverrides, type Role } from '@/lib/auth/rbac'

/**
 * "Who sees this link", in words a manager uses, for link management. Each
 * option is one existing permission; the screen also lists which roles hold
 * it, so nobody has to know what `inventory:financial` means.
 */
export const WHO_OPTIONS: { permission: Permission | null; label: string }[] = [
  { permission: null, label: 'כל מי שנכנס לפורטל' },
  { permission: 'inventory:read', label: 'צוות החנות והמלאי' },
  { permission: 'inventory:financial', label: 'מי שרושם מכירות' },
  { permission: 'inventory:write', label: 'מי שמוסיף ומעדכן פריטים' },
  { permission: 'inventory:operate', label: 'מי שקולט פריטים למחסן' },
  { permission: 'inventory:reports', label: 'מנהלי מלאי ומכירות' },
  { permission: 'crm:write', label: 'מי שמוסיף לקוחות' },
  { permission: 'furniture:read', label: 'צוות המיפוי והפינוי' },
  { permission: 'furniture:write', label: 'מנהלי פרויקטים' },
  { permission: 'volunteers:read', label: 'מי שעובד עם מתנדבים' },
  { permission: 'volunteers:operate', label: 'מי שמעדכן נוכחות' },
  { permission: 'volunteers:read_pii', label: 'רכזי ומשבצי מתנדבים' },
  { permission: 'gift_cards:read', label: 'מי שבודק שוברי מתנה' },
  { permission: 'gift_cards:operate', label: 'מי שמממש שוברי מתנה' },
  { permission: 'gift_cards:write', label: 'מנהלי שוברי המתנה' },
  { permission: 'website:read_pii', label: 'מי שעונה להודעות מהאתר' },
  { permission: 'map:write', label: 'מי שעורך את המפה' },
  { permission: 'integrations:read', label: 'מנהלים' },
  { permission: 'users:manage', label: 'מי שמנהל את הצוות' },
  { permission: 'portal:manage', label: 'מי שמנהל את הפורטל' },
]

export function whoLabel(p: Permission | null): string {
  return WHO_OPTIONS.find((o) => o.permission === p)?.label ?? p ?? ''
}

/** The roles that would see a link with this permission (the scheduler role holds none; it lives in schedule mode). */
export function rolesWith(p: Permission | null, overrides?: PermissionOverrides): Role[] {
  return ROLES.filter((r) => r !== 'scheduler' && (!p || can(r, p, overrides)))
}

export const roleHe = (r: Role) => ROLE_LABELS_HE[r]
