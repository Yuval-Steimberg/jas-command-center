import { z } from 'zod'
import { can, type Permission, type PermissionOverrides, type Role } from '@/lib/auth/rbac'

/**
 * The team portal (/portal): six work categories, each a short list of
 * actions that open the page or app that does the job. Pure (no I/O), shared
 * by the pages, the server actions and the tests.
 *
 * The portal is a gateway, not a second permission system (spec page 4):
 * hiding an action is presentation only, and every destination checks its own
 * permission. An action's `permission` decides who is SHOWN it and who may
 * use its shared link; it must never be looser than the page it opens
 * (tests/unit/portal.test.ts checks every seeded internal destination).
 */

export const PORTAL_ICONS = ['volunteers', 'mapping', 'inventory', 'design', 'map', 'admin', 'link'] as const
export type PortalIcon = (typeof PORTAL_ICONS)[number]

/**
 * Who a link is FOR (spec page 2, "סימונים במסך"):
 * - `customer` — a public address safe to send to someone outside the team (a customer, a volunteer).
 *   Copy and Share hand out the destination itself, never a portal address that needs a login.
 * - `team`     — everyday internal work.
 * - `manager`  — management screens.
 */
export const AUDIENCES = ['customer', 'team', 'manager'] as const
export type Audience = (typeof AUDIENCES)[number]

export const AUDIENCE_LABEL: Record<Audience, string> = { customer: 'לשליחה החוצה', team: 'צוות', manager: 'ניהול' }

export interface PortalCategory {
  id: string
  title: string
  subtitle: string
  icon: PortalIcon
  sort: number
  active: boolean
  updatedAt: string
}

export interface PortalAction {
  id: string
  categoryId: string
  title: string
  description: string
  /**
   * Where it goes: an internal path (`/shop/sell`), an https address, or
   * `app:<key>[/path]` for one of the JAS apps whose address this deployment
   * already knows (see APP_KEYS). Empty = not set yet (the action stays off).
   */
  destination: string
  audience: Audience
  /** Who sees it. Null = everyone signed in. */
  permission: Permission | null
  sort: number
  active: boolean
  updatedAt: string
}

export interface PortalData {
  categories: PortalCategory[]
  actions: PortalAction[]
}

/** JAS apps whose address comes from this deployment's settings, so it is never typed twice. */
export const APP_KEYS = ['furniture', 'volunteers', 'website', 'map', 'gift_cards'] as const
export type AppKey = (typeof APP_KEYS)[number]
export type AppUrls = Partial<Record<AppKey, string | undefined>>

export const APP_LABEL: Record<AppKey, string> = {
  furniture: 'אפליקציית המיפוי והאיסוף',
  volunteers: 'אפליקציית המתנדבים',
  website: 'האתר',
  map: 'המפה השכונתית',
  gift_cards: 'אתר שוברי המתנה',
}

export type Resolved =
  | { ok: true; href: string; external: boolean; app: AppKey | null }
  | { ok: false; reason: 'empty' | 'invalid' | 'app_not_configured'; app?: AppKey }

const INTERNAL = /^\/(?!\/)[^\s\\]*$/

