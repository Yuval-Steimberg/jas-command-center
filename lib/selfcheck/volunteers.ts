import 'server-only'
import { env } from '@/lib/env'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
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

  // The weekly schedule (0011): its days exist and someone is allowed to run them. Counts only.
  const schedule: Promise<Probe> = authMode().kind !== 'supabase'
    ? Promise.resolve({ section: 'volunteers', name: 'Volunteer schedule (migration 0011)', state: 'not_configured', latencyMs: null, detail: 'no database in this mode' })
    : fromCall('volunteers', 'Volunteer schedule (migration 0011)', async () => {
        const db = supabaseAdmin()
        const [slots, admins] = await Promise.all([
          db.from('cc_vol_slots').select('id, required').eq('active', true),
          db.from('cc_vol_location_admins').select('location_id', { count: 'exact', head: true }),
        ])
        const err = slots.error ?? admins.error
        if (err) throw new Error(/does not exist|schema cache|PGRST205/i.test(err.message) ? 'run 0011_volunteer_schedule.sql' : err.message)
        const days = slots.data ?? []
        const set = days.filter((d) => d.required !== null).length
        return `${days.length} operating days (required set on ${set}), ${admins.count ?? 0} scheduler grant(s)`
      }).then((p): Probe => (p.state === 'error' && /0011/.test(p.detail) ? { ...p, state: 'not_configured' } : p))

  // Location managers, reminders, reservists (0012). Counts only.
  const access: Promise<Probe> = authMode().kind !== 'supabase'
    ? Promise.resolve({ section: 'volunteers', name: 'Volunteer schedule access + reminders (migration 0012)', state: 'not_configured', latencyMs: null, detail: 'no database in this mode' })
    : fromCall('volunteers', 'Volunteer schedule access + reminders (migration 0012)', async () => {
        const db = supabaseAdmin()
        const [grants, reminders] = await Promise.all([
          db.from('cc_vol_location_admins').select('access'),
          db.from('cc_vol_reminders').select('id', { count: 'exact', head: true }),
        ])
        const err = grants.error ?? reminders.error
        if (err) throw new Error(/does not exist|schema cache|PGRST205|42703/i.test(err.message) ? 'run 0012_volunteer_schedule_access.sql' : err.message)
        const g = (grants.data ?? []) as { access: string }[]
        return `${g.filter((x) => x.access !== 'view').length} scheduler(s), ${g.filter((x) => x.access === 'view').length} location manager(s), ${reminders.count ?? 0} reminder(s) sent`
      }).then((p): Probe => (p.state === 'error' && /0012/.test(p.detail) ? { ...p, state: 'not_configured' } : p))

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

  return Promise.all([tables, app, schedule, access])
}
