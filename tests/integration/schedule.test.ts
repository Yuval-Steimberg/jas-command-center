import { describe, expect, it } from 'vitest'
import { memoryScheduleStore, seedSchedule, ScheduleForbiddenError, type MemorySchedData } from '@/lib/volunteers/schedule-store'
import { availabilityKeys, buildDay, buildRange, datesOf, defaultWeek, matchVolunteers, myDays, plusDays, weekStart, weekdayOf, type SchedVolunteer } from '@/lib/volunteers/schedule'

// Wednesday 2026-11-04, 10:00 Israel.
const NOW = Date.parse('2026-11-04T08:00:00Z')
const TUE = '2026-11-10'

const people: SchedVolunteer[] = [
  { id: 'v-yossi', fullName: 'יוסי כהן', phone: '0500000001', availability: ['tue_morning'], status: 'active' },
  { id: 'v-ruti', fullName: 'רותי לוי', phone: '0500000002', availability: ['tue_morning'], status: 'active' },
  { id: 'v-avi', fullName: 'אבי מזרחי', phone: '0500000003', availability: [], status: 'active' },
  { id: 'v-dana', fullName: 'דנה בר', phone: null, availability: ['mon_morning'], status: 'active' },
  { id: 'v-paused', fullName: 'משה מושהה', phone: null, availability: ['tue_morning'], status: 'paused' },
]

function setup() {
  const d: MemorySchedData = seedSchedule()
  d.admins.push({ locationId: d.locations[0]!.id, email: 'dafna@x' })
  const vols = () => people
  const dafna = memoryScheduleStore(d, { kind: 'admin', email: 'dafna@x' }, vols, () => NOW)
  const app = memoryScheduleStore(d, { kind: 'service' }, vols, () => NOW)
  const stranger = memoryScheduleStore(d, { kind: 'admin', email: 'liat@x' }, vols, () => NOW)
  const tue = d.slots.find((s) => s.weekday === 2)!
  const loc = d.locations[0]!.id
  const day = async (date = TUE) => buildDay(await dafna.load(loc, date, date), tue, date)
  return { d, dafna, app, stranger, tue, loc, day }
}

