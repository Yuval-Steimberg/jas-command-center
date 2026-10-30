import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, SourceError, withHint } from '../http'
import { notConfigured, readOnce } from '../read'
import { invalidate } from '../cache'
import type { SourceResult } from '../types'
import { furnitureHint, headers } from './adapter'

/**
 * One project's apartments and items, and the few writes that are plain
 * column updates in the field app too — so the database's own rules apply
 * unchanged:
 *  - archive / unarchive a project (Projects.tsx `setArchived`);
 *  - an item's destination (`gallery_type`). The app's
 *    trg_sync_intended_for_collection trigger derives intended_for_collection
 *    from it, exactly as when a worker moves the item in the app.
 * Everything else (collect, finish, items, photos, flats, buildings, members)
 * goes through the field app's own endpoint: see field.ts and manage-actions.ts.
 * Item writes are conditional on `updated_at`, so an edit made in the field
 * since this page loaded is never silently overwritten.
 */

/** Destinations in the app's order (src/lib/albums.ts ALBUMS), with its Hebrew labels. */
export const DESTINATIONS = [
  { id: 'unsorted', label: 'טרם מוין', hint: 'ממתין למיון' },
  { id: 'jas_collection', label: 'JAS', hint: 'פריטים לאיסוף' },
  { id: 'third_party', label: 'צד שלישי', hint: 'ספק חיצוני' },
  { id: 'donation', label: 'תרומה', hint: 'נאסף ונתרם' },
  { id: 'documentation', label: 'תיעוד', hint: 'תיעוד בלבד' },
] as const
export type Destination = (typeof DESTINATIONS)[number]['id']

const apartment = z.object({
  id: z.string(),
  building_number: z.string().nullable(),
  apartment_number: z.string().nullable(),
  entrance: z.string().nullable().optional(),
  status: z.string(),
  updated_at: z.string().nullable(),
})
const item = z.object({
  id: z.string(),
  apartment_id: z.string(),
  description: z.string(),
  quantity: z.number().int().nullable(),
  gallery_type: z.string().nullable(),
  intended_for_collection: z.boolean().nullable(),
  collected: z.boolean().nullable(),
  collected_by: z.string().nullable().optional(),
  status: z.string().nullable(),
  item_type: z.string().nullable(),
  updated_at: z.string(),
  // Photo (a public storage URL) and the third-party handover: optional, so an older database still answers.
  image_url: z.string().nullable().optional(),
  handover_confirmed_at: z.string().nullable().optional(),
  handover_recipient: z.string().nullable().optional(),
})
const project = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  developer_name: z.string().nullable(),
  start_date: z.string().nullable(),
  archived: z.boolean().nullable(),
  // Added by a later field-app migration; absent on an older database (select=*).
  street: z.string().nullable().optional(),
  building_numbers: z.string().nullable().optional(),
})

export type FurnitureApartment = z.infer<typeof apartment>
export type FurnitureItem = z.infer<typeof item>
export interface FurnitureProjectDetail {
  project: z.infer<typeof project>
  apartments: FurnitureApartment[]
  items: FurnitureItem[]
  itemsCapped: boolean
  /** The project's building registry (buildings with no apartment yet included); [] on a database without it. */
  buildings: string[]
}

const ITEM_CAP = 2000
const ITEM_COLS = 'id,apartment_id,description,quantity,gallery_type,intended_for_collection,collected,collected_by,status,item_type,updated_at'
const ITEM_COLS_FULL = `${ITEM_COLS},image_url,handover_confirmed_at,handover_recipient`

function conn() {
  const { supabaseUrl, supabaseKey } = env().furniture
  const missing = [!supabaseUrl && 'FURNITURE_SUPABASE_URL', !supabaseKey && 'FURNITURE_SUPABASE_KEY'].filter(Boolean) as string[]
  return { supabaseUrl, supabaseKey, missing }
}

const uuid = z.string().uuid()

/** Items with photo + handover columns; a database without them (PostgREST 400, 42703) is read without. */
async function fetchItems(base: string, h: Record<string, string>, id: string) {
  const q = (cols: string) => fetchJson(`${base}/items?select=${cols}&project_id=eq.${id}&order=created_at.asc&limit=${ITEM_CAP}`, { headers: h })
  try {
    return await q(ITEM_COLS_FULL)
  } catch (e) {
    if (e instanceof SourceError && e.status === 400 && /column|42703/i.test(e.message)) return q(ITEM_COLS)
    throw e
  }
}

