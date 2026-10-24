import 'server-only'
import { env } from '@/lib/env'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { fromCall, type Probe } from './probe'

/**
 * JAS Volunteers: the Command Center's own read of the 0005 tables, and the
 * standalone volunteer app's /api/health (a separate Vercel project, so the
 * Command Center deploy being green says nothing about it). Counts only.
 */
export async function probeVolunteers(now = new Date()): Promise<Probe[]> {
  const store = getVolunteerStore()
  const tables = fromCall('volunteers', 'Volunteers, activities, shifts (migration 0005)', async () => {
    const [vols, acts, shifts, failed] = await Promise.all([
      store.listVolunteers({ statuses: ['active'] }),
      store.listActivities({ statuses: ['published'] }),
      store.listShifts({ from: now.toISOString(), to: new Date(now.getTime() + 14 * 86_400_000).toISOString() }),
      store.listOutbox({ statuses: ['failed'], since: new Date(now.getTime() - 7 * 86_400_000).toISOString(), limit: 5000 }),
    ])
    if (failed.length) throw new Error(`${failed.length} volunteer emails failed in 7 days`)
    return `${vols.length} active volunteers, ${acts.length} published activities, ${shifts.length} shifts in the next 14 days, 0 failed emails in 7 days`
  }).then((p): Probe => (p.state === 'error' && /0005_volunteers/.test(p.detail) ? { ...p, state: 'not_configured', detail: 'run 0005_volunteers.sql' } : p))

  const base = env().volunteers.appUrl
  const app: Promise<Probe> = !base
    ? Promise.resolve({ section: 'volunteers', name: 'Volunteer app (/api/health)', state: 'not_configured', latencyMs: null, detail: 'needs VOLUNTEER_APP_URL on the Command Center' })
    : fromCall('volunteers', 'Volunteer app (/api/health)', async () => {
        const r = await fetch(`${base}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
        const body = (await r.json().catch(() => null)) as { ok?: boolean; database?: string; error?: string; missing?: string[]; email?: string; commit?: string | null } | null
        if (!body || typeof body.database !== 'string') throw new Error(`HTTP ${r.status}, not the volunteer app's health response`)
        const line = `database ${body.database}${body.error ? ` (${body.error})` : ''}, email ${body.email ?? '?'}, commit ${body.commit ?? 'unknown'}${body.missing?.length ? `, missing ${body.missing.join(', ')}` : ''}`
        if (!body.ok) throw new Error(line)
        return line
      })

  return Promise.all([tables, app])
}
