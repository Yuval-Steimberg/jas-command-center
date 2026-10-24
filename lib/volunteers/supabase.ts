/**
 * VolunteerStore over the Command Center's Supabase (migration 0005). Every
 * write that has a rule goes through a plpgsql function; plain reads and the
 * rule-free updates (profile fields, activity text) are PostgREST calls with
 * their error READ. A missing table is "run 0005", a refused write is a
 * ConflictError, anything else is thrown.
 *
 * Shared by the Command Center and the volunteer app: relative imports only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Activity, OutboxRow, Shift, Signup, VolEvent, VolNote, Volunteer } from './model'
import { ConflictError, volunteersSetup, type VolunteerStore } from './store'

type Row = Record<string, unknown>
const PAGE = 1000
const CHUNK = 150
type PgError = { code?: string; message?: string } | null

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
export function toRow(o: object): Row {
  const r: Row = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[snake(k)] = v
  return r
}
export function fromRow<T>(r: Row): T {
  const o: Row = {}
  for (const [k, v] of Object.entries(r)) o[camel(k)] = v
  return o as T
}

export function fail(error: PgError): never {
  const msg = error?.message ?? 'Unknown database error'
  if (error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202' || /relation .* does not exist|Could not find the (table|function)/i.test(msg)) throw volunteersSetup()
  const m = /cc_conflict:\s*(.*)/.exec(msg)
  if (m) throw new ConflictError(m[1]!)
  if (error?.code === '23505') throw new ConflictError('That already exists.')
  throw new Error(msg)
}

/** PostgREST or(...) syntax characters are stripped, never escaped by hand. */
const term = (q: string) => q.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

