import 'server-only'
import { israelDate } from '@/lib/time'
import { env } from '@/lib/env'
import { authMode } from '@/lib/auth/mode'
import { buildDay, buildRange, defaultWeek, isDate, plusDays, weekStart, type DayView, type ScheduleData } from '@/lib/volunteers/schedule'
import type { Scheduler } from './store'

export interface WeekView {
  week: string
  today: string
  data: ScheduleData
  days: DayView[]
}

/** The week to show (?week=, or the default: this week until its last operating day has passed). */
export async function loadWeek(s: Scheduler, weekParam?: string): Promise<WeekView> {
  const today = israelDate()
  if (isDate(weekParam)) {
    const week = weekStart(weekParam)
    const data = await s.store.load(s.location.id, week, plusDays(week, 6))
    return { week, today, data, days: buildRange(data, s.location.id, week, plusDays(week, 6)) }
  }
  const start = weekStart(today)
  const data = await s.store.load(s.location.id, start, plusDays(start, 13))
  const week = defaultWeek(today, data.slots)
  return { week, today, data, days: buildRange(data, s.location.id, week, plusDays(week, 6)) }
}

export async function loadDay(s: Scheduler, slotId: string, date: string): Promise<{ day: DayView; data: ScheduleData; today: string } | null> {
  if (!isDate(date)) return null
  const data = await s.store.load(s.location.id, date, date)
  const slot = data.slots.find((x) => x.id === slotId && x.active)
  if (!slot || new Date(`${date}T12:00:00Z`).getUTCDay() !== slot.weekday) return null
  return { day: buildDay(data, slot, date), data, today: israelDate() }
}

/** What the browser needs to listen to Realtime as the signed-in person (both values are public). */
/** Staff who read through the service role are not on the location's list, so Realtime (RLS) would send them nothing: they poll. */
export function realtimeConfig(s?: { via: 'location' | 'staff' }): { url: string | null; anonKey: string | null } {
  if (authMode().kind !== 'supabase' || s?.via === 'staff') return { url: null, anonKey: null }
  const e = env().cc
  return { url: e.supabaseUrl ?? null, anonKey: e.supabaseAnonKey ?? null }
}