/** Turn a stored destination into an address, or say why it cannot be opened. */
export function resolveDestination(dest: string, apps: AppUrls): Resolved {
  const d = dest.trim()
  if (!d) return { ok: false, reason: 'empty' }
  if (d.startsWith('app:')) {
    const m = /^app:([a-z_]+)(\/[^\s\\]*)?$/.exec(d)
    if (!m || !(APP_KEYS as readonly string[]).includes(m[1]!)) return { ok: false, reason: 'invalid' }
    const app = m[1] as AppKey
    const base = apps[app]
    if (!base) return { ok: false, reason: 'app_not_configured', app }
    let url: URL
    try {
      url = new URL((m[2] ?? '').replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`)
    } catch {
      return { ok: false, reason: 'invalid', app }
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return { ok: false, reason: 'invalid', app }
    return { ok: true, href: url.toString(), external: true, app }
  }
  if (d.startsWith('/')) {
    // A portal action may not point at another shared portal link (a loop) or outside the site.
    if (!INTERNAL.test(d) || d.startsWith('/portal/a/')) return { ok: false, reason: 'invalid' }
    return { ok: true, href: d, external: false, app: null }
  }
  try {
    const url = new URL(d)
    if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, reason: 'invalid' }
    return { ok: true, href: url.toString(), external: true, app: null }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

export type Viewer = { role: Role | null; overrides?: PermissionOverrides }

export function mayUse(v: Viewer, a: Pick<PortalAction, 'permission'>): boolean {
  return !!v.role && (!a.permission || can(v.role, a.permission, v.overrides))
}

export interface ShownAction extends PortalAction {
  href: string
  external: boolean
}

export interface ShownCategory extends PortalCategory {
  actions: ShownAction[]
}

/**
 * What one person sees: active categories in order, each with the active
 * actions they may use whose destination resolves. A category with nothing
 * for them is left out, so nobody meets an empty card or a dead button.
 */
export function portalFor(data: PortalData, v: Viewer, apps: AppUrls): ShownCategory[] {
  const byCat = new Map<string, ShownAction[]>()
  for (const a of [...data.actions].sort(bySort)) {
    if (!a.active || !mayUse(v, a)) continue
    const r = resolveDestination(a.destination, apps)
    if (!r.ok) continue
    const list = byCat.get(a.categoryId) ?? []
    list.push({ ...a, href: r.href, external: r.external })
    byCat.set(a.categoryId, list)
  }
  return [...data.categories]
    .sort(bySort)
    .filter((c) => c.active && (byCat.get(c.id)?.length ?? 0) > 0)
    .map((c) => ({ ...c, actions: byCat.get(c.id)! }))
}

const bySort = (a: { sort: number; id: string }, b: { sort: number; id: string }) => a.sort - b.sort || a.id.localeCompare(b.id)

export interface ActionView {
  id: string
  title: string
  description: string
  audience: Audience
  href: string
  external: boolean
  /** What Copy and Share hand out (see shareTarget). */
  shareUrl: string
  /** Shown in search results, where actions of several categories mix. */
  categoryTitle?: string
}

export const toView = (a: ShownAction, categoryTitle?: string): ActionView => ({
  id: a.id,
  title: a.title,
  description: a.description,
  audience: a.audience,
  href: a.href,
  external: a.external,
  // A customer link is handed out as the public address itself; anything else as the portal's own link,
  // which signs the person in and checks the permission before forwarding (app/portal/a/[id]).
  shareUrl: a.audience === 'customer' ? a.href : `/portal/a/${encodeURIComponent(a.id)}`,
  categoryTitle,
})

/** The address a shared link carries. Customer links are the public destination itself, never a sign-in page. */
export function shareTarget(a: ShownAction, origin: string): string {
  if (a.audience === 'customer') return a.external ? a.href : `${origin}${a.href}`
  return `${origin}/portal/a/${encodeURIComponent(a.id)}`
}

/** Where to go after signing in: only a path on this site, never another site. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null
  if (!INTERNAL.test(next) || next.startsWith('/login')) return null
  return next.length > 500 ? null : next
}

// ── Editing (link management) ──────────────────────────────────────────────

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/

const PERMISSION = z.string().regex(/^[a-z_]+:[a-z_]+$/)

export const actionInput = z.object({
  id: z.string().regex(ID_RE).optional(),
  categoryId: z.string().regex(ID_RE),
  title: z.string().trim().min(2).max(60),
  description: z.string().trim().max(140),
  destination: z.string().trim().max(500),
  audience: z.enum(AUDIENCES),
  permission: PERMISSION.nullable(),
  active: z.boolean(),
  /** For an edit: the version the editor loaded. Someone else's newer save wins (409), never overwritten. */
  expectedUpdatedAt: z.string().optional(),
})
export type ActionInput = z.infer<typeof actionInput>

export const categoryInput = z.object({
  id: z.string().regex(ID_RE).optional(),
  title: z.string().trim().min(2).max(40),
  subtitle: z.string().trim().max(80),
  icon: z.enum(PORTAL_ICONS),
  active: z.boolean(),
  expectedUpdatedAt: z.string().optional(),
})
export type CategoryInput = z.infer<typeof categoryInput>

/** Business rules a save must pass, in Hebrew for the person editing. Empty = fine. */
export function checkAction(a: Omit<ActionInput, 'expectedUpdatedAt'>, apps: AppUrls, known: readonly string[]): string[] {
  const errors: string[] = []
  if (a.permission && !known.includes(a.permission)) errors.push('ההרשאה שנבחרה לא קיימת.')
  const r = resolveDestination(a.destination, apps)
  if (!r.ok && r.reason === 'invalid') errors.push('הכתובת לא תקינה. כתובת חיצונית מתחילה ב-https://, ודף פנימי מתחיל ב-/.')
  else if (!r.ok && r.reason === 'empty' && a.active) errors.push('אי אפשר להפעיל קישור בלי כתובת. אפשר לשמור אותו כבוי.')
  // Spec page 3: a management link is never offered as something to send outside.
  if (a.audience === 'customer' && a.destination.trim().startsWith('/')) errors.push('קישור לשליחה החוצה חייב להיות כתובת ציבורית, לא מסך פנימי שדורש כניסה.')
  if (a.audience === 'customer' && a.permission && /:(write|financial|read_pii)$|^(users|portal):/.test(a.permission))
    errors.push('קישור לשליחה החוצה לא יכול להיות מסך ניהול.')
  return errors
}

/** A readable id from a Hebrew or English title, unique among `taken`. */
export function newId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`
    if (!taken.has(id)) return id
  }
}

/** Move one id up or down inside an ordered list; returns the new order (unchanged at an edge). */
export function moveInOrder(ids: readonly string[], id: string, dir: 'up' | 'down'): string[] {
  const i = ids.indexOf(id)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= ids.length) return [...ids]
  const out = [...ids]
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}
