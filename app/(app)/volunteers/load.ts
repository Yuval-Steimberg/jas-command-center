import 'server-only'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { buildShiftViews } from '@/lib/volunteers/views'

/**
 * Everything the overview, calendar and reports need for a window of time:
 * shifts that overlap it, their activities and sign-ups, and every volunteer.
 * One query per table.
 */
export async function loadWindow(fromIso: string, toIso: string, now = Date.now()) {
  const store = getVolunteerStore()
  const [shifts, volunteers] = await Promise.all([store.listShifts({ from: fromIso, to: toIso, limit: 20_000 }), store.listVolunteers({ limit: 20_000 })])
  const [activities, signups] = await Promise.all([
    shifts.length ? store.listActivities({ ids: [...new Set(shifts.map((s) => s.activityId))] }) : Promise.resolve([]),
    shifts.length ? store.listSignups({ shiftIds: shifts.map((s) => s.id), limit: 100_000 }) : Promise.resolve([]),
  ])
  return { shifts, volunteers, activities, signups, views: buildShiftViews(activities, shifts, signups, now) }
}

/** Real furniture projects for the link select. When the field app cannot be read, say so instead of an empty list. */
export async function projectOptions(): Promise<{ projects: { id: string; name: string }[]; note: string | null }> {
  const { getFurnitureProjects } = await import('@/lib/integrations/furniture/adapter')
  const r = await getFurnitureProjects()
  if (r.state === 'ok') return { projects: r.data.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), note: null }
  return { projects: [], note: r.state === 'not_configured' ? 'The furniture app is not connected, so projects cannot be listed.' : 'The furniture app could not be read just now; projects cannot be listed.' }
}
