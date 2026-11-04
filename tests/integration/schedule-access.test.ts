import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { memoryScheduleStore, seedPlaces, seedSchedule, ScheduleForbiddenError } from '@/lib/volunteers/schedule-store'
import { pickLocation } from '@/lib/schedule/places'
import { buildDay, type SchedLocation, type SchedVolunteer } from '@/lib/volunteers/schedule'
import { absenceAlertEmails, reminderDedupeKey, reminderEmail, reminderRecipients, reminderWeek, reminderWhatsappText, weekDays, whatsappShareUrl } from '@/lib/volunteers/schedule-reminder'
import { emptyVolData, memoryVolunteerStore } from '@/lib/volunteers/store'
import { askSchedule, EXEC_PARAMS, executeProposal, volunteerRef, type CreateMessage } from '@/lib/schedule/assistant'

// Wednesday 2026-11-04, 10:00 Israel.
const NOW = Date.parse('2026-11-04T08:00:00Z')
const TODAY = '2026-11-04'
const NEXT_WEEK = '2026-11-08'
const people: SchedVolunteer[] = [
  { id: '1a2b3c4d-0000-4000-8000-000000000001', fullName: 'יוסי כהן', phone: '0500000001', availability: ['tue_morning'], status: 'active' },
  { id: '9f8e7d6c-0000-4000-8000-000000000002', fullName: 'רותי לוי', phone: '0500000002', availability: ['tue_morning'], status: 'active', reservist: true },
  { id: '5e5e5e5e-0000-4000-8000-000000000003', fullName: 'אבי מזרחי', phone: '0500000003', availability: [], status: 'active' },
  { id: '7a7a7a7a-0000-4000-8000-000000000004', fullName: 'דנה בר', phone: null, availability: [], status: 'active' },
]
const [yossi, ruti, avi, dana] = people as [SchedVolunteer, SchedVolunteer, SchedVolunteer, SchedVolunteer]

function setup() {
  const d = seedSchedule()
  const loc = d.locations[0]!.id
  d.admins.push({ locationId: loc, email: 'dafna@x' }, { locationId: loc, email: 'sharon@x', access: 'view' })
  const vols = () => people
  const dafna = memoryScheduleStore(d, { kind: 'admin', email: 'dafna@x' }, vols, () => NOW)
  const sharon = memoryScheduleStore(d, { kind: 'admin', email: 'sharon@x' }, vols, () => NOW)
  const app = memoryScheduleStore(d, { kind: 'service' }, vols, () => NOW)
  const slot = (wd: number) => d.slots.find((s) => s.weekday === wd)!
  return { d, loc, dafna, sharon, app, mon: slot(1), tue: slot(2), wed: slot(3) }
}

describe('a location manager (view access)', () => {
  it('sees the whole schedule and changes nothing, through any write', async () => {
    const { loc, dafna, sharon, tue } = setup()
    await dafna.addRegular(tue.id, yossi.id, TODAY)
    expect((await sharon.myLocations()).map((l) => l.access)).toEqual(['view'])
    expect((await dafna.myLocations()).map((l) => l.access)).toEqual(['schedule'])
    const day = buildDay(await sharon.load(loc, '2026-11-10', '2026-11-10'), tue, '2026-11-10')
    expect(day.regulars.map((p) => p.volunteer.id)).toEqual([yossi.id])

    const writes: [string, () => Promise<unknown>][] = [
      ['updateSlot', () => sharon.updateSlot(tue.id, null, { required: 5 })],
      ['addRegular', () => sharon.addRegular(tue.id, ruti.id, TODAY)],
      ['absence', () => sharon.absence(tue.id, yossi.id, '2026-11-10', null, 'admin')],
      ['assign', () => sharon.assign(tue.id, ruti.id, '2026-11-10', 'confirmed', null, null)],
      ['replace', () => sharon.replace(tue.id, '2026-11-10', yossi.id, ruti.id, 'confirmed', null)],
      ['closure', () => sharon.setClosure(tue.id, '2026-11-10', true, null)],
      ['reminder', () => sharon.logReminder(loc, NEXT_WEEK, 'email', 1)],
    ]
    for (const [name, w] of writes) await expect(w(), name).rejects.toBeInstanceOf(ScheduleForbiddenError)
    // Nothing changed.
    expect(buildDay(await dafna.load(loc, '2026-11-10', '2026-11-10'), tue, '2026-11-10').coming).toBe(1)
  })

  it('only schedulers receive the absence alert', async () => {
    const { app, tue } = setup()
    expect(await app.schedulerEmails(tue.id)).toEqual(['dafna@x'])
  })
})

