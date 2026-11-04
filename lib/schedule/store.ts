import 'server-only'
import { cache } from 'react'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin, supabaseUserClient } from '@/lib/supabase'
import { getSession, type CurrentUser } from '@/lib/auth/session'
import { memoryVolunteerData } from '@/lib/volunteer-store'
import { memoryScheduleStore, seedSchedule, supabaseScheduleStore, type MemorySchedData, type ScheduleStore } from '@/lib/volunteers/schedule-store'
import type { SchedLocation, SchedVolunteer } from '@/lib/volunteers/schedule'
import type { Volunteer } from '@/lib/volunteers/model'

const g = globalThis as unknown as { __ccSchedData?: MemorySchedData }

/** Dev login only: the memory schedule, the dev owner as Sharon's Workshop's scheduler, and a few demo volunteers. */
function devData(email: string): MemorySchedData {
  if (!g.__ccSchedData) {
    g.__ccSchedData = seedSchedule()
    const vd = memoryVolunteerData()
    if (!vd.volunteers.length) {
      const t = new Date().toISOString()
      const names = ['רותי לוי', 'יוסי כהן', 'מיכל אברהם', 'דני פרץ', 'שרה גולן', 'אבי מזרחי', 'נועה בר', 'עמית שמש', 'תמר רז', 'גיל אור']
      names.forEach((fullName, i) => {
        const v: Volunteer = {
          id: crypto.randomUUID(), contactId: null, fullName, email: `demo${i}@example.test`, phone: `05${String(20000000 + i * 1111).padStart(8, '0')}`, adult: true, ageConfirmedAt: t, areas: ['tel_aviv'],
          availability: i % 3 === 0 ? ['mon_morning', 'tue_morning'] : i % 3 === 1 ? ['wed_morning'] : [], skills: [], transport: 'none', about: null, notifyReminders: true, notifyOpportunities: false,
          consentWhatsapp: false, consentAt: t, status: 'active', sessionVersion: 1, source: 'staff', lastSeenAt: null, createdAt: t, updatedAt: t,
        }
        vd.volunteers.push(v)
      })
    }
  }
  const d = g.__ccSchedData
  for (const l of d.locations) if (!d.admins.some((a) => a.locationId === l.id && a.email === email)) d.admins.push({ locationId: l.id, email })
  return d
}

const devVolunteers = (): SchedVolunteer[] => memoryVolunteerData().volunteers.map((v) => ({ id: v.id, fullName: v.fullName, phone: v.phone, availability: v.availability, status: v.status }))

/**
 * The schedule store for the signed-in person. In production it is built over
 * THEIR Supabase session, so the database decides (RLS + auth.uid()) what they
 * may read and change; the command center's service role is never used to
 * schedule anyone.
 */
export function scheduleStoreFor(user: Pick<CurrentUser, 'email'>): ScheduleStore {
  if (authMode().kind === 'supabase') return supabaseScheduleStore(supabaseUserClient())
  return memoryScheduleStore(devData(user.email), { kind: 'admin', email: user.email }, devVolunteers)
}

export interface Scheduler {
  user: CurrentUser
  store: ScheduleStore
  location: SchedLocation
}

/** The signed-in scheduler and their location, or null (not signed in, or schedules nothing). One per request. */
export const currentScheduler = cache(async (): Promise<Scheduler | { error: 'signed_out' | 'not_scheduler' | 'setup'; message?: string }> => {
  const s = await getSession()
  if (!s) return { error: 'signed_out' }
  const store = scheduleStoreFor(s.user)
  try {
    // Phase 1 has one location. A second one would add a picker here, nothing else.
    const [location] = await store.myLocations()
    if (!location) return { error: 'not_scheduler' }
    return { user: s.user, store, location }
  } catch (e) {
    return { error: 'setup', message: e instanceof Error ? e.message : String(e) }
  }
})

// ── Who schedules which location (owner, /settings/staff) ──────────────────

export interface LocationAdmins {
  location: SchedLocation
  admins: { profileId: string; email: string; name: string }[]
}

/** Written with the service role: granting is staff management (users:manage), not scheduling. */
export async function listLocationAdmins(): Promise<LocationAdmins[]> {
  if (authMode().kind !== 'supabase') {
    const d = g.__ccSchedData ?? seedSchedule()
    return d.locations.map((location) => ({ location, admins: d.admins.filter((a) => a.locationId === location.id).map((a) => ({ profileId: a.email, email: a.email, name: a.email })) }))
  }
  const db = supabaseAdmin()
  const [locs, admins] = await Promise.all([
    db.from('cc_vol_locations').select('id, slug, name, active').eq('active', true).order('name'),
    db.from('cc_vol_location_admins').select('location_id, profile_id, cc_profiles!profile_id(email, full_name)'),
  ])
  if (locs.error || admins.error) throw new Error((locs.error ?? admins.error)!.message)
  return (locs.data ?? []).map((l) => ({
    location: l as SchedLocation,
    admins: (admins.data ?? [])
      .filter((a) => a.location_id === l.id)
      .map((a) => {
        const p = (Array.isArray(a.cc_profiles) ? a.cc_profiles[0] : a.cc_profiles) as { email?: string; full_name?: string } | null
        return { profileId: a.profile_id as string, email: p?.email ?? '', name: p?.full_name || p?.email || '' }
      }),
  }))
}

export async function setLocationAdmin(locationId: string, profileId: string, on: boolean, by: string): Promise<void> {
  const db = supabaseAdmin()
  const r = on
    ? await db.from('cc_vol_location_admins').upsert({ location_id: locationId, profile_id: profileId, granted_by: by }, { onConflict: 'location_id,profile_id' })
    : await db.from('cc_vol_location_admins').delete().eq('location_id', locationId).eq('profile_id', profileId)
  if (r.error) throw new Error(r.error.message)
}
