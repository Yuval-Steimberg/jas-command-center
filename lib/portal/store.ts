import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import { ConflictError, OpsSetupError } from '@/lib/ops/store'
import { fail } from '@/lib/ops/supabase'
import type { PortalAction, PortalCategory, PortalData } from './model'
import { seedData } from './seed'

export { ConflictError }

export const portalSetupError = () => new OpsSetupError('0014_portal.sql', 'The team portal link tables')

/**
 * The link registry. Supabase in production (migration 0014), memory for the
 * local development login and tests, with the same rules: an edit names the
 * version it was made from, and someone else's newer save wins.
 */
export interface PortalStore {
  load(): Promise<PortalData>
  saveCategory(row: Omit<PortalCategory, 'updatedAt'>, expectedUpdatedAt: string | null): Promise<PortalCategory>
  saveAction(row: Omit<PortalAction, 'updatedAt'>, expectedUpdatedAt: string | null): Promise<PortalAction>
  deleteAction(id: string, expectedUpdatedAt: string): Promise<void>
  /** Write `sort` = position for each id, in the order given. */
  reorder(kind: 'category' | 'action', ids: string[]): Promise<void>
}

const STALE = 'מישהו אחר שינה את זה בינתיים. טענו את הדף מחדש ונסו שוב.'

export function memoryPortalStore(data: PortalData, now = () => new Date().toISOString()): PortalStore {
  const save = <T extends { id: string; updatedAt: string }>(list: T[], row: Omit<T, 'updatedAt'>, expected: string | null): T => {
    const i = list.findIndex((x) => x.id === row.id)
    if (expected === null && i >= 0) throw new ConflictError('כבר יש קישור עם המזהה הזה.')
    if (expected !== null && (i < 0 || list[i]!.updatedAt !== expected)) throw new ConflictError(STALE)
    // Strictly later than the version replaced, even within the same millisecond.
    let at = now()
    if (i >= 0 && at <= list[i]!.updatedAt) at = new Date(Date.parse(list[i]!.updatedAt) + 1).toISOString()
    const saved = { ...row, updatedAt: at } as T
    if (i >= 0) list[i] = saved
    else list.push(saved)
    return { ...saved }
  }
  return {
    async load() {
      return { categories: data.categories.map((c) => ({ ...c })), actions: data.actions.map((a) => ({ ...a })) }
    },
    async saveCategory(row, expected) {
      return save(data.categories, row, expected)
    },
    async saveAction(row, expected) {
      if (!data.categories.some((c) => c.id === row.categoryId)) throw new ConflictError('הקטגוריה לא קיימת.')
      return save(data.actions, row, expected)
    },
    async deleteAction(id, expected) {
      const i = data.actions.findIndex((a) => a.id === id)
      if (i < 0 || data.actions[i]!.updatedAt !== expected) throw new ConflictError(STALE)
      data.actions.splice(i, 1)
    },
    async reorder(kind, ids) {
      const list: { id: string; sort: number }[] = kind === 'category' ? data.categories : data.actions
      ids.forEach((id, n) => {
        const row = list.find((x) => x.id === id)
        if (row) row.sort = n + 1
      })
    },
  }
}

type CatRow = { id: string; title: string; subtitle: string; icon: string; sort: number; active: boolean; updated_at: string }
type ActRow = {
  id: string
  category_id: string
  title: string
  description: string
  destination: string
  audience: string
  permission: string | null
  sort: number
  active: boolean
  updated_at: string
}

const toCat = (r: CatRow): PortalCategory => ({ id: r.id, title: r.title, subtitle: r.subtitle, icon: r.icon as PortalCategory['icon'], sort: r.sort, active: r.active, updatedAt: r.updated_at })
const toAct = (r: ActRow): PortalAction => ({
  id: r.id,
  categoryId: r.category_id,
  title: r.title,
  description: r.description,
  destination: r.destination,
  audience: r.audience as PortalAction['audience'],
  permission: r.permission as PortalAction['permission'],
  sort: r.sort,
  active: r.active,
  updatedAt: r.updated_at,
})

export function supabasePortalStore(db: SupabaseClient, by: () => string | null = () => null): PortalStore {
  const f = (e: Parameters<typeof fail>[0]): never => fail(e, portalSetupError)
  async function upsert<R extends { updated_at: string }>(table: string, row: Record<string, unknown>, expected: string | null): Promise<R> {
    const values = { ...row, updated_at: new Date().toISOString(), updated_by: by() }
    if (expected === null) {
      const { data, error } = await db.from(table).insert(values).select().single()
      if (error) f(error)
      return data as R
    }
    const { data, error } = await db.from(table).update(values).eq('id', row.id as string).eq('updated_at', expected).select()
    if (error) f(error)
    if (!data?.length) throw new ConflictError(STALE)
    return data[0] as R
  }
  return {
    async load() {
      const [c, a] = await Promise.all([db.from('cc_portal_categories').select('*').order('sort'), db.from('cc_portal_actions').select('*').order('sort')])
      if (c.error) f(c.error)
      if (a.error) f(a.error)
      return { categories: (c.data as CatRow[]).map(toCat), actions: (a.data as ActRow[]).map(toAct) }
    },
    async saveCategory(row, expected) {
      return toCat(await upsert<CatRow>('cc_portal_categories', { id: row.id, title: row.title, subtitle: row.subtitle, icon: row.icon, sort: row.sort, active: row.active }, expected))
    },
    async saveAction(row, expected) {
      return toAct(
        await upsert<ActRow>(
          'cc_portal_actions',
          {
            id: row.id,
            category_id: row.categoryId,
            title: row.title,
            description: row.description,
            destination: row.destination,
            audience: row.audience,
            permission: row.permission,
            sort: row.sort,
            active: row.active,
          },
          expected,
        ),
      )
    },
    async deleteAction(id, expected) {
      const { data, error } = await db.from('cc_portal_actions').delete().eq('id', id).eq('updated_at', expected).select('id')
      if (error) f(error)
      if (!data?.length) throw new ConflictError(STALE)
    },
    async reorder(kind, ids) {
      const table = kind === 'category' ? 'cc_portal_categories' : 'cc_portal_actions'
      // Order only; a concurrent reorder can interleave, which leaves a valid (if unexpected) order, never lost data.
      const results = await Promise.all(ids.map((id, n) => db.from(table).update({ sort: n + 1 }).eq('id', id)))
      for (const r of results) if (r.error) f(r.error)
    },
  }
}

// One per process, on globalThis: route handlers, actions and pages are separate bundles in Next.js.
const g = globalThis as unknown as { __ccPortalData?: PortalData }

export function getPortalStore(actorId?: string): PortalStore {
  if (authMode().kind === 'supabase') return supabasePortalStore(supabaseAdmin(), () => (actorId && actorId !== 'dev-owner' ? actorId : null))
  return memoryPortalStore((g.__ccPortalData ??= seedData()))
}
