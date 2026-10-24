import 'server-only'
import { z } from 'zod'
import { getVolunteerStore, loadVolunteerWindow } from '@/lib/volunteer-store'
import { volunteerStats } from '@/lib/volunteers/analytics'
import { recommend, personRecords, recordOf } from '@/lib/volunteers/admin'
import { israelDay, addDays } from '@/lib/volunteers/time'
import { PRESETS, rangeFor, type Preset } from '@/lib/time'
import type { Volunteer } from '@/lib/volunteers/model'
import type { AssistantTool } from './tools'

/**
 * Read-only tools over JAS Volunteers. Same rules as tools.ts: everything
 * returned goes to the model provider, so a volunteer is a reference
 * (`V-1a2b3c`) plus the id, areas, skills and record — never a name, phone or
 * email. Counts come from `volunteerStats`, the function behind the reports
 * page and /analytics, so the assistant cannot count differently.
 */
const cut = (s: string | null | undefined, n = 120) => (s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s)
export const volunteerRef = (id: string) => `V-${id.slice(0, 6)}`
const hours = (m: number) => Math.round(m / 6) / 10

async function vol<T>(run: () => Promise<T>) {
  try {
    return { status: 'ok', checkedAt: new Date().toISOString(), data: await run() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/0005_volunteers/.test(msg)) return { status: 'not_configured', missingSettings: ['migration 0005_volunteers.sql'] }
    return { status: 'error', error: cut(msg, 300) }
  }
}

const presetInput = z.object({ period: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]) }).strict()
const shiftInput = z.object({ shiftId: z.string().uuid() }).strict()

const describeVolunteer = (v: Volunteer) => ({ ref: volunteerRef(v.id), volunteerId: v.id, areas: v.areas, skills: v.skills, transport: v.transport, adult: v.adult })

export const VOLUNTEER_TOOLS: AssistantTool[] = [
  {
    name: 'get_volunteer_overview',
    label: 'Volunteers',
    description:
      'JAS Volunteers for a period: signed up (expected), attended (actual), hours (recorded attendance only), first-time and returning volunteers, show-up rate, cancellations, attendance not yet recorded, by furniture project; plus every shift in the next 14 days with its fill (confirmed / capacity / minimum / waiting) and the ones below their minimum. Signed up is NEVER the same as attended. Shift ids work with suggest_volunteers_for_shift and the propose_volunteer tools.',
    permission: 'volunteers:read',
    input: presetInput,
    schema: { type: 'object', properties: { period: { type: 'string', enum: Object.keys(PRESETS), description: 'Period for the counts' } }, required: ['period'], additionalProperties: false },
    run: (input) =>
      vol(async () => {
        const now = Date.now()
        const range = rangeFor(input.period as Preset)
        const d = await loadVolunteerWindow('2000-01-01T00:00:00Z', new Date(now + 400 * 86_400_000).toISOString(), now)
        const s = volunteerStats(d, range, now)
        const until = addDays(israelDay(now), 14)
        const upcoming = d.views
          .filter((v) => Date.parse(v.shift.startsAt) > now && israelDay(v.shift.startsAt) <= until && v.shift.status === 'open' && v.activity.status === 'published')
          .sort((a, b) => a.shift.startsAt.localeCompare(b.shift.startsAt))
        return {
          period: range,
          counts: {
            signedUp: s.signedUp, attended: s.attended, hours: hours(s.minutes), volunteersWhoCame: s.attendees, firstTime: s.firstTime, returning: s.returning,
            showUpRate: s.attendanceRate, cancellations: s.cancellations, attendanceNotRecorded: s.unrecorded, newRegistrations: s.newRegistrations,
            registeredNow: s.registered, activeLast90Days: s.active90, freePlacesOnUpcomingShifts: s.unfilled,
          },
          byProject: s.byProject.map((p) => ({ project: p.projectName ?? 'Not linked to a project', projectId: p.projectId, shifts: p.shifts, signedUp: p.signedUp, attended: p.attended, hours: hours(p.minutes) })),
          next14Days: upcoming.slice(0, 40).map((v) => ({
            shiftId: v.shift.id, activity: cut(v.activity.title, 80), kind: v.activity.kind, project: v.activity.furnitureProjectName, startsAt: v.shift.startsAt, endsAt: v.shift.endsAt,
            confirmed: v.counts.confirmed, capacity: v.shift.capacity, minimum: v.shift.minVolunteers, waiting: v.counts.waitlisted, belowMinimum: v.counts.confirmed < v.shift.minVolunteers,
          })),
          moreShifts: Math.max(0, upcoming.length - 40),
        }
      }),
  },
  {
    name: 'suggest_volunteers_for_shift',
    label: 'Volunteer suggestions',
    description:
      'Who would fit one upcoming shift, best first, with the reasons (availability, area, skills, experience, reliability, transport) and their record (shifts attended, no-shows). Volunteers are references (V-xxxxxx) with an id; names are never shown here. A suggestion is only a suggestion: use propose_volunteer_invite to ask one of them, and they decide.',
    permission: 'volunteers:read',
    input: shiftInput,
    schema: { type: 'object', properties: { shiftId: { type: 'string', description: 'Shift id from get_volunteer_overview' } }, required: ['shiftId'], additionalProperties: false },
    run: (input) =>
      vol(async () => {
        const store = getVolunteerStore()
        const shift = await store.getShift(String(input.shiftId))
        const activity = shift ? await store.getActivity(shift.activityId) : null
        if (!shift || !activity) return { found: false }
        const [recs, signups] = await Promise.all([recommend(store, shift, activity, 10), store.listSignups({ shiftIds: [shift.id] })])
        const people = recs.length ? await store.listSignups({ volunteerIds: recs.map((r) => r.volunteerId), limit: 20_000 }) : []
        const theirShifts = people.length ? await store.listShifts({ ids: [...new Set(people.map((p) => p.shiftId))] }) : []
        const record = personRecords(people, theirShifts)
        return {
          found: true,
          shift: { activity: cut(activity.title, 80), startsAt: shift.startsAt, confirmed: signups.filter((s) => s.status === 'confirmed').length, capacity: shift.capacity },
          suggestions: recs.map((r) => ({ ...describeVolunteer(r.volunteer), score: r.score, reasons: r.reasons.map((x) => x.key), attended: recordOf(record, r.volunteerId).attended, noShows: recordOf(record, r.volunteerId).noShows })),
        }
      }),
  },
]
