import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, withHint } from '../http'
import type { DateRange } from '@/lib/time'
import { invalidate } from '../cache'
import { notConfigured, readSource } from '../read'
import { rollup, type HealthCheck, type IntegrationAdapter, type SourceResult } from '../types'

/**
 * whatssup-bot is the JAS Design Agent: an owner-only designer on WhatsApp /
 * Telegram, not a customer messaging bot. Its operational surface is the job
 * queue, failed sends and design projects — that is what we read.
 */
const healthz = z.object({
  ok: z.boolean(),
  version: z.object({ commit: z.string(), branch: z.string().nullable().optional(), started_at: z.union([z.string(), z.number()]).nullable().optional() }).passthrough().optional(),
  jobs: z.record(z.string(), z.number()),
  stuck: z.number(),
})
export type DesignAgentHealthz = z.infer<typeof healthz>

const status = z.object({
  jobs: z.array(z.object({ type: z.string(), status: z.string(), c: z.number() })),
  dead: z.array(z.object({ id: z.number(), type: z.string(), attempts: z.number(), err: z.string().nullable(), updated_at: z.number() })),
  projects: z.array(z.object({ id: z.number(), title: z.string().nullable(), kind: z.string().nullable(), status: z.string(), current_version: z.number().nullable(), updated_at: z.number() })),
  outbound_failed: z.array(z.object({ id: z.number(), kind: z.string(), wamid: z.string().nullable(), error: z.string().nullable(), created_at: z.number() })),
}).passthrough()
export type DesignAgentStatus = z.infer<typeof status>

export async function getDesignAgentHealthz(): Promise<SourceResult<DesignAgentHealthz>> {
  const { url } = env().designAgent
  if (!url) return notConfigured(['DESIGN_AGENT_URL'])
  return readSource('agent:healthz', 30_000, 'Design agent /healthz', async () => {
    // /healthz answers 503 (with the same body) when jobs are stuck; read it rather than treat it as unreachable.
    const started = performance.now()
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    const latencyMs = Math.round(performance.now() - started)
    if (res.status !== 200 && res.status !== 503) throw new Error(`HTTP ${res.status}`)
    return { data: healthz.parse(await res.json()), latencyMs }
  })
}

export async function getDesignAgentStatus(): Promise<SourceResult<DesignAgentStatus>> {
  const { url, adminToken } = env().designAgent
  const missing = [!url && 'DESIGN_AGENT_URL', !adminToken && 'DESIGN_AGENT_ADMIN_TOKEN'].filter(Boolean) as string[]
  if (missing.length) return notConfigured(missing, 'DESIGN_AGENT_ADMIN_TOKEN is the bot’s ADMIN_TOKEN (Railway variables).')
  return readSource('agent:status', 30_000, 'Design agent /admin/status', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/admin/status`, { headers: { Authorization: `Bearer ${adminToken}` } })
    return { data: status.parse(data), latencyMs }
  })
}

const activityCounts = {
  ownerMessages: z.number().int(),
  jobs: z.number().int(),
  jobsDone: z.number().int(),
  jobsDead: z.number().int(),
  projects: z.number().int(),
  versions: z.number().int(),
  versionsApproved: z.number().int(),
  messagesSent: z.number().int(),
  messagesFailed: z.number().int(),
}
const activity = z.object({
  version: z.literal(1),
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  totals: z.object(activityCounts),
  daily: z.array(z.object({ date: z.string(), ...activityCounts })),
  jobsByType: z.array(z.object({ type: z.string(), jobs: z.number().int(), done: z.number().int(), dead: z.number().int() })),
})
export type DesignAgentActivity = z.infer<typeof activity>

/** Daily activity counts for one range (GET /admin/activity, whatssup-bot PR #39). Counts only. */
export async function getDesignAgentActivity(range: DateRange): Promise<SourceResult<DesignAgentActivity>> {
  const { url, adminToken } = env().designAgent
  const missing = [!url && 'DESIGN_AGENT_URL', !adminToken && 'DESIGN_AGENT_ADMIN_TOKEN'].filter(Boolean) as string[]
  if (missing.length) return notConfigured(missing)
  const qs = new URLSearchParams({ from: range.from, to: range.to })
  return readSource(`agent:activity:${range.from}:${range.to}`, 60_000, 'Design agent /admin/activity', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/admin/activity?${qs}`, { headers: { Authorization: `Bearer ${adminToken}` } }).catch((e) =>
      withHint(e, (x) => (x.status === 404 ? 'The running bot predates /admin/activity (whatssup-bot PR #39): redeploy it on Railway' : null)),
    )
    return { data: activity.parse(data), latencyMs }
  })
}

const osSummary = z.union([
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    approvals: z.object({
      pending: z.array(z.object({ id: z.number(), agent: z.string(), action: z.string(), level: z.number(), summary: z.string().nullable(), created_at: z.number() })),
      counts: z.record(z.string(), z.number()),
    }),
    automations: z.object({
      enabled_globally: z.boolean(),
      list: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          kind: z.string(),
          enabled: z.boolean(),
          last_run_at: z.number().nullable(),
          next_run_at: z.number().nullable(),
          last_status: z.string().nullable(),
          last_error: z.string().nullable(),
        }),
      ),
    }),
    costs: z.object({
      since: z.number(),
      total_usd: z.number(),
      calls: z.number(),
      by_source: z.array(z.object({ source: z.string(), agent: z.string(), calls: z.number(), usd: z.number().nullable() })),
      budget_usd: z.number().nullable(),
      budget_used_pct: z.number().nullable(),
      note: z.string(),
    }),
  }),
])
export type DesignAgentOs = z.infer<typeof osSummary>

