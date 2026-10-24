import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { env } from '@/lib/env'
import { supabaseAdmin } from '@/lib/supabase'
import { emptyVolData, memoryVolunteerStore, type MemoryVolData, type NewOutbox, type VolunteerStore } from '@/lib/volunteers/store'
import { supabaseVolunteerStore } from '@/lib/volunteers/supabase'
import { deliverOutbox, sendgridSender, type NotifyContext, type Sender } from '@/lib/volunteers/notify'
import { buildShiftViews } from '@/lib/volunteers/views'

// One per process, on globalThis: route handlers, actions and pages are separate bundles in Next.js.
const g = globalThis as unknown as { __ccVolData?: MemoryVolData }

/**
 * The volunteer tables live in the command center's own Supabase, and the
 * volunteer app reads and writes the same rows: one source of truth. Memory
 * for the local development login (same semantics).
 */
export function getVolunteerStore(): VolunteerStore {
  if (authMode().kind === 'supabase') return supabaseVolunteerStore(supabaseAdmin())
  return memoryVolunteerStore((g.__ccVolData ??= emptyVolData()))
}

export function volunteerContext(): NotifyContext {
  const v = env().volunteers
  return { appUrl: v.appUrl ?? null, teamPhone: v.teamPhone ?? null }
}

export function volunteerSender(): Sender | null {
  const e = env()
  return sendgridSender({ apiKey: e.email.sendgridKey, from: e.volunteers.from, replyTo: e.volunteers.replyTo })
}

/** Queue messages to volunteers and send what is due. Never fails the staff action that caused them. */
export async function notifyVolunteers(rows: (NewOutbox | null)[]): Promise<{ queued: number; warning?: string }> {
  const list = rows.filter((r): r is NewOutbox => r !== null)
  if (!list.length) return { queued: 0 }
  try {
    const store = getVolunteerStore()
    const added = await store.enqueue(list)
    const send = volunteerSender()
    if (!send) return { queued: added.length, warning: 'Volunteer emails are queued but not sent: SENDGRID_API_KEY is not set.' }
    const r = await deliverOutbox(store, send, 50)
    return { queued: added.length, warning: r.failed ? `${r.failed} volunteer email(s) failed and will be retried by the hourly job.` : undefined }
  } catch (e) {
    console.error('volunteer notification failed (left in the outbox):', e instanceof Error ? e.message : e)
    return { queued: 0, warning: 'The volunteer emails could not be queued. Nobody was notified of this change.' }
  }
}

/**
 * Everything the overview, calendar, reports, analytics and the assistant need
 * for a window of time: shifts that overlap it, their activities and sign-ups,
 * and every volunteer. One query per table (paged by the store).
 */
export async function loadVolunteerWindow(fromIso: string, toIso: string, now = Date.now()) {
  const store = getVolunteerStore()
  const [shifts, volunteers] = await Promise.all([store.listShifts({ from: fromIso, to: toIso, limit: 20_000 }), store.listVolunteers({ limit: 20_000 })])
  const [activities, signups] = await Promise.all([
    shifts.length ? store.listActivities({ ids: [...new Set(shifts.map((s) => s.activityId))] }) : Promise.resolve([]),
    shifts.length ? store.listSignups({ shiftIds: shifts.map((s) => s.id), limit: 100_000 }) : Promise.resolve([]),
  ])
  return { shifts, volunteers, activities, signups, views: buildShiftViews(activities, shifts, signups, now) }
}
