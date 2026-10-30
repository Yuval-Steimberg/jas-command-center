import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, SourceError } from '../http'
import { invalidate } from '../cache'
import { notConfigured, readOnce, readSource } from '../read'
import type { SourceResult } from '../types'

/**
 * The field app's own endpoint (Furniture-Collect `api/command-center.js`):
 * report KPIs computed by its `projectKpis`, and the four field writes built
 * by the same modules its screens use. Nothing here computes a mass, a rate or
 * a completion rule — the command center only shows and forwards.
 */

const mass = z.object({ kg: z.number(), itemCount: z.number(), units: z.number(), estimated_kg: z.number(), estimatedShare: z.number() })
const destinationTotal = z.object({ destination: z.string(), labelHe: z.string(), labelEn: z.string(), mass: mass.nullable(), unavailableReason: z.string().optional() })
const totals = z.object({ basis: z.enum(['planned', 'confirmed']), byDestination: z.array(destinationTotal), total: mass, incomplete: z.array(z.string()) })
const carbon = z.object({ co2e_kg: z.number(), estimatedShare: z.number() })

export const kpiContract = z.object({
  ok: z.literal(true),
  itemCount: z.number().int(),
  kpis: z.object({ documented: mass, undocumentedDestination: mass, planned: totals, confirmed: totals, confirmedCarbon: carbon, plannedCarbon: carbon }),
  diversionRate: z.object({ planned: z.number().nullable(), confirmed: z.number().nullable() }),
  headline: z.object({ basis: z.enum(['planned', 'confirmed']), isConfirmed: z.boolean(), isPartial: z.boolean() }),
  handoverAvailable: z.boolean(),
  missingColumns: z.array(z.string()),
})
export type FurnitureKpis = z.infer<typeof kpiContract>

function endpoint() {
  const { appUrl, commandKey } = env().furniture
  const missing = [!appUrl && 'FURNITURE_APP_URL', !commandKey && 'FURNITURE_COMMAND_CENTER_KEY'].filter(Boolean) as string[]
  return { url: appUrl ? `${appUrl}/api/command-center` : null, key: commandKey, missing }
}

function hint(e: SourceError): string | null {
  if (e.status === 404) return 'The field app has no command-center endpoint: deploy Furniture-Collect PR #29 and set COMMAND_CENTER_API_KEY there'
  if (e.status === 401) return 'FURNITURE_COMMAND_CENTER_KEY does not match the field app\'s COMMAND_CENTER_API_KEY'
  return null
}

export async function getFurnitureKpis(projectId: string): Promise<SourceResult<FurnitureKpis>> {
  const { url, key, missing } = endpoint()
  if (missing.length) return notConfigured(missing, 'Mass, diversion and CO₂ come from the field app itself.')
  return readSource(`furniture:kpis:${projectId}`, 60_000, 'Furniture-Collect /api/command-center (projectKpis)', async () => {
    try {
      const r = await fetchJson(`${url}?action=kpis&project=${encodeURIComponent(projectId)}`, { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 15_000 })
      return { data: kpiContract.parse(r.data), latencyMs: r.latencyMs }
    } catch (e) {
      if (e instanceof SourceError) {
        const h = hint(e)
        if (h) throw new SourceError(`${e.message} (${h})`, e.status, e.latencyMs)
      }
      throw e
    }
  })
}

export type FieldAction =
  | { action: 'collect'; itemId: string; collected: boolean; expectUpdatedAt: string }
  | { action: 'finish_apartment'; apartmentId: string; confirmOutstanding?: boolean }
  | { action: 'reopen_apartment'; apartmentId: string }
  | { action: 'handover'; itemId: string; confirm: boolean; recipient?: string | null; expectUpdatedAt: string }

export type FieldResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number | null; error: string; body: Record<string, unknown> }

const MESSAGES: Record<string, string> = {
  changed_since_loaded: 'It changed in the field app since this page loaded. Reload and try again.',
  needs_confirmation: 'Items are still waiting for collection. Confirm to finish anyway.',
  nothing_documented: 'Nothing has been documented in this apartment yet, so it cannot be finished.',
  not_third_party: 'Only items going to a third party have a handover.',
  handover_unavailable: 'The field app\'s database does not have the handover columns yet (migration 20260914000000).',
  item_not_found: 'That item no longer exists.',
  apartment_not_found: 'That apartment no longer exists.',
  unauthorized: 'FURNITURE_COMMAND_CENTER_KEY does not match the field app.',
  not_found: 'The field app has no command-center endpoint yet (deploy it and set COMMAND_CENTER_API_KEY).',
  unknown_action: 'The field app does not know this action yet: deploy the latest Furniture-Collect main.',
  no_field_account: 'You have no active account in the field app with this email, so nothing can be recorded in your name. Add yourself in the field app’s user management first.',
  needs_migration: 'The field app’s database needs migration 20261030000000_command_center_writes.sql first (run it in the furniture Supabase SQL editor).',
  apartment_has_items: 'This apartment has items, so it cannot be deleted. Only an empty apartment can be deleted, as in the field app.',
  building_has_items: 'An apartment in this building has items, so the building cannot be deleted.',
  duplicate_apartment: 'That apartment number already exists in this building and entrance.',
  duplicate_building: 'A building with that number already exists in this project.',
  delete_refused: 'The field app kept some of these items: they were not deleted.',
  description_required: 'An item needs a description.',
  nothing_to_add: 'There was nothing to add in that text.',
  too_many_items: 'Too many items in one go: add at most 200 at a time.',
  name_required: 'A project needs a name.',
  invalid_structure: 'The buildings are not valid.',
  scaffold_incomplete: 'The project was created but not all of its buildings and apartments were. Open it and add the rest.',
  already_member: 'That person is already on this project.',
  not_a_member: 'That person is not on this project.',
  project_not_found: 'That project no longer exists.',
  insert_refused: 'The field app’s database refused it.',
  update_refused: 'The field app’s database refused it.',
  invalid_input: 'Invalid request.',
}
export const fieldMessage = (error: string) => MESSAGES[error] ?? `The field app refused it (${error}).`

