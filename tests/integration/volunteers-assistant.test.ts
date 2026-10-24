import { beforeEach, describe, expect, it } from 'vitest'
import { emptyVolData, type MemoryVolData } from '@/lib/volunteers/store'
import { getVolunteerStore } from '@/lib/volunteer-store'
import { proposalDef } from '@/lib/assistant/proposals'
import { VOLUNTEER_TOOLS } from '@/lib/assistant/volunteer-tools'
import { volunteersSection } from '@/lib/analytics/volunteers'
import { METRIC_BY_ID } from '@/lib/metrics-catalog'
import type { RegistrationInput } from '@/lib/volunteers/model'

const g = globalThis as unknown as { __ccVolData?: MemoryVolData }
const H = 3_600_000
const reg = (n: string): RegistrationInput => ({
  fullName: `${n} Levi`, email: `${n}@x.com`, phone: '', adult: true, areas: ['tel_aviv'], availability: [], skills: ['lifting'], transport: 'car', about: null,
  notifyReminders: true, notifyOpportunities: false, consentWhatsapp: false,
})

async function world() {
  const store = getVolunteerStore()
  const v = await store.register(reg('dana'))
  const a = await store.createActivity({ title: 'Collection – Bialik 12', kind: 'collection', area: 'tel_aviv' }, 'staff:x')
  await store.setActivityStatus(a.id, 'draft', 'published')
  const { shift } = await store.saveShift(a.id, null, null, { label: null, role: null, startsAt: new Date(Date.now() + 48 * H).toISOString(), endsAt: new Date(Date.now() + 52 * H).toISOString(), capacity: 3, minVolunteers: 2 }, 'staff:x')
  return { store, v, shift }
}

const tool = (name: string) => VOLUNTEER_TOOLS.find((t) => t.name === name)!
const owner = { can: () => true }

beforeEach(() => {
  g.__ccVolData = emptyVolData()
})

describe('assistant: volunteer proposals write nothing until confirmed', () => {
  it('invite: describes the volunteer by reference, changes nothing, then invites once on confirm', async () => {
    const { store, v, shift } = await world()
    const before = JSON.stringify(g.__ccVolData)
    const r = await proposalDef('volunteer_invite')!.prepare({ shiftId: shift.id, volunteerId: v.id })
    expect(r.ok).toBe(true)
    expect(r.ok && r.summary).toContain(`V-${v.id.slice(0, 6)}`)
    expect(r.ok && r.summary).not.toMatch(/dana|Levi/i)
    expect(JSON.stringify(g.__ccVolData)).toBe(before)

    const done = await proposalDef('volunteer_invite')!.execute(r.ok ? r.params : {}, { email: 'owner@x.com', role: 'owner' })
    expect(done.ok).toBe(true)
    expect((await store.listSignups({ shiftIds: [shift.id] })).map((s) => s.status)).toEqual(['invited'])
    expect(g.__ccVolData!.outbox.filter((o) => o.kind === 'invited')).toHaveLength(1)
    // Asked again: refused at proposal time, nobody is invited twice.
    expect(await proposalDef('volunteer_invite')!.prepare({ shiftId: shift.id, volunteerId: v.id })).toMatchObject({ ok: false })
  })

  it('message: refused with nobody confirmed; once confirmed, confirming twice sends once', async () => {
    const { store, v, shift } = await world()
    expect(await proposalDef('volunteer_message_shift')!.prepare({ shiftId: shift.id, text: 'מביאים כפפות' })).toMatchObject({ ok: false })
    await store.join(shift.id, v.id, 'self', 'v')
    const before = g.__ccVolData!.outbox.length
    const r = await proposalDef('volunteer_message_shift')!.prepare({ shiftId: shift.id, text: 'מביאים כפפות' })
    expect(r).toMatchObject({ ok: true, params: { requestId: expect.any(String) } })
    expect(g.__ccVolData!.outbox.length).toBe(before)
    const actor = { email: 'owner@x.com', role: 'owner' }
    await proposalDef('volunteer_message_shift')!.execute(r.ok ? r.params : {}, actor)
    await proposalDef('volunteer_message_shift')!.execute(r.ok ? r.params : {}, actor)
    expect(g.__ccVolData!.outbox.filter((o) => o.kind === 'message')).toHaveLength(1)
  })
})

describe('assistant: volunteer reads never carry names or contact details', () => {
  it('overview and suggestions return references and counts only', async () => {
    const { store, v, shift } = await world()
    await store.register({ ...reg('yossi'), areas: ['tel_aviv'], skills: ['lifting'] })
    await store.join(shift.id, v.id, 'self', 'v')
    const overview = await tool('get_volunteer_overview').run({ period: '7d' }, owner)
    expect(overview).toMatchObject({ status: 'ok', data: { counts: { registeredNow: 2 }, next14Days: [{ shiftId: shift.id, confirmed: 1, minimum: 2, belowMinimum: true }] } })
    const sugg = await tool('suggest_volunteers_for_shift').run({ shiftId: shift.id }, owner)
    expect(sugg).toMatchObject({ status: 'ok', data: { found: true } })
    for (const out of [overview, sugg]) expect(JSON.stringify(out)).not.toMatch(/dana|yossi|Levi|@x\.com/i)
  })
})

describe('analytics: volunteers section', () => {
  it('every metric is in the catalog with the same basis and product; a missing migration is unavailable, never zero', async () => {
    const { store, v, shift } = await world()
    await store.join(shift.id, v.id, 'self', 'v')
    const data = { volunteers: await store.listVolunteers(), activities: await store.listActivities(), shifts: await store.listShifts(), signups: await store.listSignups() }
    const range = { from: '2026-01-01', to: '2026-12-31' }
    const previous = { from: '2025-01-01', to: '2025-12-31' }
    const sec = volunteersSection({ state: 'ok', data, checkedAt: 'now' }, range, previous)
    for (const m of sec.metrics) expect(METRIC_BY_ID.get(m.id), m.id).toMatchObject({ basis: m.basis, product: 'volunteers' })
    expect(sec.metrics.find((m) => m.id === 'vol.signedUp')!.value).toBe(1)
    expect(sec.metrics.find((m) => m.id === 'vol.attended')!.value).toBe(0)
    const off = volunteersSection({ state: 'not_configured', detail: 'run 0005' }, range, previous)
    expect(off.metrics.every((m) => m.value === null && m.quality === 'unavailable')).toBe(true)
  })
})