describe('the weekly reminder', () => {
  it('is about the coming week, and goes to everyone expected that week, once each', async () => {
    const { loc, dafna, mon, tue, wed } = setup()
    expect(reminderWeek(TODAY)).toBe(NEXT_WEEK)
    expect(reminderWeek('2026-11-08')).toBe('2026-11-08') // on Sunday, this week
    await dafna.addRegular(tue.id, yossi.id, TODAY)
    await dafna.addRegular(wed.id, yossi.id, TODAY)
    await dafna.addRegular(tue.id, ruti.id, TODAY)
    await dafna.addRegular(mon.id, dana.id, TODAY)
    await dafna.absence(tue.id, ruti.id, '2026-11-10', null, 'admin') // already said she won't come
    await dafna.assign(wed.id, avi.id, '2026-11-11', 'tentative', null, null) // asked, not confirmed
    await dafna.setClosure(mon.id, '2026-11-09', true, 'חג') // closed: Dana is not expected
    const data = await dafna.load(loc, NEXT_WEEK, '2026-11-14')
    expect(weekDays(data, NEXT_WEEK, TODAY).map((x) => x.date)).toEqual(['2026-11-10', '2026-11-11'])
    expect(reminderRecipients(data, NEXT_WEEK, TODAY)).toEqual([{ volunteerId: yossi.id, dates: ['2026-11-10', '2026-11-11'] }])
  })

  it('a second press for the same week sends nothing new (outbox dedupe)', async () => {
    const vs = memoryVolunteerStore(emptyVolData(), () => NOW)
    const v = await vs.register({ fullName: 'יוסי כהן', email: 'yossi@x.test', phone: '0500000001', adult: true, areas: [], availability: [], skills: [], transport: 'none', about: null, notifyReminders: true, notifyOpportunities: false, consentWhatsapp: false })
    const o = { locationId: 'L', locationName: 'הסדנה של שרון', week: NEXT_WEEK, appUrl: 'https://vol.example/', notBefore: new Date(NOW).toISOString() }
    const row = reminderEmail(v, { volunteerId: v.id, dates: ['2026-11-10'] }, o)!
    expect(row.dedupeKey).toBe(reminderDedupeKey('L', NEXT_WEEK, v.id))
    expect(row.body).toContain('יום שלישי 10.11')
    expect(row.body).toContain('https://vol.example/')
    expect(await vs.enqueue([row])).toHaveLength(1)
    expect(await vs.enqueue([row])).toHaveLength(0)
    expect(reminderEmail({ ...v, email: null }, { volunteerId: v.id, dates: [] }, o)).toBeNull()
  })

  it('WhatsApp text names no volunteer and opens WhatsApp with it filled in', () => {
    const t = reminderWhatsappText({ locationName: 'הסדנה של שרון', days: ['2026-11-10', '2026-11-11'], appUrl: 'https://vol.example' })
    expect(t).toContain('יום שלישי 10.11, יום רביעי 11.11')
    expect(t).not.toMatch(/יוסי|רותי/)
    expect(whatsappShareUrl(t)).toBe(`https://wa.me/?text=${encodeURIComponent(t)}`)
  })

  it('is logged only by a scheduler, about a week that starts on Sunday', async () => {
    const { loc, dafna } = setup()
    const r = await dafna.logReminder(loc, NEXT_WEEK, 'whatsapp', 3)
    expect(r).toMatchObject({ weekStart: NEXT_WEEK, channel: 'whatsapp', recipients: 3, sentBy: 'dafna@x' })
    await expect(dafna.logReminder(loc, '2026-11-09', 'email', 3)).rejects.toThrow(/Sunday/)
    expect((await dafna.listReminders(loc)).map((x) => x.id)).toEqual([r.id])
  })
})