/** One write. Never retried: a 409 is an answer, and a write repeated after a timeout could double-apply. */
export async function runFieldAction(input: FieldAction, actor: { email: string; name?: string }): Promise<FieldResult> {
  return runFieldOp(input.action, input, actor)
}

/**
 * Any POST action of the field app's endpoint (src/server/manage.ts there).
 * The endpoint validates every field; this side only forwards. 60 s for the
 * photo description, which waits on the vision model.
 */
export async function runFieldOp(action: string, payload: Record<string, unknown>, actor: { email: string; name?: string }): Promise<FieldResult> {
  const { url, key, missing } = endpoint()
  if (missing.length) return { ok: false, status: null, error: 'not_configured', body: { missing } }
  try {
    const res = await fetch(url!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...payload, action, actor }),
      signal: AbortSignal.timeout(action === 'describe_photo' ? 60_000 : 20_000),
      cache: 'no-store',
    })
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      /* not JSON */
    }
    if (res.ok && body.ok === true) return { ok: true, body }
    return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : `http_${res.status}`, body }
  } finally {
    invalidate('furniture:')
  }
}

// ── Reads the forms are built from ──────────────────────────────────────

const pair = z.object({ id: z.string(), label: z.string() })
export const optionsContract = z.object({
  ok: z.literal(true),
  destinations: z.array(z.object({ id: z.string(), galleryType: z.string(), label: z.string() })),
  itemTypes: z.array(pair),
  materials: z.array(pair),
  conditions: z.array(pair),
  difficulties: z.array(pair),
  categories: z.array(z.string()),
  identityFields: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(['text', 'number', 'date', 'multiline']), section: z.string() })),
  projectRoles: z.array(pair),
  limits: z.object({ maxBuildings: z.number(), maxApartmentsPerEntrance: z.number(), maxBatch: z.number() }),
})
export type FieldOptions = z.infer<typeof optionsContract>

const nul = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional()
export const itemContract = z.object({
  id: z.string(),
  project_id: nul(z.string()),
  apartment_id: nul(z.string()),
  updated_at: z.string(),
  description: z.string(),
  item_category: nul(z.string()),
  quantity: nul(z.number()),
  location: nul(z.string()),
  item_type: nul(z.string()),
  material_category: nul(z.string()),
  gallery_type: nul(z.string()),
  dimensions: nul(z.string()),
  estimated_weight_kg: nul(z.union([z.number(), z.string()])),
  condition: nul(z.string()),
  dismantle_difficulty: nul(z.string()),
  notes: nul(z.string()),
  image_url: nul(z.string()),
  photo_urls: z.array(z.string()).catch([]),
  collected: nul(z.boolean()),
  collected_by: nul(z.string()),
  source: nul(z.string()),
})
export type FieldItemDetail = z.infer<typeof itemContract>

export const membersContract = z.object({
  members: z.array(z.object({ userId: z.string(), role: z.string(), name: z.string().nullable(), email: z.string().nullable(), active: z.boolean() })),
  candidates: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string().nullable() })),
})
export type FieldMembers = z.infer<typeof membersContract>

async function getEndpoint<T>(cacheKey: string, ttl: number, query: string, parse: (d: unknown) => T): Promise<SourceResult<T>> {
  const { url, key, missing } = endpoint()
  if (missing.length) return notConfigured(missing, 'Editing goes through the field app’s own endpoint.')
  const load = async () => {
    try {
      const r = await fetchJson(`${url}?${query}`, { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 15_000 })
      return { data: parse(r.data), latencyMs: r.latencyMs }
    } catch (e) {
      if (e instanceof SourceError) {
        const h = hint(e)
        if (h) throw new SourceError(`${e.message} (${h})`, e.status, e.latencyMs)
      }
      throw e
    }
  }
  const source = 'Furniture-Collect /api/command-center'
  return ttl ? readSource(cacheKey, ttl, source, load) : readOnce(cacheKey, source, load)
}

/** Labels and enums, from the field app (10 min): the command center keeps no copy. */
export const getFieldOptions = () => getEndpoint('furniture:options', 600_000, 'action=options', (d) => optionsContract.parse(d))
export const getFieldItem = (id: string) =>
  getEndpoint(`furniture:item:${id}`, 0, `action=item&id=${encodeURIComponent(id)}`, (d) => itemContract.parse((d as { item: unknown }).item))
export const getFieldProjectIdentity = (id: string) =>
  getEndpoint(`furniture:identity:${id}`, 0, `action=project&project=${encodeURIComponent(id)}`, (d) => z.record(z.string()).parse((d as { identity: unknown }).identity))
export const getFieldMembers = (id: string) => getEndpoint(`furniture:members:${id}`, 0, `action=members&project=${encodeURIComponent(id)}`, (d) => membersContract.parse(d))
