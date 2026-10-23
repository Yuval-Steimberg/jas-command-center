import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, withHint } from '../http'
import { notConfigured, readOnce } from '../read'
import type { SourceResult } from '../types'
import { furnitureHint, headers } from './adapter'

/**
 * Items ready to enter inventory: destination JAS (`gallery_type =
 * jas_collection`) AND ticked collected in the field app — the crew has them
 * on the truck. Read with select=* so older and newer field databases both
 * answer (PostgREST fails a whole query that names a missing column). Read
 * only: intake never writes to the field app; its record stays the
 * authority for what was collected, where and by whom.
 */
const fieldItem = z
  .object({
    id: z.string(),
    project_id: z.string(),
    apartment_id: z.string().nullable(),
    description: z.string(),
    quantity: z.number().int().nullable().catch(1),
    gallery_type: z.string().nullable(),
    collected: z.boolean().nullable(),
    collected_at: z.string().nullable().optional(),
    collected_by: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    dimensions: z.string().nullable().optional(),
    estimated_weight_kg: z.number().nullable().optional(),
    material_category: z.string().nullable().optional(),
    item_category: z.string().nullable().optional(),
    image_url: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    updated_at: z.string(),
  })
  .passthrough()
export type FieldItem = z.infer<typeof fieldItem>

const apartment = z.object({ id: z.string(), building_number: z.string().nullable(), apartment_number: z.string().nullable(), entrance: z.string().nullable().optional() }).passthrough()
const project = z.object({ id: z.string(), name: z.string() }).passthrough()

export interface IntakeCandidate extends FieldItem {
  projectName: string
  apartmentLabel: string | null
}

const SOURCE = 'Furniture-Collect Supabase: items (JAS + collected)'
const uuid = z.string().uuid()

export function apartmentLabel(a: z.infer<typeof apartment> | undefined): string | null {
  if (!a) return null
  return [a.building_number && `בניין ${a.building_number}`, a.entrance && `כניסה ${a.entrance}`, a.apartment_number && `דירה ${a.apartment_number}`].filter(Boolean).join(', ') || null
}

async function enrich(base: string, h: Record<string, string>, items: FieldItem[]): Promise<{ data: IntakeCandidate[]; latencyMs: number }> {
  const pids = [...new Set(items.map((i) => i.project_id))]
  const aids = [...new Set(items.map((i) => i.apartment_id).filter((x): x is string => !!x))]
  if (!items.length) return { data: [], latencyMs: 0 }
  const [p, a] = await Promise.all([
    fetchJson(`${base}/projects?select=id,name&id=in.(${pids.join(',')})`, { headers: h }),
    aids.length ? fetchJson(`${base}/apartments?select=*&id=in.(${aids.join(',')})`, { headers: h }) : Promise.resolve({ data: [], latencyMs: 0 }),
  ])
  const projects = new Map(z.array(project).parse(p.data).map((x) => [x.id, x.name]))
  const apartments = new Map(z.array(apartment).parse(a.data).map((x) => [x.id, x]))
  return {
    data: items.map((i) => ({ ...i, projectName: projects.get(i.project_id) ?? 'Unknown project', apartmentLabel: apartmentLabel(i.apartment_id ? apartments.get(i.apartment_id) : undefined) })),
    latencyMs: Math.max(p.latencyMs, a.latencyMs),
  }
}

function conn() {
  const { supabaseUrl, supabaseKey } = env().furniture
  return { supabaseUrl, supabaseKey, missing: [!supabaseUrl && 'FURNITURE_SUPABASE_URL', !supabaseKey && 'FURNITURE_SUPABASE_KEY'].filter(Boolean) as string[] }
}

/** Newest collected first; up to 500. */
export async function listIntakeCandidates(): Promise<SourceResult<IntakeCandidate[]>> {
  const { supabaseUrl, supabaseKey, missing } = conn()
  if (missing.length) return notConfigured(missing)
  return readOnce('furniture:intake', SOURCE, async () => {
    const h = headers(supabaseKey!)
    const base = `${supabaseUrl}/rest/v1`
    const r = await fetchJson(`${base}/items?select=*&gallery_type=eq.jas_collection&collected=eq.true&order=updated_at.desc&limit=500`, { headers: h }).catch((e) => withHint(e, furnitureHint))
    const e = await enrich(base, h, z.array(fieldItem).parse(r.data)).catch((x) => withHint(x, furnitureHint))
    return { data: e.data, latencyMs: Math.max(r.latencyMs, e.latencyMs) }
  })
}

/** Exactly these field items (re-read at intake time: the page may be stale). */
export async function getFieldItems(ids: string[]): Promise<SourceResult<IntakeCandidate[]>> {
  const { supabaseUrl, supabaseKey, missing } = conn()
  if (missing.length) return notConfigured(missing)
  const clean = [...new Set(ids)].filter((x) => uuid.safeParse(x).success).slice(0, 100)
  return readOnce(`furniture:items:${clean.join(',')}`, SOURCE, async () => {
    if (!clean.length) return { data: [], latencyMs: 0 }
    const h = headers(supabaseKey!)
    const base = `${supabaseUrl}/rest/v1`
    const r = await fetchJson(`${base}/items?select=*&id=in.(${clean.join(',')})`, { headers: h }).catch((e) => withHint(e, furnitureHint))
    const e = await enrich(base, h, z.array(fieldItem).parse(r.data)).catch((x) => withHint(x, furnitureHint))
    return { data: e.data, latencyMs: Math.max(r.latencyMs, e.latencyMs) }
  })
}

/** Why a field item may not enter inventory yet, or null when it may. */
export function intakeBlocker(i: Pick<FieldItem, 'gallery_type' | 'collected'>): string | null {
  if (i.gallery_type !== 'jas_collection') return 'its destination in the field app is not JAS'
  if (!i.collected) return 'it is not ticked collected in the field app yet'
  return null
}