describe('the absence alert', () => {
  it('tells each scheduler who, when, and how the day now stands, with a link to fill it', async () => {
    const { loc, dafna, tue } = setup()
    await dafna.updateSlot(tue.id, null, { required: 3 })
    await dafna.addRegular(tue.id, yossi.id, TODAY)
    await dafna.addRegular(tue.id, ruti.id, TODAY)
    const a = await dafna.absence(tue.id, yossi.id, '2026-11-10', 'חולה', 'admin')
    const day = buildDay(await dafna.load(loc, '2026-11-10', '2026-11-10'), tue, '2026-11-10')
    const [m, ...rest] = absenceAlertEmails(['dafna@x'], { absenceId: a.id, volunteerName: 'יוסי כהן', date: '2026-11-10', reason: 'חולה', locationName: 'הסדנה של שרון', slotId: tue.id, day, ccUrl: 'https://cc.example', notBefore: new Date(NOW).toISOString() })
    expect(rest).toHaveLength(0)
    expect(m).toMatchObject({ volunteerId: null, toEmail: 'dafna@x', kind: 'schedule_absence', dedupeKey: `sched-absence:${a.id}:dafna@x` })
    expect(m!.subject).toBe('יוסי כהן לא מגיע/ה ביום שלישי 10.11')
    expect(m!.body).toContain('מגיעים עכשיו: 1 מתוך 3 · חסרים 2')
    expect(m!.body).toContain(`https://cc.example/schedule/day/${tue.id}/2026-11-10`)
  })
})

describe('the assistant for a location manager', () => {
  const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Anthropic.Beta.BetaContentBlock
  const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input }) as unknown as Anthropic.Beta.BetaContentBlock
  function scripted(rounds: Anthropic.Beta.BetaContentBlock[][]) {
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []
    let i = 0
    const create: CreateMessage = async (req) => {
      seen.push(structuredClone(req))
      const content = rounds[i++]!
      return { id: `m${i}`, type: 'message', role: 'assistant', model: 'x', content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Beta.BetaMessage
    }
    return { create, seen }
  }

  it('is offered read tools only, and a change it asks for anyway is refused', async () => {
    const { loc, sharon } = setup()
    const audits: string[] = []
    const { create, seen } = scripted([[use('t1', 'propose_add_regular', { weekday: 2, ref: volunteerRef(ruti.id), from: TODAY })], [text('אין לי הרשאה.')]])
    const res = await askSchedule('תוסיף את רותי לשלישי', [], { create, model: 'm', store: sharon, locationId: loc, today: TODAY, readOnly: true, audit: async (e) => void audits.push(`${e.action}:${e.outcome}`) })
    expect(seen[0]!.tools!.map((t) => (t as { name: string }).name).filter((n) => n.startsWith('propose_'))).toEqual([])
    expect(res.ok && res.proposals).toBeFalsy()
    expect(audits).toContain('assistant.tool:denied')
  })

  it('a scheduler can be offered "make X a regular", which changes nothing until confirmed', async () => {
    const { loc, dafna, tue } = setup()
    const { create } = scripted([[use('t1', 'propose_add_regular', { weekday: 2, ref: volunteerRef(ruti.id), from: TODAY })], [text('לאישור למטה.')]])
    const res = await askSchedule('תוסיף את רותי לשלישי', [], { create, model: 'm', store: dafna, locationId: loc, today: TODAY, audit: async () => undefined })
    expect(res.ok && res.proposals?.[0]?.summary).toBe('רותי לוי יגיע/תגיע כל שבוע בימי שלישי, החל מיום רביעי 4.11.')
    expect((await dafna.load(loc, TODAY, '2026-11-10')).regulars).toHaveLength(0)
    const p = res.ok ? res.proposals![0]! : null
    await executeProposal(p!.kind, EXEC_PARAMS[p!.kind].parse(p!.params), dafna)
    expect((await dafna.load(loc, TODAY, '2026-11-10')).regulars.map((r) => [r.slotId, r.volunteerId])).toEqual([[tue.id, ruti.id]])
  })
})

