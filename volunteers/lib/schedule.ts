import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { memoryScheduleStore, seedSchedule, supabaseScheduleStore, type MemorySchedData, type ScheduleStore } from '@shared/volunteers/schedule-store'
import { buildDay, type DayView } from '@shared/volunteers/schedule'
import { absenceAlertEmails } from '@shared/volunteers/schedule-reminder'
import { afterQuietHours } from '@shared/volunteers/time'
import { notify } from './mail'
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

/**
 * A volunteer reported they will not come: email the people who schedule that
 * location, at once (or after quiet hours when the day is more than a day and a
 * half away). Best-effort: the absence is already recorded and shown live on the
 * schedule; a failed email never undoes it or shows the volunteer an error.
 */
export async function alertSchedulers(a: { id: string; slotId: string; volunteerId: string; onDate: string; reason: string | null }, volunteerName: string): Promise<void> {
  try {
    const st = getScheduleStore()
    const emails = await st.schedulerEmails(a.slotId)
    if (!emails.length) return
    let day: DayView | null = null
    let locationName = 'הסדנה'
    try {
      // The volunteer's own rows name the location; the whole day (service role) gives the counts.
      const own = await st.loadForVolunteer(a.volunteerId, a.onDate, a.onDate)
      const loc = own.slots.find((x) => x.id === a.slotId)?.locationId
      locationName = own.locations.find((l) => l.id === loc)?.name ?? locationName
      if (loc) {
        const data = await st.load(loc, a.onDate, a.onDate)
        const slot = data.slots.find((x) => x.id === a.slotId)
        day = slot ? buildDay(data, slot, a.onDate) : null
      }
    } catch {
      // The counts are a courtesy; the email goes without them.
    }
    const soon = Date.parse(`${a.onDate}T00:00:00Z`) - Date.now() < 36 * 3_600_000
    const notBefore = new Date(soon ? Date.now() : afterQuietHours(Date.now())).toISOString()
    await notify(absenceAlertEmails(emails, { absenceId: a.id, volunteerName, date: a.onDate, reason: a.reason, locationName, slotId: a.slotId, day, ccUrl: env().commandCenterUrl ?? null, notBefore }))
  } catch (e) {
    console.error('scheduler alert failed (the absence is recorded):', e instanceof Error ? e.message : e)
  }
}
