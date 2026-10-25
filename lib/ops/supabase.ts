import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ConflictError, OpsSetupError, type OpsStore } from './store'
import type { Contact, Deal, Delivery, Interaction, Item, Location, Movement, Task } from './types'

/**
 * OpsStore over the command center's own Supabase (migration 0003). Item
 * writes go through the cc_inventory_create / cc_inventory_apply functions, so
 * the status check, the write and the movement are one transaction under a row
 * lock. Every error is read: a missing table is reported as "run 0003", a
 * refused write as a ConflictError, anything else is thrown.
 */

export type Row = Record<string, unknown>
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
export function toRow(o: object): Row {
  const r: Row = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[snake(k)] = v
  return r
}
export function fromRow<T>(r: Row): T {
  const o: Row = {}
  for (const [k, v] of Object.entries(r)) o[camel(k)] = k === 'weight_kg' && v != null ? Number(v) : v
  return o as T
}

export type PgError = { code?: string; message?: string } | null
export function fail(error: PgError, setup: () => Error = () => new OpsSetupError()): never {
  const msg = error?.message ?? 'Unknown database error'
  if (error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202' || /relation .* does not exist|Could not find the (table|function)|column .* does not exist/i.test(msg)) throw setup()
  const m = /cc_conflict:\s*(.*)/.exec(msg)
  if (m) throw new ConflictError(m[1]!)
  if (error?.code === '23505') throw new ConflictError('That already exists (email, phone or link must be unique).')
  throw new Error(msg)
}
/** PostgREST's default max_rows: one response never carries more. */
export const PAGE = 1000
type Query = ReturnType<ReturnType<SupabaseClient['from']>['select']>

/** PostgREST or(...) syntax characters are stripped, never escaped by hand. */
const term = (q: string) => q.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

export function supabaseOpsStore(db: SupabaseClient): OpsStore {
  async function one<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T> {
    const { data, error } = await p
    if (error) fail(error)
    return fromRow<T>(data as Row)
  }
  async function many<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const { data, error } = await p
    if (error) fail(error)
    return ((data ?? []) as Row[]).map((r) => fromRow<T>(r))
  }

  /**
   * Up to `limit` rows. PostgREST silently cuts a response at max_rows (1000),
   * so a larger limit is read in pages, with id as the tie-breaker so a page
   * boundary never skips or repeats a row.
   */
  async function upTo<T>(build: () => Query, limit: number): Promise<T[]> {
    if (limit <= PAGE) return many<T>(build().limit(limit))
    const out: T[] = []
    for (let from = 0; from < limit; from += PAGE) {
      const size = Math.min(PAGE, limit - from)
      const page = await many<T>(build().order('id').range(from, from + size - 1))
      out.push(...page)
      if (page.length < size) break
    }
    return out
  }

  return {
    kind: 'supabase',

    listLocations: () => many<Location>(db.from('cc_locations').select('*').order('name')),
    saveLocation: (input, id) =>
      id ? one<Location>(db.from('cc_locations').update({ ...toRow(input), updated_at: new Date().toISOString() }).eq('id', id).select('*').single()) : one<Location>(db.from('cc_locations').insert(toRow(input)).select('*').single()),

    async listItems(f = {}) {
      const t = f.q ? term(f.q) : ''
      // `colors` arrives with migration 0006; until it is run, search the columns 0003 has rather than fail.
      const query = (withColors: boolean) => {
        return upTo<Item>(() => {
          let q = db.from('cc_inventory_items').select('*').order('updated_at', { ascending: false })
          if (f.statuses) q = q.in('status', [...f.statuses])
          if (f.locationId) q = q.eq('location_id', f.locationId)
          if (f.ids) q = q.in('id', [...f.ids])
          if (f.websiteProductIds) q = q.in('website_product_id', [...f.websiteProductIds])
          if (f.furnitureItemIds) q = q.in('furniture_item_id', [...f.furnitureItemIds])
          if (f.buyerContactId) q = q.eq('buyer_contact_id', f.buyerContactId)
          if (f.reservedFor) q = q.eq('reserved_for', f.reservedFor)
          if (f.createdSince) q = q.gte('created_at', f.createdSince)
          if (t) {
            const w = t.split(' ').sort((a, b) => b.length - a.length)[0]!
            q = q.or(`sku.ilike.%${w}%,title.ilike.%${w}%,description.ilike.%${w}%,category.ilike.%${w}%,furniture_project_name.ilike.%${w}%,material.ilike.%${w}%${withColors ? `,colors.ilike.%${w}%` : ''}`)
          }
          return q
        }, f.limit ?? 500)
      }
      const rows = t ? await query(true).catch((e: unknown) => (e instanceof OpsSetupError ? query(false) : Promise.reject(e))) : await query(false)
      // The database narrowed by the longest word; every word must still match.
      const words = t.toLowerCase().split(' ').filter(Boolean)
      return words.length ? rows.filter((i) => words.every((w) => [i.sku, i.title, i.description, i.category, i.furnitureProjectName, i.colors, i.material].some((v) => v?.toLowerCase().includes(w)))) : rows
    },
    async getItem(id) {
      const r = await many<Item>(db.from('cc_inventory_items').select('*').eq('id', id).limit(1))
      return r[0] ?? null
    },
    async getItemBySku(sku) {
      const r = await many<Item>(db.from('cc_inventory_items').select('*').eq('sku', sku.trim().toUpperCase()).limit(1))
      return r[0] ?? null
    },
    async createItem(item, mv) {
      const r = await many<Item>(db.rpc('cc_inventory_create', { p_item: toRow(item), p_movement: toRow(mv) }))
      return r[0]!
    },
    async applyItem(id, expect, set, mv) {
      const r = await many<Item>(
        db.rpc('cc_inventory_apply', { p_item: id, p_expect_version: expect.version ?? null, p_from: expect.from ? [...expect.from] : null, p_set: toRow(set), p_movement: toRow(mv) }),
      )
      if (!r[0]) throw new ConflictError('item not found')
      return r[0]
    },
    async renewalLevelReady() {
      try {
        await many(db.from('cc_inventory_items').select('renewal_level').limit(1))
        return true
      } catch (e) {
        if (e instanceof OpsSetupError) return false
        throw e
      }
    },
    async photoHashes() {
      type H = Pick<Item, 'id' | 'sku' | 'title' | 'photoUrl' | 'status' | 'photoHash'>
      const out: H[] = []
      for (let from = 0; from < 50_000; from += 1000) {
        const page = await many<H>(db.from('cc_inventory_items').select('id,sku,title,photo_url,status,photo_hash').not('photo_hash', 'is', null).order('id').range(from, from + 999))
        out.push(...page)
        if (page.length < 1000) break
      }
      return out
    },
    movements: (itemId) => many<Movement>(db.from('cc_inventory_movements').select('*').eq('item_id', itemId).order('at', { ascending: false }).limit(500)),
    async recentMovements(limit, since) {
      let q = db.from('cc_inventory_movements').select('*').order('at', { ascending: false }).limit(limit)
      if (since) q = q.gte('at', since)
      return many<Movement>(q)
    },

    async listContacts(f = {}) {
      return upTo<Contact>(() => {
        let q = db.from('cc_contacts').select('*').order('updated_at', { ascending: false })
        if (f.role) q = q.contains('roles', [f.role])
        if (f.ids) q = q.in('id', [...f.ids])
        const t = f.q ? term(f.q) : ''
        if (t) {
          const w = t.split(' ').sort((a, b) => b.length - a.length)[0]!
          q = q.or(`full_name.ilike.%${w}%,email.ilike.%${w}%,phone.ilike.%${w.replace(/\D/g, '') || w}%`)
        }
        return q
      }, f.limit ?? 500)
    },
    async getContact(id) {
      const r = await many<Contact>(db.from('cc_contacts').select('*').eq('id', id).limit(1))
      return r[0] ?? null
    },
    async findContact(email, phone) {
      if (email) {
        const r = await many<Contact>(db.from('cc_contacts').select('*').eq('email', email).limit(1))
        if (r[0]) return r[0]
      }
      if (phone) {
        const r = await many<Contact>(db.from('cc_contacts').select('*').eq('phone', phone).limit(1))
        if (r[0]) return r[0]
      }
      return null
    },
    createContact: (input) => one<Contact>(db.from('cc_contacts').insert(toRow(input)).select('*').single()),
    async updateContact(id, patch) {
      const r = await many<Contact>(db.from('cc_contacts').update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq('id', id).select('*'))
      if (!r[0]) throw new ConflictError('Contact not found')
      return r[0]
    },

    async listDeals(f = {}) {
      return upTo<Deal>(() => {
        let q = db.from('cc_deals').select('*').order('updated_at', { ascending: false })
        if (f.stages) q = q.in('stage', [...f.stages])
        if (f.contactId) q = q.eq('contact_id', f.contactId)
        return q
      }, f.limit ?? 500)
    },
    async getDeal(id) {
      const r = await many<Deal>(db.from('cc_deals').select('*').eq('id', id).limit(1))
      return r[0] ?? null
    },
    async createDeal(input) {
      if (input.sourceRef) {
        const ex = await many<Deal>(db.from('cc_deals').select('*').eq('source_ref', input.sourceRef).limit(1))
        if (ex[0]) return { deal: ex[0], created: false }
      }
      const { data, error } = await db.from('cc_deals').insert(toRow(input)).select('*').single()
      if (error?.code === '23505' && input.sourceRef) {
        const ex = await many<Deal>(db.from('cc_deals').select('*').eq('source_ref', input.sourceRef).limit(1))
        if (ex[0]) return { deal: ex[0], created: false }
      }
      if (error) fail(error)
      return { deal: fromRow<Deal>(data as Row), created: true }
    },
    async updateDeal(id, patch) {
      const r = await many<Deal>(db.from('cc_deals').update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq('id', id).select('*'))
      if (!r[0]) throw new ConflictError('Lead not found')
      return r[0]
    },

    async listInteractions(f) {
      let q = db.from('cc_interactions').select('*').order('at', { ascending: false }).limit(f.limit ?? 200)
      if (f.contactId) q = q.eq('contact_id', f.contactId)
      if (f.since) q = q.gte('at', f.since)
      return many<Interaction>(q)
    },
    async addInteraction(input) {
      const { data, error } = await db.from('cc_interactions').insert(toRow(input)).select('*').single()
      if (error?.code === '23505' && input.refId != null) {
        const ex = await many<Interaction>(db.from('cc_interactions').select('*').eq('contact_id', input.contactId).eq('ref_kind', input.refKind ?? '').eq('ref_id', input.refId).limit(1))
        if (ex[0]) return { interaction: ex[0], created: false }
      }
      if (error) fail(error)
      return { interaction: fromRow<Interaction>(data as Row), created: true }
    },

    async listTasks(f = {}) {
      return upTo<Task>(() => {
        let q = db.from('cc_tasks').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
        if (f.status) q = q.eq('status', f.status)
        if (f.entityKind) q = q.eq('entity_kind', f.entityKind)
        if (f.entityId) q = q.eq('entity_id', f.entityId)
        if (f.assignee) q = q.eq('assignee_profile_id', f.assignee)
        return q
      }, f.limit ?? 500)
    },
    async createTask(input) {
      const { data, error } = await db.from('cc_tasks').insert(toRow(input)).select('*').single()
      if (error?.code === '23505' && input.dedupeKey) {
        const ex = await many<Task>(db.from('cc_tasks').select('*').eq('dedupe_key', input.dedupeKey).limit(1))
        if (ex[0]) return { task: ex[0], created: false }
      }
      if (error) fail(error)
      return { task: fromRow<Task>(data as Row), created: true }
    },
    async setTaskStatus(id, status, by) {
      const done = status !== 'open'
      const r = await many<Task>(db.from('cc_tasks').update({ status, completed_at: done ? new Date().toISOString() : null, completed_by: done ? by : null }).eq('id', id).select('*'))
      return r[0] ?? null
    },

    async listDeliveries(f = {}) {
      return upTo<Delivery>(() => {
        let q = db.from('cc_deliveries').select('*').order('scheduled_for', { ascending: true, nullsFirst: false })
        if (f.statuses) q = q.in('status', [...f.statuses])
        if (f.websiteOrderId != null) q = q.eq('website_order_id', f.websiteOrderId)
        if (f.itemId) q = q.eq('item_id', f.itemId)
        if (f.saleLineIds) q = q.in('sale_line_id', [...f.saleLineIds])
        return q
      }, f.limit ?? 500)
    },
    async getDelivery(id) {
      const r = await many<Delivery>(db.from('cc_deliveries').select('*').eq('id', id).limit(1))
      return r[0] ?? null
    },
    createDelivery: (input) => one<Delivery>(db.from('cc_deliveries').insert(toRow(input)).select('*').single()),
    async updateDelivery(id, expectStatus, patch) {
      const r = await many<Delivery>(db.from('cc_deliveries').update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq('id', id).eq('status', expectStatus).select('*'))
      return r[0] ?? null
    },

    async ruleSettings() {
      const rows = await many<{ id: string; enabled: boolean }>(db.from('cc_automation_rules').select('id,enabled'))
      return new Map(rows.map((r) => [r.id, r.enabled]))
    },
    async setRule(id, enabled, by) {
      const { error } = await db.from('cc_automation_rules').upsert({ id, enabled, updated_by: by, updated_at: new Date().toISOString() })
      if (error) fail(error)
    },
    async getCursor(key) {
      const { data, error } = await db.from('cc_sync_state').select('cursor,last_success_at,last_error').eq('source', key).maybeSingle()
      if (error) fail(error)
      return { cursor: (data?.cursor as string) ?? null, lastSuccessAt: (data?.last_success_at as string) ?? null, lastError: (data?.last_error as string) ?? null }
    },
    async setCursor(key, v) {
      const t = new Date().toISOString()
      const row: Row = { source: key, updated_at: t }
      if (v.cursor !== undefined) row.cursor = v.cursor
      if (v.ok) Object.assign(row, { last_success_at: t, last_error: null })
      else Object.assign(row, { last_error: (v.error ?? 'failed').slice(0, 500), last_error_at: t })
      const { error } = await db.from('cc_sync_state').upsert(row)
      if (error) fail(error)
    },
  }
}