describe('several places (0013)', () => {
  it('seeds the three places Sunday to Friday, with required only where unset', () => {
    const d = seedPlaces()
    expect(d.locations.map((l) => l.name)).toEqual(['בית המלאכה של שרון', 'מתחם כללי', 'חנות הגלריה'])
    for (const l of d.locations) expect(d.slots.filter((s) => s.locationId === l.id).map((s) => s.weekday).sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(d.slots.map((s) => s.id)).size).toBe(d.slots.length)
    expect(d.slots.filter((s) => s.locationId === d.locations[0]!.id).every((s) => s.required === 10)).toBe(true)
  })

  it('Dafna schedules every place, Liat only the store, Sharon only sees the workshop; the database decides each write', async () => {
    const d = seedPlaces()
    const [workshop, compound, store] = d.locations as [SchedLocation, SchedLocation, SchedLocation]
    for (const l of d.locations) d.admins.push({ locationId: l.id, email: 'dafna@x' })
    d.admins.push({ locationId: store.id, email: 'liat@x' }, { locationId: compound.id, email: 'gil@x' }, { locationId: workshop.id, email: 'sharon@x', access: 'view' })
    const as = (email: string) => memoryScheduleStore(d, { kind: 'admin', email }, () => people, () => NOW)
    const mine = await as('dafna@x').myLocations()
    expect(mine.map((l) => l.id).sort()).toEqual(d.locations.map((l) => l.id).sort())
    expect((await as('liat@x').myLocations()).map((l) => l.id)).toEqual([store.id])
    const storeTue = d.slots.find((s) => s.locationId === store.id && s.weekday === 2)!
    const shopTue = d.slots.find((s) => s.locationId === workshop.id && s.weekday === 2)!
    await as('liat@x').addRegular(storeTue.id, yossi.id, TODAY)
    await expect(as('liat@x').addRegular(shopTue.id, ruti.id, TODAY)).rejects.toBeInstanceOf(ScheduleForbiddenError)
    await expect(as('sharon@x').addRegular(shopTue.id, ruti.id, TODAY)).rejects.toBeInstanceOf(ScheduleForbiddenError)
    // An absence alert reaches the schedulers of THAT place only.
    expect((await as('dafna@x').schedulerEmails(storeTue.id)).sort()).toEqual(['dafna@x', 'liat@x'])
    expect(await as('dafna@x').schedulerEmails(shopTue.id)).toEqual(['dafna@x'])
  })

  it('opens the remembered place if it is still theirs, else the first they schedule', () => {
    const ls = [{ id: 'a', access: 'view' as const }, { id: 'b', access: 'schedule' as const }, { id: 'c', access: 'schedule' as const }]
    expect(pickLocation(ls, 'c')?.id).toBe('c')
    expect(pickLocation(ls, 'gone')?.id).toBe('b')
    expect(pickLocation(ls, null)?.id).toBe('b')
    expect(pickLocation([{ id: 'a', access: 'view' as const }], null)?.id).toBe('a')
    expect(pickLocation([], 'a')).toBeUndefined()
  })
})
