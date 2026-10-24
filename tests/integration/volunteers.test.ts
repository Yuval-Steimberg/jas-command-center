import { describe, expect, it } from 'vitest'
import { emptyVolData, memoryVolunteerStore, type VolunteerStore } from '@/lib/volunteers/store'
import type { RegistrationInput } from '@/lib/volunteers/model'
import { scoreMatch, recordedMinutes, ineligible } from '@/lib/volunteers/rules'
import { volunteerStats } from '@/lib/volunteers/analytics'
import { deliverOutbox, reminderRows, runVolunteerJobs, signupMessage, thanksRows, opportunityRows } from '@/lib/volunteers/notify'
import { israelDay, israelToUtc } from '@/lib/volunteers/time'
import { buildShiftViews } from '@/lib/volunteers/views'

const H = 3_600_000
const reg = (n: string, extra: Partial<RegistrationInput> = {}): RegistrationInput => ({
  fullName: `${n} Cohen`, email: `${n}@x.com`, phone: '', adult: true, areas: ['tel_aviv'], availability: [], skills: [], transport: 'none', about: null,
  notifyReminders: true, notifyOpportunities: false, consentWhatsapp: false, ...extra,
})

function setup(start = Date.parse('2026-11-01T06:00:00Z')) {
  let now = start
  const d = emptyVolData()
  const store = memoryVolunteerStore(d, () => now)
  return { store, d, at: (t: number) => (now = t), now: () => now }
}

async function activityWithShift(store: VolunteerStore, now: number, opts: { capacity?: number; inHours?: number; length?: number } = {}) {
  const a = await store.createActivity({ title: 'Collection – Bialik 12', kind: 'collection', area: 'tel_aviv', furnitureProjectId: 'p1', furnitureProjectName: 'Bialik' }, 'staff@x')
  await store.setActivityStatus(a.id, 'draft', 'published')
  const startsAt = new Date(now + (opts.inHours ?? 48) * H).toISOString()
  const endsAt = new Date(now + ((opts.inHours ?? 48) + (opts.length ?? 4)) * H).toISOString()
  const { shift } = await store.saveShift(a.id, null, null, { label: 'Morning', role: null, startsAt, endsAt, capacity: opts.capacity ?? 2, minVolunteers: 1 }, 'staff@x')
  return { a: (await store.getActivity(a.id))!, shift }
}

