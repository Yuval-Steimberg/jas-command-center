import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, probe, SourceError, withHint } from '../http'
import { notConfigured, readSource } from '../read'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'

/**
 * Furniture-Collect lives in its own Supabase project. We read through
 * PostgREST, only from `projects` and the `project_summary_counts` view the app
 * itself uses for its project list — the same definitions as the field app.
 *
 * Mass, diversion and CO₂ are deliberately NOT computed here: Furniture-Collect
 * rules that src/lib/reports/kpis.ts is the only place such a figure may be
 * defined. Those numbers stay in the app's own reports until it exposes them.
 */
const project = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  developer_name: z.string().nullable(),
  start_date: z.string().nullable(),
  archived: z.boolean(),
  created_at: z.string(),
})
const counts = z.object({
  project_id: z.string(),
  apartment_count: z.number().int(),
  completed_count: z.number().int(),
  items_total: z.number().int(),
  items_to_collect: z.number().int(),
  items_collected: z.number().int(),
})

export interface FurnitureProject extends z.infer<typeof project> {
  apartments: number
  apartmentsCompleted: number
  items: number
  itemsToCollect: number
  itemsCollected: number
}

export function headers(key: string): Record<string, string> {
  // Legacy keys are JWTs and go in Authorization too; the newer sb_secret_ keys go in apikey only.
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
}

export function furnitureHint(e: SourceError): string | null {
  if (e.status === 401 || e.status === 403) return 'FURNITURE_SUPABASE_KEY is not a key of this project (use its service role / secret key)'
  if (e.status === 404 && /invalid path/i.test(e.message)) return 'FURNITURE_SUPABASE_URL must be the Furniture-Collect project URL, https://<ref>.supabase.co, from Supabase → Project Settings → API'
  if (e.status === 404) return 'The projects table or the project_summary_counts view is missing: check FURNITURE_SUPABASE_URL points at the Furniture-Collect project, not another one'
  return null
}

export async function getFurnitureProjects(): Promise<SourceResult<FurnitureProject[]>> {
  const { supabaseUrl, supabaseKey } = env().furniture
  const missing = [!supabaseUrl && 'FURNITURE_SUPABASE_URL', !supabaseKey && 'FURNITURE_SUPABASE_KEY'].filter(Boolean) as string[]
  if (missing.length) return notConfigured(missing)
  return readSource('furniture:projects', 60_000, 'Furniture-Collect Supabase: projects + project_summary_counts', async () => {
    const h = headers(supabaseKey!)
    const [p, c] = await Promise.all([
      fetchJson(`${supabaseUrl}/rest/v1/projects?select=id,name,city,developer_name,start_date,archived,created_at&order=created_at.desc&limit=500`, { headers: h }),
      fetchJson(`${supabaseUrl}/rest/v1/project_summary_counts?select=*&limit=500`, { headers: h }),
    ]).catch((e) => withHint(e, furnitureHint))
    const projects = z.array(project).parse(p.data)
    const byId = new Map(z.array(counts).parse(c.data).map((r) => [r.project_id, r]))
    const data = projects.map((x) => {
      const k = byId.get(x.id)
      return {
        ...x,
        apartments: k?.apartment_count ?? 0,
        apartmentsCompleted: k?.completed_count ?? 0,
        items: k?.items_total ?? 0,
        itemsToCollect: k?.items_to_collect ?? 0,
        itemsCollected: k?.items_collected ?? 0,
      }
    })
    return { data, latencyMs: Math.max(p.latencyMs, c.latencyMs) }
  })
}

export const furnitureAdapter: IntegrationAdapter = {
  product: 'furniture',
  name: 'Furniture collection',
  description: 'Furniture-Collect field app (Vercel) on its own Supabase project.',
  config() {
    const e = env().furniture
    return {
      required: ['FURNITURE_SUPABASE_URL', 'FURNITURE_SUPABASE_KEY'],
      missing: [!e.supabaseUrl && 'FURNITURE_SUPABASE_URL', !e.supabaseKey && 'FURNITURE_SUPABASE_KEY'].filter(Boolean) as string[],
      optional: ['FURNITURE_APP_URL'],
    }
  },
  capabilities: () => [
    { id: 'projects', label: 'Projects, apartments mapped/completed, items recorded/collected', kind: 'read', status: 'available' },
    { id: 'inventory', label: 'Per project: apartments, items, destination, collected and by whom', kind: 'read', status: 'available', note: 'Photos stay in the field app (private storage).' },
    { id: 'archive', label: 'Archive / unarchive a project', kind: 'write', status: 'available', note: 'The same column update as the app’s ⋮ menu.' },
    { id: 'destination', label: 'Move an item between JAS / third party / donation / documentation', kind: 'write', status: 'available', note: 'Conditional on updated_at; the app’s trigger keeps the collection flag in step.' },
    { id: 'impact', label: 'Mass, diversion (planned vs confirmed), CO₂', kind: 'read', status: 'needs_source_change', note: 'Only src/lib/reports/kpis.ts may compute these; needs the app to expose its KPI output.' },
    { id: 'reports', label: 'Impact / ESG reports (PDF)', kind: 'read', status: 'available', note: 'Opens the app’s own /reports pages.' },
    { id: 'collect', label: 'Tick items collected, finish an apartment, confirm a handover', kind: 'write', status: 'not_built', note: 'These carry the collector’s name and the app’s completion rules, which live in the app’s client code. Done in the field app.' },
  ],
  async health() {
    const e = env().furniture
    const checks: HealthCheck[] = []
    if (e.appUrl) {
      const p = await probe(e.appUrl)
      checks.push({ name: 'Field app', status: p.ok ? 'operational' : 'down', detail: p.ok ? `HTTP ${p.status}` : (p.error ?? `HTTP ${p.status}`), checkedAt: new Date().toISOString(), latencyMs: p.latencyMs })
    } else checks.push({ name: 'Field app', status: 'unknown', detail: 'FURNITURE_APP_URL not set', checkedAt: null, latencyMs: null })
    const r = await getFurnitureProjects()
    if (r.state === 'not_configured') checks.push({ name: 'Database', status: 'unknown', detail: `needs ${r.missing.join(', ')}`, checkedAt: null, latencyMs: null })
    else if (r.state === 'error') checks.push({ name: 'Database', status: 'down', detail: r.error, checkedAt: r.checkedAt, latencyMs: r.latencyMs })
    else checks.push({ name: 'Database', status: 'operational', detail: `${r.data.length} projects readable`, checkedAt: r.checkedAt, latencyMs: r.latencyMs })
    return { product: 'furniture', status: rollup(checks), checks }
  },
}
