import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin, supabaseUserClient } from '@/lib/supabase'
import { getSession, type CurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { memoryVolunteerData } from '@/lib/volunteer-store'
import { memoryScheduleStore, seedPlaces, supabaseScheduleStore, type MemorySchedData, type ScheduleStore } from '@/lib/volunteers/schedule-store'
import type { SchedLocation, SchedVolunteer } from '@/lib/volunteers/schedule'
import { pickLocation } from './places'
import type { Volunteer } from '@/lib/volunteers/model'

const g = globalThis as unknown as { __ccSchedData?: MemorySchedData }

/** Dev login only: the memory schedule, the dev owner as Sharon's Workshop's scheduler, and a few demo volunteers. */
function devData(email: string): MemorySchedData {
  if (!g.__ccSchedData) {
    g.__ccSchedData = seedPlaces()
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

const devVolunteers = (): SchedVolunteer[] => memoryVolunteerData().volunteers.map((v) => ({ id: v.id, fullName: v.fullName, phone: v.phone, availability: v.availability, status: v.status, reservist: v.reservist ?? false }))

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
  /** Every place this person may open (the switcher shows when there is more than one). */
  locations: SchedLocation[]
  /** Shows the buttons that change the schedule. The database decides regardless (only a 'schedule' access can write). */
  canEdit: boolean
  /** How this person sees it: a scheduler or location manager of the place, or Command Center staff with volunteers:read (read-only, everything). */
  via: 'location' | 'staff'
}

/** The cookie that remembers which place the person last opened (a preference only: the database decides access). */
export const LOCATION_COOKIE = 'cc_sched_loc'

function preferredLocation(): string | null {
  try {
    return cookies().get(LOCATION_COOKIE)?.value ?? null
  } catch {
    return null
  }
}

/** The signed-in scheduler and their location, or null (not signed in, or schedules nothing). One per request. */
export const currentScheduler = cache(async (): Promise<Scheduler | { error: 'signed_out' | 'not_scheduler' | 'setup'; message?: string }> => {
  const s = await getSession()
  if (!s) return { error: 'signed_out' }
  const store = scheduleStoreFor(s.user)
  try {
    const mine = await store.myLocations()
    const location = pickLocation(mine, preferredLocation())
    if (location) return { user: s.user, store, location, locations: mine, canEdit: location.access !== 'view', via: 'location' }
    // Command Center staff who may see volunteers' names (volunteers:read_pii) see every location, read-only. Read with the
    // service role (they are not on the location's list, so RLS shows them nothing); the database
    // refuses the service role every schedule write, so this store cannot change anything.
    if (authMode().kind === 'supabase' && can(s.user.role, 'volunteers:read_pii', s.overrides)) {
      const all = supabaseScheduleStore(supabaseAdmin())
      const every = (await all.myLocations()).map((l) => ({ ...l, access: 'view' as const }))
      const chosen = pickLocation(every, preferredLocation())
      if (chosen) return { user: s.user, store: all, location: chosen, locations: every, canEdit: false, via: 'staff' }
    }
    return { error: 'not_scheduler' }
  } catch (e) {
    return { error: 'setup', message: e instanceof Error ? e.message : String(e) }
  }
})

// ── Who schedules which location (owner, /settings/staff) ──────────────────

export interface LocationAdmins {
  location: SchedLocation
  admins: { profileId: string; email: string; name: string; access: 'schedule' | 'view' }[]
}

/** Written with the service role: granting is staff management (users:manage), not scheduling. */
export async function listLocationAdmins(): Promise<LocationAdmins[]> {
  if (authMode().kind !== 'supabase') {
    const d = g.__ccSchedData ?? seedPlaces()
    return d.locations.map((location) => ({ location, admins: d.admins.filter((a) => a.locationId === location.id).map((a) => ({ profileId: a.email, email: a.email, name: a.email, access: a.access ?? 'schedule' })) }))
  }
  const db = supabaseAdmin()
  const [locs, withAccess] = await Promise.all([
    db.from('cc_vol_locations').select('id, slug, name, active').eq('active', true).order('name'),
    db.from('cc_vol_location_admins').select('location_id, profile_id, access, cc_profiles!profile_id(email, full_name)'),
  ])
  // Before migration 0012 there is no access column: everyone listed schedules.
  const admins = withAccess.error && /access/.test(withAccess.error.message) ? await db.from('cc_vol_location_admins').select('location_id, profile_id, cc_profiles!profile_id(email, full_name)') : withAccess
  if (locs.error || admins.error) throw new Error((locs.error ?? admins.error)!.message)
  return (locs.data ?? []).map((l) => ({
    location: l as SchedLocation,
    admins: (admins.data ?? [])
      .filter((a) => a.location_id === l.id)
      .map((a) => {
        const p = (Array.isArray(a.cc_profiles) ? a.cc_profiles[0] : a.cc_profiles) as { email?: string; full_name?: string } | null
        const access: 'schedule' | 'view' = (a as { access?: string }).access === 'view' ? 'view' : 'schedule'
        return { profileId: a.profile_id as string, email: p?.email ?? '', name: p?.full_name || p?.email || '', access }
      }),
  }))
}

/** access 'view' (a location manager: sees, changes nothing) needs migration 0012. */
export async function setLocationAdmin(locationId: string, profileId: string, on: boolean, by: string, access: 'schedule' | 'view' = 'schedule'): Promise<void> {
  const db = supabaseAdmin()
  if (!on) {
    const r = await db.from('cc_vol_location_admins').delete().eq('location_id', locationId).eq('profile_id', profileId)
    if (r.error) throw new Error(r.error.message)
    return
  }
  const base = { location_id: locationId, profile_id: profileId, granted_by: by }
  let r = await db.from('cc_vol_location_admins').upsert({ ...base, access }, { onConflict: 'location_id,profile_id' })
  if (r.error && /access/.test(r.error.message)) {
    if (access === 'view') throw new Error('Location managers (view only) need migration 0012_volunteer_schedule_access.sql. Run it in the Supabase SQL editor first.')
    r = await db.from('cc_vol_location_admins').upsert(base, { onConflict: 'location_id,profile_id' })
  }
  if (r.error) throw new Error(r.error.message)
}
