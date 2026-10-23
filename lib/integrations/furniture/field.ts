import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, SourceError } from '../http'
import { invalidate } from '../cache'
import { notConfigured, readSource } from '../read'
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
}
export const fieldMessage = (error: string) => MESSAGES[error] ?? `The field app refused it (${error}).`

/** One write. Never retried: a 409 is an answer, and a write repeated after a timeout could double-apply. */
export async function runFieldAction(input: FieldAction, actor: { email: string; name?: string }): Promise<FieldResult> {
  const { url, key, missing } = endpoint()
  if (missing.length) return { ok: false, status: null, error: 'not_configured', body: { missing } }
  try {
    const res = await fetch(url!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...input, actor }),
      signal: AbortSignal.timeout(15_000),
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