describe('calendar helpers', () => {
  it('finds weekdays and weeks on plain dates', () => {
    expect(weekdayOf('2026-11-10')).toBe(2)
    expect(weekStart('2026-11-12')).toBe('2026-11-08')
    expect(datesOf({ weekday: 2 }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'])
    expect(plusDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('opens on this week until its last operating day has passed, then next week', () => {
    const slots = [1, 2, 3].map((weekday) => ({ weekday, active: true }))
    expect(defaultWeek('2026-11-04', slots)).toBe('2026-11-01') // Wednesday: still this week
    expect(defaultWeek('2026-11-05', slots)).toBe('2026-11-08') // Thursday: next week
  })
  it('maps a slot to the availability a volunteer declared', () => {
    expect(availabilityKeys({ weekday: 2, startsAt: '09:00', endsAt: '13:00' })).toEqual(['tue_morning', 'tue_afternoon'])
    expect(availabilityKeys({ weekday: 1, startsAt: null, endsAt: null })).toHaveLength(3)
  })
  it('matches Hebrew names however they are typed', () => {
    expect(matchVolunteers(people, 'רותי').map((v) => v.id)).toEqual(['v-ruti'])
    expect(matchVolunteers(people, 'יוסי כ')).toHaveLength(1)
    expect(matchVolunteers(people, 'רוּתִי')).toHaveLength(1)
    expect(matchVolunteers(people, 'זאב')).toHaveLength(0)
  })
})

describe('the absence → replacement workflow', () => {
  it('runs end to end: regulars, an absence, a shortage, a replacement, and the numbers follow', async () => {
    const { dafna, app, tue, day } = setup()
    await dafna.updateSlot(tue.id, 1, { required: 3, startsAt: '09:00', endsAt: '13:00' })
    for (const id of ['v-yossi', 'v-avi', 'v-paused']) {
      if (id === 'v-paused') await expect(dafna.addRegular(tue.id, id, '2026-11-04')).rejects.toThrow(/not active/)
      else await dafna.addRegular(tue.id, id, '2026-11-04')
    }

    let v = await day()
    expect(v.required).toBe(3)
    expect(v.coming).toBe(2)
    expect(v.missing).toBe(1)

    // 1–2. Yossi reports he will not come on that Tuesday; the system records it at once.
    const absence = await app.absence(tue.id, 'v-yossi', TUE, 'מחלה', 'volunteer')
    expect((await app.absence(tue.id, 'v-yossi', TUE, null, 'volunteer')).id).toBe(absence.id) // twice = once
    // 3–5. His place is open and the shortage recalculated.
    v = await day()
    expect(v.absent.map((p) => p.volunteer.id)).toEqual(['v-yossi'])
    expect(v.coming).toBe(1)
    expect(v.missing).toBe(2)
    // 6. Dafna sees who could replace him: active, not already on, not absent; declared availability first.
    expect(v.candidates.map((c) => c.volunteer.id)).toEqual(['v-ruti', 'v-dana'])
    expect(v.candidates[0]!.availability).toBe('declared')
    expect(v.candidates[1]!.availability).toBe('unknown')
    expect(v.declaredCandidates).toBe(1)

    // The absence touches only that date.
    expect((await day('2026-11-17')).coming).toBe(2)

    // Asked but not confirmed: shown, not counted.
    const asked = await dafna.assign(tue.id, 'v-ruti', TUE, 'tentative', 'v-yossi', null)
    v = await day()
    expect(v.tentative).toBe(1)
    expect(v.coming).toBe(1)
    expect(v.missing).toBe(2)
    expect(v.candidates.map((c) => c.volunteer.id)).toEqual(['v-dana'])

    // Confirmed: counted once, shown as replacing Yossi.
    await dafna.setAssignmentStatus(asked.id, 'confirmed')
    v = await day()
    expect(v.coming).toBe(2)
    expect(v.missing).toBe(1)
    expect(v.assigned[0]!.assignment!.replacesVolunteerId).toBe('v-yossi')

    // The replacement appears for that date only, and only on the volunteer's own list once confirmed.
    const ruti = myDays(await app.loadForVolunteer('v-ruti', '2026-11-04', '2026-12-31'), 'v-ruti', '2026-11-04', '2026-12-31')
    expect(ruti.map((x) => x.date)).toEqual([TUE])
    const yossi = myDays(await app.loadForVolunteer('v-yossi', '2026-11-04', '2026-11-24'), 'v-yossi', '2026-11-04', '2026-11-24')
    expect(yossi.map((x) => [x.date, Boolean(x.absence)])).toEqual([['2026-11-10', true], ['2026-11-17', false], ['2026-11-24', false]])
  })

  it('never double-counts and refuses duplicate or conflicting assignments', async () => {
    const { dafna, app, tue, day } = setup()
    await dafna.updateSlot(tue.id, null, { required: 2 })
    await dafna.addRegular(tue.id, 'v-avi', '2026-11-04')
    await expect(dafna.addRegular(tue.id, 'v-avi', '2026-11-04')).rejects.toThrow(/already a regular/)
    await expect(dafna.assign(tue.id, 'v-avi', TUE, 'confirmed', null, null)).rejects.toThrow(/as a regular/)
    const a = await dafna.assign(tue.id, 'v-ruti', TUE, 'confirmed', null, null)
    expect((await dafna.assign(tue.id, 'v-ruti', TUE, 'confirmed', null, null)).id).toBe(a.id)
    expect((await day()).coming).toBe(2)
    // An absent person cannot be assigned back on the same date: their absence must be taken back.
    await app.absence(tue.id, 'v-avi', TUE, null, 'volunteer')
    await expect(dafna.assign(tue.id, 'v-avi', TUE, 'confirmed', null, null)).rejects.toThrow(/take the absence back/)
    // Wrong weekday, past date, inactive.
    await expect(dafna.assign(tue.id, 'v-dana', '2026-11-11', 'confirmed', null, null)).rejects.toThrow(/not a day/)
    await expect(dafna.assign(tue.id, 'v-dana', '2026-11-03', 'confirmed', null, null)).rejects.toThrow(/passed/)
    await expect(dafna.assign(tue.id, 'v-paused', TUE, 'confirmed', null, null)).rejects.toThrow(/not active/)
    // Becoming a regular cancels one-date assignments it now covers.
    await dafna.addRegular(tue.id, 'v-ruti', '2026-11-04')
    const v = await day()
    expect(v.assigned).toHaveLength(0)
    expect(v.regulars.map((p) => p.volunteer.id).sort()).toEqual(['v-avi', 'v-ruti'])
    expect(v.coming).toBe(1)
  })

  it('a replace is all-or-nothing', async () => {
    const { dafna, tue, day } = setup()
    await dafna.addRegular(tue.id, 'v-avi', '2026-11-04')
    await expect(dafna.replace(tue.id, TUE, 'v-avi', 'v-paused', 'confirmed', null)).rejects.toThrow(/not active/)
    expect((await day()).absent).toHaveLength(0)
    await dafna.replace(tue.id, TUE, 'v-avi', 'v-ruti', 'confirmed', 'ביקש להחליף')
    const v = await day()
    expect(v.absent.map((p) => p.volunteer.id)).toEqual(['v-avi'])
    expect(v.assigned.map((p) => p.volunteer.id)).toEqual(['v-ruti'])
  })

  it('a closed day expects nobody and reports nothing missing', async () => {
    const { dafna, app, tue, day } = setup()
    await dafna.updateSlot(tue.id, null, { required: 5 })
    await dafna.addRegular(tue.id, 'v-avi', '2026-11-04')
    await dafna.setClosure(tue.id, TUE, true, 'חג')
    const v = await day()
    expect(v.closed).toEqual({ reason: 'חג' })
    expect(v.missing).toBeNull()
    expect(v.coming).toBe(0)
    expect(v.candidates).toHaveLength(0)
    await expect(app.absence(tue.id, 'v-avi', TUE, null, 'volunteer')).rejects.toThrow(/closed/)
  })

  it('"not set" is not zero', async () => {
    const { day } = setup()
    const v = await day()
    expect(v.required).toBeNull()
    expect(v.missing).toBeNull()
  })

  it('ending a regular day keeps the past and the dates before the end', async () => {
    const { dafna, d, tue, day } = setup()
    const r = await dafna.addRegular(tue.id, 'v-avi', '2026-11-04')
    await dafna.endRegular(r.id, TUE)
    expect((await day()).regulars).toHaveLength(1)
    expect((await day('2026-11-17')).regulars).toHaveLength(0)
    expect(d.events.map((e) => e.kind)).toEqual(['schedule.regular_added', 'schedule.regular_ended'])
  })
})

describe('who may do what', () => {
  it('only the location admin schedules; the volunteer app only reports absences', async () => {
    const { dafna, app, stranger, tue, loc } = setup()
    await dafna.addRegular(tue.id, 'v-avi', '2026-11-04')
    await expect(stranger.assign(tue.id, 'v-ruti', TUE, 'confirmed', null, null)).rejects.toBeInstanceOf(ScheduleForbiddenError)
    await expect(stranger.load(loc, TUE, TUE)).rejects.toBeInstanceOf(ScheduleForbiddenError)
    expect(await stranger.myLocations()).toEqual([])
    await expect(app.assign(tue.id, 'v-ruti', TUE, 'confirmed', null, null)).rejects.toBeInstanceOf(ScheduleForbiddenError)
    await expect(app.addRegular(tue.id, 'v-ruti', '2026-11-04')).rejects.toBeInstanceOf(ScheduleForbiddenError)
    await expect(app.updateSlot(tue.id, null, { required: 9 })).rejects.toBeInstanceOf(ScheduleForbiddenError)
    // An admin cannot pose as a volunteer.
    await expect(dafna.absence(tue.id, 'v-avi', TUE, null, 'volunteer')).rejects.toBeInstanceOf(ScheduleForbiddenError)
    // A volunteer reports only a date they are on, and takes back only their own.
    await expect(app.absence(tue.id, 'v-ruti', TUE, null, 'volunteer')).rejects.toThrow(/not scheduled/)
    const a = await app.absence(tue.id, 'v-avi', TUE, null, 'volunteer')
    await expect(app.withdrawAbsence(a.id, 'volunteer', 'v-ruti')).rejects.toThrow(/not found/)
    expect((await app.withdrawAbsence(a.id, 'volunteer', 'v-avi')).withdrawnAt).not.toBeNull()
  })

  it('a volunteer never sees a tentative assignment as "you are on"', async () => {
    const { dafna, app, tue } = setup()
    await dafna.assign(tue.id, 'v-dana', TUE, 'tentative', null, null)
    expect(myDays(await app.loadForVolunteer('v-dana', '2026-11-04', '2026-11-30'), 'v-dana', '2026-11-04', '2026-11-30')).toEqual([])
  })

  it('the week view lists Monday, Tuesday and Wednesday in order', async () => {
    const { dafna, loc } = setup()
    const days = buildRange(await dafna.load(loc, '2026-11-08', '2026-11-14'), loc, '2026-11-08', '2026-11-14')
    expect(days.map((x) => x.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])
  })
})