describe('volunteer store (memory, same rules as the SQL)', () => {
  it('registers, links one CRM contact per person, refuses duplicates', async () => {
    const { store, d } = setup()
    d.contacts.push({ id: 'c1', email: 'dana@x.com', phone: '0501111111', fullName: 'Dana Lead', roles: ['lead'] })
    const v = await store.register(reg('dana', { phone: '0501111111' }))
    expect(v.contactId).toBe('c1')
    expect(d.contacts[0]!.roles).toEqual(['lead', 'volunteer'])
    await expect(store.register(reg('dana'))).rejects.toThrow(/already registered/)
    await expect(store.register(reg('other', { phone: '0501111111' }))).rejects.toThrow(/phone number is already registered/)
  })

  it('never exceeds capacity under concurrent joins, waitlists the rest in order, promotes FIFO', async () => {
    const { store, now } = setup()
    const { shift } = await activityWithShift(store, now(), { capacity: 3 })
    const vols = await Promise.all(Array.from({ length: 12 }, (_, i) => store.register(reg(`v${i}`))))
    const res = await Promise.all(vols.map((v) => store.join(shift.id, v.id, 'self', `volunteer:${v.id}`)))
    expect(res.filter((s) => s.status === 'confirmed')).toHaveLength(3)
    expect(res.filter((s) => s.status === 'waitlisted')).toHaveLength(9)
    // Joining twice returns the same row.
    const again = await store.join(shift.id, vols[0]!.id, 'self', 'v')
    expect(again.id).toBe(res[0]!.id)
    // Two cancel at once: exactly the two longest-waiting are promoted.
    const confirmed = res.filter((s) => s.status === 'confirmed')
    const out = await Promise.all(confirmed.slice(0, 2).map((s) => store.leave(s.id, 'cancelled', null, 'v', s.volunteerId)))
    const promoted = out.flatMap((o) => o.promoted.map((p) => p.volunteerId))
    expect(promoted.sort()).toEqual([res[3]!.volunteerId, res[4]!.volunteerId].sort())
    const all = await store.listSignups({ shiftIds: [shift.id] })
    expect(all.filter((s) => s.status === 'confirmed')).toHaveLength(3)
  })

  it('refuses overlapping shifts, closed sign-up, cancelled activities and adults-only for minors', async () => {
    const { store, now } = setup()
    const { a, shift } = await activityWithShift(store, now(), { capacity: 5 })
    const { shift: s2 } = await store.saveShift(a.id, null, null, { label: 'Overlap', role: null, startsAt: new Date(Date.parse(shift.startsAt) + 2 * H).toISOString(), endsAt: new Date(Date.parse(shift.endsAt) + 2 * H).toISOString(), capacity: 5, minVolunteers: 0 }, 's')
    const { shift: s3 } = await store.saveShift(a.id, null, null, { label: 'Back to back', role: null, startsAt: shift.endsAt, endsAt: new Date(Date.parse(shift.endsAt) + 2 * H).toISOString(), capacity: 5, minVolunteers: 0 }, 's')
    const v = await store.register(reg('a'))
    await store.join(shift.id, v.id, 'self', 'v')
    await expect(store.join(s2.id, v.id, 'self', 'v')).rejects.toThrow(/overlaps/)
    expect((await store.join(s3.id, v.id, 'self', 'v')).status).toBe('confirmed')
    const minor = await store.register(reg('teen', { adult: false }))
    const cur = (await store.getActivity(a.id))!
    await store.updateActivity(a.id, cur.version, { adultsOnly: true })
    await expect(store.join(shift.id, minor.id, 'self', 'v')).rejects.toThrow(/18/)
    await store.updateActivity(a.id, cur.version + 1, { signupClosesHours: 72 })
    await expect(store.updateActivity(a.id, cur.version, { title: 'stale' })).rejects.toThrow(/changed/)
    const late = await store.register(reg('late'))
    await expect(store.join(shift.id, late.id, 'self', 'v')).rejects.toThrow(/closed/)
    // Staff can still add someone after self sign-up closed, but never past capacity.
    expect((await store.join(shift.id, late.id, 'staff', 'staff@x')).status).toBe('confirmed')
    const cancelled = await store.cancel(a.id, null, 'rain', 'staff@x')
    expect(cancelled.length).toBeGreaterThanOrEqual(3)
    await expect(store.join(s2.id, (await store.register(reg('z'))).id, 'self', 'v')).rejects.toThrow(/cancelled/)
  })

  it('capacity cannot drop below confirmed; raising it promotes the waitlist', async () => {
    const { store, now } = setup()
    const { shift } = await activityWithShift(store, now(), { capacity: 1 })
    const [x, y] = await Promise.all([store.register(reg('x')), store.register(reg('y'))])
    await store.join(shift.id, x.id, 'self', 'v')
    const wy = await store.join(shift.id, y.id, 'self', 'v')
    expect(wy.status).toBe('waitlisted')
    const input = { label: null, role: null, startsAt: shift.startsAt, endsAt: shift.endsAt, minVolunteers: 0 }
    await expect(store.saveShift(shift.activityId, shift.id, 999, { ...input, capacity: 1 }, 's')).rejects.toThrow(/changed/)
    await store.leave(wy.id, 'cancelled', null, 'v', y.id)
    await store.join(shift.id, y.id, 'self', 'v')
    const r = await store.saveShift(shift.activityId, shift.id, null, { ...input, capacity: 2 }, 's')
    expect(r.promoted.map((p) => p.volunteerId)).toEqual([y.id])
  })

  it('awards hours only from recorded attendance', async () => {
    const t = setup()
    const { shift } = await activityWithShift(t.store, t.now(), { capacity: 3, inHours: 1, length: 3 })
    const vs = await Promise.all(['a', 'b', 'c'].map((n) => t.store.register(reg(n))))
    const ss = await Promise.all(vs.map((v) => t.store.join(shift.id, v.id, 'self', 'v')))
    expect(recordedMinutes(await t.store.listSignups({ shiftIds: [shift.id] }))).toBe(0)
    await expect(t.store.attendance(ss[0]!.id, 'check_in', {}, null, 'c', null)).resolves.toBeTruthy() // 1h before start: allowed (2h window)
    t.at(Date.parse(shift.startsAt) + 2.5 * H)
    const out = await t.store.attendance(ss[0]!.id, 'check_out', {}, null, 'coord', null)
    expect(out.minutes).toBe(210)
    await t.store.attendance(ss[1]!.id, 'full_shift', {}, null, 'coord', null)
    await t.store.attendance(ss[2]!.id, 'absent', {}, null, 'coord', null)
    await expect(t.store.attendance(ss[2]!.id, 'correct', { in: shift.startsAt, out: shift.endsAt }, ' ', 'coord', null)).rejects.toThrow(/note/)
    await expect(t.store.attendance(ss[1]!.id, 'reset', {}, null, 'coord', 1)).rejects.toThrow(/reload/)
    const all = await t.store.listSignups({ shiftIds: [shift.id] })
    expect(recordedMinutes(all)).toBe(210 + 180)
    // The volunteer cannot cancel once attendance is recorded.
    await expect(t.store.leave(ss[1]!.id, 'cancelled', null, 'v', vs[1]!.id)).rejects.toThrow(/attendance/)
    const events = await t.store.listEvents({ signupIds: [ss[0]!.id] })
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['joined', 'attendance_check_in', 'attendance_check_out']))
  })

  it('QR self check-in: valid code, confirmed only, in window; second scan checks out', async () => {
    const t = setup()
    const { shift } = await activityWithShift(t.store, t.now(), { inHours: 30 })
    const v = await t.store.register(reg('q'))
    const other = await t.store.register(reg('w'))
    await t.store.join(shift.id, v.id, 'self', 'v')
    await expect(t.store.selfCheckin(shift.id, v.id, shift.checkinCode)).rejects.toThrow(/hour before/)
    t.at(Date.parse(shift.startsAt) + 5 * 60_000)
    await expect(t.store.selfCheckin(shift.id, v.id, 'nope')).rejects.toThrow(/not valid/)
    await expect(t.store.selfCheckin(shift.id, other.id, shift.checkinCode)).rejects.toThrow(/not confirmed/)
    expect((await t.store.selfCheckin(shift.id, v.id, shift.checkinCode)).checkInAt).not.toBeNull()
    t.at(Date.parse(shift.startsAt) + 65 * 60_000)
    expect((await t.store.selfCheckin(shift.id, v.id, shift.checkinCode)).minutes).toBe(60)
  })

  it('forgetting a volunteer anonymises them, frees their future places, keeps past hours', async () => {
    const t = setup()
    const { shift } = await activityWithShift(t.store, t.now(), { capacity: 1 })
    const [a, b] = await Promise.all([t.store.register(reg('a')), t.store.register(reg('b'))])
    await t.store.join(shift.id, a.id, 'self', 'v')
    await t.store.join(shift.id, b.id, 'self', 'v')
    const gone = await t.store.forget(a.id, 'volunteer:' + a.id)
    expect(gone).toMatchObject({ email: null, phone: null, status: 'deleted', fullName: 'Deleted volunteer' })
    const ss = await t.store.listSignups({ shiftIds: [shift.id] })
    expect(ss.find((s) => s.volunteerId === b.id)!.status).toBe('confirmed')
    await expect(t.store.join(shift.id, a.id, 'self', 'v')).rejects.toThrow(/deleted/)
  })

  it('login codes are single-use', async () => {
    const { store } = setup()
    await store.addLoginCode('a@x.com', 'h', new Date(Date.now() + 60_000).toISOString())
    const c = (await store.latestLoginCode('a@x.com'))!
    const [one, two] = await Promise.all([store.consumeLoginCode(c.id), store.consumeLoginCode(c.id)])
    expect([one, two].filter(Boolean)).toHaveLength(1)
  })
})

