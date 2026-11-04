import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { memoryScheduleStore, seedSchedule, supabaseScheduleStore, type MemorySchedData, type ScheduleStore } from '@shared/volunteers/schedule-store'
import { env } from './env'
import { getStore, NotConfiguredError } from './store'

const g = globalThis as unknown as { __jvSched?: ScheduleStore; __jvSchedData?: MemorySchedData }

/**
 * The volunteer schedule (migration 0011), from the volunteer app's server.
 * It runs with the service role, and the database accepts exactly two writes
 * from it: a volunteer's own absence on a date they are scheduled, and taking
 * that back. Everything else (who comes when) is refused by the database.
 */
export function getScheduleStore(): ScheduleStore {
  if (g.__jvSched) return g.__jvSched
  const e = env()
  if (e.supabaseUrl && e.supabaseServiceKey) {
    g.__jvSched = supabaseScheduleStore(createClient(e.supabaseUrl, e.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } }))
  } else if (!e.production) {
    // Local development: every demo volunteer is a regular on Tuesdays, so the screen has something to show.
    g.__jvSchedData ??= seedSchedule()
    const d = g.__jvSchedData
    const vols = async () => (await getStore().listVolunteers({ limit: 1000 })).map((v) => ({ id: v.id, fullName: v.fullName, phone: v.phone, availability: v.availability, status: v.status }))
    let cache: Awaited<ReturnType<typeof vols>> = []
    void vols().then((v) => (cache = v))
    g.__jvSched = memoryScheduleStore(d, { kind: 'service' }, () => cache)
    const tue = d.slots.find((s) => s.weekday === 2)!
    const origLoad = g.__jvSched.loadForVolunteer
    g.__jvSched.loadForVolunteer = async (id, from, to) => {
      cache = await vols()
      if (!d.regulars.some((r) => r.volunteerId === id)) d.regulars.push({ id: crypto.randomUUID(), slotId: tue.id, volunteerId: id, startsOn: from, endsOn: null, createdBy: 'demo' })
      return origLoad(id, from, to)
    }
  } else {
    throw new NotConfiguredError('The volunteer database is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  }
  return g.__jvSched
}