export function supabaseVolunteerStore(db: SupabaseClient): VolunteerStore {
  async function many<T>(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
    const { data, error } = await p
    if (error) fail(error)
    return ((Array.isArray(data) ? data : data == null ? [] : [data]) as Row[]).map((r) => fromRow<T>(r))
  }
  async function one<T>(p: PromiseLike<{ data: unknown; error: PgError }>, missing = 'not found'): Promise<T> {
    const r = await many<T>(p)
    if (!r[0]) throw new ConflictError(missing)
    return r[0]
  }
  const now = () => new Date().toISOString()

  /**
   * Every list is paged: PostgREST silently caps a response at max_rows (1000
   * on Supabase), so a single `.limit(20000)` would quietly return the newest
   * thousand and every total built on it would freeze. `make` must apply a
   * total order (a unique last key) so pages never overlap or skip.
   */
  async function paged<T>(make: () => any, limit: number): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; out.length < limit; from += PAGE) {
      const want = Math.min(PAGE, limit - from)
      const rows = await many<T>(make().range(from, from + want - 1))
      out.push(...rows)
      if (rows.length < want) break
    }
    return out
  }
  /** Long id lists go in chunks: an `in.(…)` filter lives in the URL. */
  async function chunked<T>(ids: readonly string[] | undefined, run: (chunk: string[] | undefined) => Promise<T[]>): Promise<T[]> {
    if (!ids) return run(undefined)
    const parts: T[][] = []
    for (let i = 0; i < ids.length; i += CHUNK) parts.push(await run(ids.slice(i, i + CHUNK)))
    return parts.flat()
  }

  const store: VolunteerStore = {
    kind: 'supabase',

    register: (input) =>
      one<Volunteer>(
        db.rpc('cc_vol_register', {
          p: {
            full_name: input.fullName, email: input.email, phone: input.phone || null, adult: input.adult, areas: input.areas, availability: input.availability,
            skills: input.skills, transport: input.transport, about: input.about, notify_reminders: input.notifyReminders, notify_opportunities: input.notifyOpportunities,
            consent_whatsapp: input.consentWhatsapp, source: input.source ?? 'app', actor: input.actor ?? null,
          },
        }),
      ),
    async getVolunteer(id) {
      return (await many<Volunteer>(db.from('cc_volunteers').select('*').eq('id', id).limit(1)))[0] ?? null
    },
    async getVolunteerByEmail(email) {
      return (await many<Volunteer>(db.from('cc_volunteers').select('*').eq('email', email.trim().toLowerCase()).limit(1)))[0] ?? null
    },
    async listVolunteers(f = {}) {
      const t = f.q ? term(f.q) : ''
      const make = (ids?: string[], contactIds?: string[]) => () => {
        let q = db.from('cc_volunteers').select('*').order('created_at', { ascending: false }).order('id')
        if (f.statuses) q = q.in('status', [...f.statuses])
        if (ids) q = q.in('id', ids)
        if (contactIds) q = q.in('contact_id', contactIds)
        if (t) {
          const w = t.split(' ').sort((a, b) => b.length - a.length)[0]!
          q = q.or(`full_name.ilike.%${w}%,email.ilike.%${w}%,phone.ilike.%${w.replace(/\D/g, '') || w}%`)
        }
        return q
      }
      const limit = f.limit ?? 1000
      const rows = f.contactIds
        ? await chunked(f.contactIds, (c) => paged<Volunteer>(make(undefined, c), limit))
        : await chunked(f.ids, (c) => paged<Volunteer>(make(c), limit))
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const words = t.toLowerCase().split(' ').filter(Boolean)
      return words.length ? rows.filter((v) => words.every((w) => [v.fullName, v.email, v.phone].some((x) => x?.toLowerCase().includes(/^[\d-]+$/.test(w) ? w.replace(/-/g, '') : w)))) : rows
    },
    async updateVolunteer(id, patch) {
      if (patch.phone) {
        const clash = await many<Volunteer>(db.from('cc_volunteers').select('id').eq('phone', patch.phone).neq('id', id).limit(1))
        if (clash[0]) throw new ConflictError('this phone number is already registered with another email')
      }
      return one<Volunteer>(db.from('cc_volunteers').update({ ...toRow(patch), updated_at: now() }).eq('id', id).neq('status', 'deleted').select('*'), 'this account was deleted')
    },
    async setVolunteerStatus(id, status, actor) {
      const v = await store.getVolunteer(id)
      if (!v || v.status === 'deleted') throw new ConflictError('this account was deleted')
      const signOut = status !== 'active' && v.status === 'active'
      const r = await one<Volunteer>(
        db.from('cc_volunteers').update({ status, session_version: v.sessionVersion + (signOut ? 1 : 0), updated_at: now() }).eq('id', id).eq('status', v.status).select('*'),
        'the volunteer changed; reload',
      )
      const { error } = await db.from('cc_vol_events').insert({ volunteer_id: id, kind: `status_${status}`, actor })
      if (error) fail(error)
      return r
    },
    forget: (id, actor) => one<Volunteer>(db.rpc('cc_vol_forget', { p_volunteer: id, p_actor: actor })),
    async touch(id) {
      const { error } = await db.from('cc_volunteers').update({ last_seen_at: now() }).eq('id', id)
      if (error) fail(error)
    },
    listNotes: (volunteerId) => many<VolNote>(db.from('cc_vol_notes').select('*').eq('volunteer_id', volunteerId).order('at', { ascending: false }).limit(200)),
    addNote: (volunteerId, body, authorEmail) => one<VolNote>(db.from('cc_vol_notes').insert({ volunteer_id: volunteerId, body, author_email: authorEmail }).select('*')),

    async listActivities(f = {}) {
      const rows = await chunked(f.ids, (ids) => paged<Activity>(() => {
        let q = db.from('cc_vol_activities').select('*').order('updated_at', { ascending: false }).order('id')
        if (f.statuses) q = q.in('status', [...f.statuses])
        if (ids) q = q.in('id', ids)
        if (f.projectId) q = q.eq('furniture_project_id', f.projectId)
        return q
      }, f.limit ?? 1000))
      return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async getActivity(id) {
      return (await many<Activity>(db.from('cc_vol_activities').select('*').eq('id', id).limit(1)))[0] ?? null
    },
    createActivity: (input, actor) => one<Activity>(db.from('cc_vol_activities').insert({ ...toRow(input), status: 'draft', created_by: actor }).select('*')),
    async updateActivity(id, expectVersion, patch) {
      const r = await many<Activity>(
        db.from('cc_vol_activities').update({ ...toRow(patch), version: expectVersion + 1, updated_at: now() }).eq('id', id).eq('version', expectVersion).neq('status', 'cancelled').select('*'),
      )
      if (!r[0]) throw new ConflictError('the activity changed since it was loaded, or was cancelled')
      return r[0]
    },
    async setActivityStatus(id, from, to) {
      const a = await store.getActivity(id)
      if (!a || a.status !== from) throw new ConflictError(`the activity is no longer ${from}`)
      return one<Activity>(db.from('cc_vol_activities').update({ status: to, version: a.version + 1, updated_at: now() }).eq('id', id).eq('status', from).eq('version', a.version).select('*'), `the activity is no longer ${from}`)
    },
    cancel: (activityId, shiftId, reason, actor) => many<Signup>(db.rpc('cc_vol_cancel', { p_activity: activityId, p_shift: shiftId, p_reason: reason, p_actor: actor })),

    async listShifts(f = {}) {
      const make = (ids?: string[], activityIds?: string[]) => () => {
        let q = db.from('cc_vol_shifts').select('*').order('starts_at', { ascending: true }).order('id')
        if (activityIds) q = q.in('activity_id', activityIds)
        if (ids) q = q.in('id', ids)
        if (f.status) q = q.eq('status', f.status)
        if (f.from) q = q.gt('ends_at', f.from)
        if (f.to) q = q.lt('starts_at', f.to)
        return q
      }
      const limit = f.limit ?? 5000
      const rows = f.activityIds
        ? await chunked(f.activityIds, (c) => paged<Shift>(make(f.ids ? [...f.ids] : undefined, c), limit))
        : await chunked(f.ids, (c) => paged<Shift>(make(c), limit))
      return rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    },
    async getShift(id) {
      return (await many<Shift>(db.from('cc_vol_shifts').select('*').eq('id', id).limit(1)))[0] ?? null
    },
    async saveShift(activityId, id, expectVersion, input, actor) {
      const { data, error } = await db.rpc('cc_vol_shift_save', {
        p_id: id, p_activity: activityId, p_expect_version: expectVersion,
        p: { label: input.label, role: input.role, starts_at: input.startsAt, ends_at: input.endsAt, capacity: input.capacity, min_volunteers: input.minVolunteers },
        p_actor: actor,
      })
      if (error) fail(error)
      const out = data as { shift: Row; promoted: string[] }
      const promoted = out.promoted?.length ? await store.listSignups({ ids: out.promoted }) : []
      return { shift: fromRow<Shift>(out.shift), promoted }
    },

    async listSignups(f = {}) {
      const make = (dim: 'shift_id' | 'volunteer_id' | 'id' | null, chunk?: string[]) => () => {
        let q = db.from('cc_vol_signups').select('*').order('created_at', { ascending: true }).order('id')
        if (f.shiftIds && dim !== 'shift_id') q = q.in('shift_id', [...f.shiftIds])
        if (f.volunteerIds && dim !== 'volunteer_id') q = q.in('volunteer_id', [...f.volunteerIds])
        if (f.ids && dim !== 'id') q = q.in('id', [...f.ids])
        if (dim && chunk) q = q.in(dim, chunk)
        if (f.volunteerId) q = q.eq('volunteer_id', f.volunteerId)
        if (f.statuses) q = q.in('status', [...f.statuses])
        return q
      }
      const limit = f.limit ?? 20000
      // Chunk the longest id list; the others are short in every caller.
      const dims = ([['shift_id', f.shiftIds], ['volunteer_id', f.volunteerIds], ['id', f.ids]] as const).filter(([, v]) => v) as [ 'shift_id' | 'volunteer_id' | 'id', readonly string[]][]
      const longest = dims.sort((a, b) => b[1].length - a[1].length)[0]
      const rows = longest ? await chunked(longest[1], (c) => paged<Signup>(make(longest[0], c), limit)) : await paged<Signup>(make(null), limit)
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async getSignup(id) {
      return (await many<Signup>(db.from('cc_vol_signups').select('*').eq('id', id).limit(1)))[0] ?? null
    },
    join: (shiftId, volunteerId, source, actor) => one<Signup>(db.rpc('cc_vol_join', { p_shift: shiftId, p_volunteer: volunteerId, p_source: source, p_actor: actor })),
    invite: (shiftId, volunteerId, actor) => one<Signup>(db.rpc('cc_vol_invite', { p_shift: shiftId, p_volunteer: volunteerId, p_actor: actor })),
    async leave(signupId, status, reason, actor, volunteerId) {
      const rows = await many<Signup>(db.rpc('cc_vol_leave', { p_signup: signupId, p_status: status, p_reason: reason, p_actor: actor, p_volunteer: volunteerId }))
      if (!rows[0]) throw new ConflictError('sign-up not found')
      return { signup: rows[0], promoted: rows.slice(1) }
    },
    attendance: (signupId, op, at, note, actor, expectVersion) =>
      one<Signup>(db.rpc('cc_vol_attendance', { p_signup: signupId, p_op: op, p_in: at.in ?? null, p_out: at.out ?? null, p_note: note, p_actor: actor, p_expect_version: expectVersion })),
    selfCheckin: (shiftId, volunteerId, code) => one<Signup>(db.rpc('cc_vol_self_checkin', { p_shift: shiftId, p_volunteer: volunteerId, p_code: code })),

    async listEvents(f) {
      return paged<VolEvent>(() => {
        let q = db.from('cc_vol_events').select('*').order('at', { ascending: false }).order('id')
        if (f.volunteerId) q = q.eq('volunteer_id', f.volunteerId)
        if (f.signupIds) q = q.in('signup_id', [...f.signupIds])
        if (f.shiftIds) q = q.in('shift_id', [...f.shiftIds])
        if (f.since) q = q.gte('at', f.since)
        return q
      }, f.limit ?? 500)
    },

    async enqueue(rows) {
      if (!rows.length) return []
      const { data, error } = await db
        .from('cc_vol_outbox')
        .upsert(rows.map((r) => toRow({ ...r, notBefore: r.notBefore ?? now() })), { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select('*')
      if (error) fail(error)
      return ((data ?? []) as Row[]).map((r) => fromRow<OutboxRow>(r))
    },
    claimOutbox: (limit) => many<OutboxRow>(db.rpc('cc_vol_outbox_claim', { p_limit: limit })),
    async markOutbox(id, status, error) {
      const { error: e } = await db.from('cc_vol_outbox').update({ status, last_error: error ?? null, ...(status === 'sent' ? { sent_at: now() } : {}) }).eq('id', id)
      if (e) fail(e)
    },
    async listOutbox(f) {
      return paged<OutboxRow>(() => {
        let q = db.from('cc_vol_outbox').select('*').order('created_at', { ascending: false }).order('id')
        if (f.volunteerId) q = q.eq('volunteer_id', f.volunteerId)
        if (f.statuses) q = q.in('status', [...f.statuses])
        if (f.since) q = q.gte('created_at', f.since)
        return q
      }, f.limit ?? 200)
    },

    async addLoginCode(email, codeHash, expiresAt) {
      const { error } = await db.from('cc_vol_login_codes').insert({ email, code_hash: codeHash, expires_at: expiresAt })
      if (error) fail(error)
    },
    async countLoginCodes(email, since) {
      const { count, error } = await db.from('cc_vol_login_codes').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since)
      if (error) fail(error)
      return count ?? 0
    },
    async latestLoginCode(email) {
      const r = await many<{ id: string; codeHash: string; expiresAt: string; attempts: number; consumedAt: string | null }>(
        db.from('cc_vol_login_codes').select('id,code_hash,expires_at,attempts,consumed_at').eq('email', email).order('created_at', { ascending: false }).limit(1),
      )
      return r[0] ?? null
    },
    async failLoginCode(id) {
      const c = (await many<{ attempts: number }>(db.from('cc_vol_login_codes').select('attempts').eq('id', id).limit(1)))[0]
      if (!c) return
      // Conditional on the count read, so two wrong guesses at once still count as two (one retries).
      const { data, error } = await db.from('cc_vol_login_codes').update({ attempts: c.attempts + 1 }).eq('id', id).eq('attempts', c.attempts).select('id')
      if (error) fail(error)
      if (!data?.length) await store.failLoginCode(id)
    },
    async consumeLoginCode(id) {
      const { data, error } = await db.from('cc_vol_login_codes').update({ consumed_at: now() }).eq('id', id).is('consumed_at', null).select('id')
      if (error) fail(error)
      return Boolean(data?.length)
    },
  }
  return store
}