describe('matching, analytics and notifications', () => {
  it('recommends only eligible people, best fit first, and never assigns', async () => {
    const t = setup()
    const { a, shift } = await activityWithShift(t.store, t.now())
    const free = (await t.store.register(reg('free', { availability: ['tue_morning', 'tue_afternoon', 'tue_evening', 'mon_morning', 'mon_afternoon', 'mon_evening', 'sun_morning', 'sun_afternoon', 'sun_evening'] as never, areas: ['tel_aviv'] })))
    const far = await t.store.register(reg('far', { areas: ['holon_bat_yam'] }))
    const minor = await t.store.register(reg('minor', { adult: false }))
    const activity = { ...a, adultsOnly: true }
    const none = { attended: [], noShows: 0 }
    const m1 = scoreMatch(free, shift, activity, [], none)!
    const m2 = scoreMatch(far, shift, activity, [], none)!
    expect(m1.score).toBeGreaterThan(m2.score)
    expect(scoreMatch(minor, shift, activity, [], none)).toBeNull()
    expect(ineligible(minor, shift, activity, [])).toContain('adults_only')
    expect(await t.store.listSignups({ shiftIds: [shift.id] })).toHaveLength(0)
  })

  it('separates signed up, waitlisted and attended; hours from attendance only', async () => {
    const t = setup()
    const { a, shift } = await activityWithShift(t.store, t.now(), { capacity: 2, inHours: 1, length: 2 })
    const vs = await Promise.all(['a', 'b', 'c'].map((n) => t.store.register(reg(n))))
    const ss = []
    for (const v of vs) ss.push(await t.store.join(shift.id, v.id, 'self', 'v'))
    t.at(Date.parse(shift.endsAt) + H)
    await t.store.attendance(ss[0]!.id, 'full_shift', {}, null, 'c', null)
    const data = { volunteers: await t.store.listVolunteers(), activities: [a], shifts: await t.store.listShifts(), signups: await t.store.listSignups() }
    const day = israelDay(shift.startsAt)
    const st = volunteerStats(data, { from: day, to: day }, t.now())
    expect(st).toMatchObject({ signedUp: 2, waitlisted: 1, attended: 1, unrecorded: 1, minutes: 120, firstTime: 1, attendees: 1, utilization: 1 })
    expect(st.byProject[0]).toMatchObject({ projectId: 'p1', attended: 1, minutes: 120, volunteers: 1 })
    expect(st.attendanceRate).toBe(1)
  })

  it('reminds once, respects opt-out, and sends nothing to a deleted volunteer', async () => {
    const t = setup(Date.parse(israelToUtc('2026-11-01', '09:00')!))
    const { a, shift } = await activityWithShift(t.store, t.now(), { inHours: 30 })
    const [yes, no] = await Promise.all([t.store.register(reg('yes')), t.store.register(reg('no', { notifyReminders: false }))])
    for (const v of [yes, no]) await t.store.join(shift.id, v.id, 'self', 'v')
    const l = { shifts: [shift], activities: [a], signups: await t.store.listSignups(), volunteers: await t.store.listVolunteers() }
    const rows = reminderRows(l, { appUrl: 'https://v.example', teamPhone: null, now: t.now() })
    expect(rows.map((r) => r.volunteerId)).toEqual([yes.id])
    expect(rows[0]!.body).toContain('https://v.example/my/')
    const sent: string[] = []
    const send = async (to: string) => { sent.push(to); return { ok: true as const } }
    t.at(Date.parse(shift.startsAt) - 23 * H)
    const r1 = await runVolunteerJobs(t.store, send, { appUrl: null, teamPhone: null, now: t.now() })
    const r2 = await runVolunteerJobs(t.store, send, { appUrl: null, teamPhone: null, now: t.now() })
    expect(r1.delivery.sent).toBe(1)
    expect(r2.delivery.sent + r2.queued).toBe(0)
    expect(sent).toEqual(['yes@x.com'])
    // A queued message to someone who deletes their account is skipped, never sent.
    const s = (await t.store.listSignups({ volunteerId: yes.id }))[0]!
    await t.store.enqueue([signupMessage('joined', yes, { ...s, version: 99 }, shift, a, { appUrl: null, teamPhone: null, now: t.now() })!])
    await t.store.forget(yes.id, 'x')
    const r3 = await deliverOutbox(t.store, send)
    expect(r3.sent).toBe(0)
  })

  it('thanks once per activity after attendance; opportunities only to opted-in, capped every 3 days', async () => {
    const t = setup()
    const { a, shift } = await activityWithShift(t.store, t.now(), { inHours: 1, length: 2 })
    const v = await t.store.register(reg('t', { notifyOpportunities: true }))
    const s = await t.store.join(shift.id, v.id, 'self', 'v')
    t.at(Date.parse(shift.endsAt) + H)
    await t.store.attendance(s.id, 'full_shift', {}, null, 'c', null)
    const l = { shifts: [shift], activities: [a], signups: await t.store.listSignups(), volunteers: await t.store.listVolunteers() }
    expect(thanksRows(l, { appUrl: null, teamPhone: null, now: t.now() })).toHaveLength(1)
    const { shift: later } = await t.store.saveShift(a.id, null, null, { label: null, role: null, startsAt: new Date(t.now() + 50 * H).toISOString(), endsAt: new Date(t.now() + 52 * H).toISOString(), capacity: 3, minVolunteers: 0 }, 's')
    const opp = opportunityRows(a, [later], l.volunteers, [], { appUrl: null, teamPhone: null, now: t.now() })
    expect(opp).toHaveLength(1)
    expect(opportunityRows(a, [later], l.volunteers, [{ volunteerId: v.id, kind: 'opportunity', createdAt: new Date(t.now() - H).toISOString() }], { appUrl: null, teamPhone: null, now: t.now() })).toHaveLength(0)
  })

  it('shift views agree with the counts', async () => {
    const t = setup()
    const { a, shift } = await activityWithShift(t.store, t.now(), { capacity: 1 })
    const [x, y] = await Promise.all([t.store.register(reg('x')), t.store.register(reg('y'))])
    await t.store.join(shift.id, x.id, 'self', 'v')
    await t.store.join(shift.id, y.id, 'self', 'v')
    const [view] = buildShiftViews([a], [shift], await t.store.listSignups(), t.now())
    expect(view).toMatchObject({ phase: 'full', places: 0, counts: { confirmed: 1, waitlisted: 1 } })
  })
})