export async function getFurnitureProject(id: string): Promise<SourceResult<FurnitureProjectDetail> | null> {
  if (!uuid.safeParse(id).success) return null
  const { supabaseUrl, supabaseKey, missing } = conn()
  if (missing.length) return notConfigured(missing)
  const r = await readOnce(`furniture:project:${id}`, 'Furniture-Collect Supabase: projects, apartments, items', async () => {
    const h = headers(supabaseKey!)
    const base = `${supabaseUrl}/rest/v1`
    const [p, a, i, b] = await Promise.all([
      // select=* for the same reason: street/building_numbers postdate some databases.
      fetchJson(`${base}/projects?select=*&id=eq.${id}`, { headers: h }),
      // select=* so a database with or without the entrance column both answer (PostgREST fails a query naming a missing column).
      fetchJson(`${base}/apartments?select=*&project_id=eq.${id}&order=building_number.asc,apartment_number.asc&limit=1000`, { headers: h }),
      fetchItems(base, h, id),
      fetchJson(`${base}/project_buildings?select=building_number&project_id=eq.${id}&limit=500`, { headers: h }).catch(() => ({ data: [], latencyMs: 0 })),
    ]).catch((e) => withHint(e, furnitureHint))
    const rows = z.array(project).parse(p.data)
    if (!rows.length) throw new SourceError('project not found', 404, null)
    const items = z.array(item).parse(i.data)
    return {
      data: {
        project: rows[0]!,
        apartments: z.array(apartment.passthrough()).parse(a.data),
        items,
        itemsCapped: items.length >= ITEM_CAP,
        buildings: z.array(z.object({ building_number: z.string() })).catch([]).parse(b.data).map((x) => x.building_number),
      },
      latencyMs: Math.max(p.latencyMs, a.latencyMs, i.latencyMs),
    }
  })
  return r.state === 'error' && r.error === 'project not found' ? null : r
}

export type FurnitureWrite<T> = { ok: true; value: T } | { ok: false; conflict: boolean; message: string }

async function patch<T>(table: string, filter: string, body: Record<string, unknown>, parse: (rows: unknown) => T | null): Promise<FurnitureWrite<T>> {
  const { supabaseUrl, supabaseKey, missing } = conn()
  if (missing.length) throw new SourceError(`Furniture is not connected (${missing.join(', ')})`, null, null)
  try {
    const { data } = await fetchJson(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: { ...headers(supabaseKey!), Prefer: 'return=representation' },
      body,
    }).catch((e) => withHint(e, furnitureHint))
    const value = parse(data)
    if (value === null) return { ok: false, conflict: true, message: 'It changed in the field app since this page loaded (or no longer exists). Reload and try again.' }
    return { ok: true, value }
  } catch (e) {
    // 22P02/23xxx (bad enum, constraint) come back as 400/409 from PostgREST: an answer, not an outage.
    if (e instanceof SourceError && (e.status === 400 || e.status === 409)) return { ok: false, conflict: false, message: e.message.replace(/^HTTP \d+: /, '') }
    throw e
  } finally {
    invalidate('furniture:')
  }
}

export function setProjectArchived(id: string, archived: boolean) {
  uuid.parse(id)
  return patch('projects', `id=eq.${id}`, { archived }, (d) => {
    const rows = z.array(z.object({ id: z.string(), archived: z.boolean().nullable() })).parse(d)
    return rows[0] ?? null
  })
}

export function setItemDestination(id: string, destination: Destination, expectUpdatedAt: string) {
  uuid.parse(id)
  if (!DESTINATIONS.some((d) => d.id === destination)) throw new Error('unknown destination')
  // updated_at is set by the app's update_items_updated_at trigger; matching it is the "unchanged since loaded" check.
  return patch('items', `id=eq.${id}&updated_at=eq.${encodeURIComponent(expectUpdatedAt)}`, { gallery_type: destination }, (d) => {
    const rows = z.array(item).parse(d)
    return rows[0] ?? null
  })
}

const itemHit = z.object({ id: z.string(), project_id: z.string(), apartment_id: z.string().nullable(), description: z.string(), gallery_type: z.string().nullable(), status: z.string().nullable() })
export type FurnitureItemHit = z.infer<typeof itemHit>

/**
 * Items across every project whose description contains the query's longest
 * word (PostgREST ilike). The caller still matches every word, Hebrew-aware.
 * Characters PostgREST treats as syntax are stripped, never escaped by hand.
 */
export async function searchFurnitureItems(query: string): Promise<SourceResult<FurnitureItemHit[]>> {
  const { supabaseUrl, supabaseKey, missing } = conn()
  if (missing.length) return notConfigured(missing)
  const word = query.split(/\s+/).map((w) => w.replace(/[*%,.()":\\]/g, '')).sort((a, b) => b.length - a.length)[0] ?? ''
  if (word.length < 2) return { state: 'ok', data: [], checkedAt: new Date().toISOString(), source: 'Furniture-Collect Supabase: items', latencyMs: 0 }
  return readOnce(`furniture:items:search:${word}`, 'Furniture-Collect Supabase: items', async () => {
    const { data, latencyMs } = await fetchJson(
      `${supabaseUrl}/rest/v1/items?select=id,project_id,apartment_id,description,gallery_type,status&description=ilike.${encodeURIComponent(`*${word}*`)}&order=created_at.desc&limit=200`,
      { headers: headers(supabaseKey!) },
    ).catch((e) => withHint(e, furnitureHint))
    return { data: z.array(itemHit).parse(data), latencyMs }
  })
}