/**
 * The bot's business OS: pending manager approvals, automations and this month's
 * AI cost (GET /admin/os, whatssup-bot). Read-only: approvals are decided in the
 * bot's own Control Center, where the hash binding and execution live.
 */
export async function getDesignAgentOs(): Promise<SourceResult<DesignAgentOs>> {
  const { url, adminToken } = env().designAgent
  const missing = [!url && 'DESIGN_AGENT_URL', !adminToken && 'DESIGN_AGENT_ADMIN_TOKEN'].filter(Boolean) as string[]
  if (missing.length) return notConfigured(missing)
  return readSource('agent:os', 60_000, 'Design agent /admin/os', async () => {
    const { data, latencyMs } = await fetchJson(`${url}/admin/os`, { headers: { Authorization: `Bearer ${adminToken}` } }).catch((e) =>
      withHint(e, (x) => (x.status === 404 ? 'The running bot predates /admin/os: redeploy it on Railway' : null)),
    )
    return { data: osSummary.parse(data), latencyMs }
  })
}

/** Re-queue one dead job through the bot's own endpoint. Returns what the bot confirmed. */
export async function retryDeadJob(jobId: number): Promise<{ retried: boolean }> {
  const { url, adminToken } = env().designAgent
  if (!url || !adminToken) throw new Error('Design agent is not configured')
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('Invalid job id')
  const res = await fetch(`${url}/admin/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  // 404 = the job is not dead any more (already retried or never existed): a real answer, not an error.
  if (res.status !== 200 && res.status !== 404) throw new Error(`Design agent answered HTTP ${res.status}`)
  const body = z.object({ retried: z.boolean() }).parse(await res.json())
  invalidate('agent:')
  return body
}

export const designAgentAdapter: IntegrationAdapter = {
  product: 'design_agent',
  name: 'Design agent (WhatsApp / Telegram)',
  description: 'whatssup-bot on Railway: the owner’s design agent and optional AI business OS.',
  config() {
    const e = env().designAgent
    return {
      required: ['DESIGN_AGENT_URL'],
      missing: [!e.url && 'DESIGN_AGENT_URL', !e.adminToken && 'DESIGN_AGENT_ADMIN_TOKEN'].filter(Boolean) as string[],
      optional: ['DESIGN_AGENT_ADMIN_TOKEN'],
    }
  },
  capabilities: () => [
    { id: 'health', label: 'Queue health, stuck jobs, running commit', kind: 'read', status: 'available' },
    { id: 'status', label: 'Dead jobs, failed outbound messages, recent design projects', kind: 'read', status: 'available' },
    { id: 'retry', label: 'Retry a dead job', kind: 'write', status: 'available' },
    { id: 'os', label: 'Manager approvals, automations, AI cost', kind: 'read', status: 'available', note: 'Read-only (GET /admin/os). Approvals are decided in the bot’s own Control Center.' },
    { id: 'inbox', label: 'Customer conversation inbox, assignment, templates', kind: 'read', status: 'unsupported', note: 'The bot only talks to allowlisted owner numbers. A customer inbox would be a new WhatsApp product.' },
  ],
  async health() {
    const checks: HealthCheck[] = []
    const [h, s] = await Promise.all([getDesignAgentHealthz(), getDesignAgentStatus()])
    if (h.state === 'not_configured') checks.push({ name: 'Service', status: 'unknown', detail: 'DESIGN_AGENT_URL not set', checkedAt: null, latencyMs: null })
    else if (h.state === 'error') checks.push({ name: 'Service', status: 'down', detail: h.error, checkedAt: h.checkedAt, latencyMs: h.latencyMs })
    else
      checks.push({
        name: 'Service',
        status: h.data.stuck ? 'degraded' : 'operational',
        detail: h.data.stuck ? `${h.data.stuck} job(s) queued for over 10 minutes` : `commit ${h.data.version?.commit ?? '?'}`,
        checkedAt: h.checkedAt,
        latencyMs: h.latencyMs,
      })
    if (s.state === 'not_configured') checks.push({ name: 'Jobs & delivery', status: 'unknown', detail: `needs ${s.missing.join(', ')}`, checkedAt: null, latencyMs: null })
    else if (s.state === 'error') checks.push({ name: 'Jobs & delivery', status: 'down', detail: s.error, checkedAt: s.checkedAt, latencyMs: s.latencyMs })
    else {
      const bad = s.data.dead.length + s.data.outbound_failed.length
      checks.push({
        name: 'Jobs & delivery',
        status: bad ? 'degraded' : 'operational',
        detail: bad ? `${s.data.dead.length} dead job(s), ${s.data.outbound_failed.length} failed send(s) (latest 20)` : 'no dead jobs or failed sends',
        checkedAt: s.checkedAt,
        latencyMs: s.latencyMs,
      })
    }
    return { product: 'design_agent', status: rollup(checks), checks }
  },
}
