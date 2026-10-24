import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { supabaseVolunteerStore } from '@/lib/volunteers/supabase'
import type { RegistrationInput } from '@/lib/volunteers/model'

/**
 * The Supabase store against a REAL PostgREST + Postgres with migrations
 * 0001–0005 applied: column mapping, RPC argument names, error mapping and
 * paging that the memory store cannot prove. Opt-in, because it needs both
 * running (see tests/sql/README.md):
 *
 *   VOL_PGRST_URL=http://127.0.0.1:3399 VOL_PGRST_JWT_SECRET=… npx vitest run tests/integration/volunteers-postgrest.test.ts
 */
const URL_ = process.env.VOL_PGRST_URL
const SECRET = process.env.VOL_PGRST_JWT_SECRET
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
function serviceKey(secret: string) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`
}

const H = 3_600_000
const run = randomUUID().slice(0, 8)
const reg = (n: string, extra: Partial<RegistrationInput> = {}): RegistrationInput => ({
  fullName: `${n} Cohen`, email: `${n}.${run}@x.com`, phone: '', adult: true, areas: ['tel_aviv'], availability: ['sun_morning'], skills: ['lifting'], transport: 'car', about: null,
  notifyReminders: true, notifyOpportunities: true, consentWhatsapp: false, ...extra,
})

describe.skipIf(!URL_ || !SECRET)('volunteer store over real PostgREST', () => {
  const db = () =>
    createClient(URL_!, serviceKey(SECRET!), {
      auth: { persistSession: false, autoRefreshToken: false },
      // Supabase serves PostgREST under /rest/v1; a bare PostgREST serves it at the root.
      global: { fetch: (u, i) => fetch(String(u).replace('/rest/v1', ''), i) },
    })

  it('runs the whole lifecycle with the same results as the memory store', async () => {
    const store = supabaseVolunteerStore(db())
    const phone = `05${String(Date.now()).slice(-8)}`
    const dana = await store.register(reg('dana', { phone }))
    expect(dana).toMatchObject({ fullName: 'dana Cohen', phone, adult: true, areas: ['tel_aviv'], availability: ['sun_morning'], skills: ['lifting'], status: 'active', source: 'app' })
    expect(dana.contactId).toBeTruthy()
    await expect(store.register(reg('dana'))).rejects.toThrow(/already registered/)
    expect((await store.getVolunteerByEmail(dana.email!))!.id).toBe(dana.id)

    const a = await store.createActivity({ title: `Sorting ${run}`, kind: 'sorting', area: 'tel_aviv', requiredSkills: ['lifting'], adultsOnly: true }, 'staff:test')
    expect(a).toMatchObject({ status: 'draft', requiredSkills: ['lifting'], adultsOnly: true, version: 1 })
    const pub = await store.setActivityStatus(a.id, 'draft', 'published')
    expect(pub.status).toBe('published')
    await expect(store.updateActivity(a.id, 1, { summary: 'stale' })).rejects.toThrow(/changed since it was loaded/)
    const edited = await store.updateActivity(a.id, pub.version, { summary: 'fresh' })
    expect(edited.summary).toBe('fresh')

    const startsAt = new Date(Date.now() + 48 * H).toISOString()
    const endsAt = new Date(Date.now() + 52 * H).toISOString()
    const { shift } = await store.saveShift(a.id, null, null, { label: 'בוקר', role: null, startsAt, endsAt, capacity: 1, minVolunteers: 1 }, 'staff:test')
    expect(shift).toMatchObject({ capacity: 1, label: 'בוקר', status: 'open' })
    expect(Date.parse(shift.startsAt)).toBe(Date.parse(startsAt))

    const yossi = await store.register(reg('yossi'))
    const s1 = await store.join(shift.id, dana.id, 'self', `volunteer:${dana.id}`)
    const s2 = await store.join(shift.id, yossi.id, 'self', `volunteer:${yossi.id}`)
    expect([s1.status, s2.status]).toEqual(['confirmed', 'waitlisted'])
    expect(s2.queuedAt).toBeTruthy()
    // Joining again is idempotent; staff placing someone on a full shift is refused, not waitlisted.
    expect((await store.join(shift.id, yossi.id, 'self', `volunteer:${yossi.id}`)).id).toBe(s2.id)
    const third = await store.register(reg('noa'))
    await expect(store.join(shift.id, third.id, 'staff', 'staff:test')).rejects.toThrow(/full/)

    // Raising capacity promotes the waitlist and returns who moved up.
    const raised = await store.saveShift(a.id, shift.id, shift.version, { label: 'בוקר', role: null, startsAt, endsAt, capacity: 2, minVolunteers: 1 }, 'staff:test')
    expect(raised.promoted.map((p) => p.volunteerId)).toEqual([yossi.id])

    // Leave returns the changed row first; nobody waiting means nobody promoted.
    const left = await store.leave(s1.id, 'cancelled', 'sick', `volunteer:${dana.id}`, dana.id)
    expect(left.signup).toMatchObject({ status: 'cancelled', cancelReason: 'sick' })
    expect(left.promoted).toEqual([])
    await expect(store.leave(s2.id, 'cancelled', null, `volunteer:${dana.id}`, dana.id)).rejects.toThrow()

    // Invitation → accept.
    const inv = await store.invite(shift.id, dana.id, 'staff:test')
    expect(inv.status).toBe('invited')
    expect((await store.join(shift.id, dana.id, 'invite', `volunteer:${dana.id}`)).status).toBe('confirmed')

    // Attendance only after the start; hours only from attendance.
    await expect(store.attendance(inv.id, 'full_shift', {}, null, 'staff:test', null)).rejects.toThrow()
    const views = await store.listSignups({ shiftIds: [shift.id], statuses: ['confirmed'] })
    expect(views).toHaveLength(2)

    // Outbox: duplicate keys are skipped; claim is atomic and marks the row.
    const key = `test:${run}`
    const added = await store.enqueue([{ volunteerId: dana.id, toEmail: dana.email!, kind: 'message', dedupeKey: key, subject: 'ש', body: 'ב' }])
    expect(added).toHaveLength(1)
    expect(await store.enqueue([{ volunteerId: dana.id, toEmail: dana.email!, kind: 'message', dedupeKey: key, subject: 'ש', body: 'ב' }])).toHaveLength(0)
    const claimed = await store.claimOutbox(500)
    expect(claimed.some((o) => o.dedupeKey === key)).toBe(true)
    await store.markOutbox(added[0]!.id, 'sent')
    expect((await store.listOutbox({ volunteerId: dana.id }))[0]!.status).toBe('sent')

    // Login codes: single use.
    await store.addLoginCode(dana.email!, 'hash', new Date(Date.now() + 600_000).toISOString())
    const code = (await store.latestLoginCode(dana.email!))!
    expect(await store.countLoginCodes(dana.email!, new Date(Date.now() - 60_000).toISOString())).toBe(1)
    expect(await store.consumeLoginCode(code.id)).toBe(true)
    expect(await store.consumeLoginCode(code.id)).toBe(false)

    // Notes, status, events.
    await store.addNote(dana.id, 'note', 'staff@x.com')
    expect((await store.listNotes(dana.id))[0]!.body).toBe('note')
    const paused = await store.setVolunteerStatus(dana.id, 'paused', 'staff:test')
    expect(paused.sessionVersion).toBeGreaterThan(dana.sessionVersion)
    expect((await store.listEvents({ volunteerId: dana.id })).map((e) => e.kind)).toContain('registered')

    // Cancel the activity: future sign-ups are cancelled and returned for the emails.
    const cancelled = await store.cancel(a.id, null, 'rain', 'staff:test')
    expect(cancelled.map((s) => s.volunteerId).sort()).toEqual([dana.id, yossi.id].sort())
    expect((await store.getActivity(a.id))!.status).toBe('cancelled')

    // Forget: personal data gone, contact unlinked.
    const gone = await store.forget(yossi.id, 'staff:test')
    expect(gone).toMatchObject({ status: 'deleted', email: null, phone: null })
  })

  it('checks in on the day, records hours only from attendance, and reads past the row cap', async () => {
    const store = supabaseVolunteerStore(db())
    const v = await store.register(reg('day'))
    const a = await store.createActivity({ title: `Today ${run}`, kind: 'sorting' }, 'staff:test')
    await store.setActivityStatus(a.id, 'draft', 'published')
    const { shift } = await store.saveShift(a.id, null, null, { label: null, role: null, startsAt: new Date(Date.now() - H).toISOString(), endsAt: new Date(Date.now() + 2 * H).toISOString(), capacity: 1, minVolunteers: 0 }, 'staff:test')
    await expect(store.join(shift.id, v.id, 'self', 'v')).rejects.toThrow(/started/)
    const w = await store.join(shift.id, v.id, 'walk_in', 'staff:test')
    expect(w).toMatchObject({ status: 'confirmed', source: 'walk_in' })
    await expect(store.selfCheckin(shift.id, v.id, 'wrong-code-000')).rejects.toThrow(/not valid/)
    const inn = await store.selfCheckin(shift.id, v.id, shift.checkinCode)
    expect(inn).toMatchObject({ attendance: 'present', attendanceMethod: 'qr', minutes: null })
    const full = await store.attendance(inn.id, 'full_shift', {}, null, 'staff:test', inn.version)
    expect(full.minutes).toBe(180)
    await expect(store.attendance(inn.id, 'absent', {}, null, 'staff:test', inn.version)).rejects.toThrow()
    const corr = await store.attendance(inn.id, 'correct', { in: new Date(Date.now() - H).toISOString(), out: new Date(Date.now() - H / 2).toISOString() }, 'late', 'staff:test', full.version)
    expect(corr.minutes).toBe(30)

    // Supabase caps a response at max_rows (run PostgREST with db-max-rows = 1000): the store must page.
    const since = new Date(Date.now() - 1000).toISOString()
    await store.enqueue(Array.from({ length: 1205 }, (_, i) => ({ volunteerId: v.id, toEmail: 'x@x.com', kind: 'message', dedupeKey: `bulk:${run}:${i}`, subject: 's', body: 'b', notBefore: new Date(Date.now() + 86_400_000).toISOString() })))
    expect((await store.listOutbox({ volunteerId: v.id, since, limit: 5000 })).length).toBe(1205)
  })

  it('a missing table reads as "run 0005", not as an empty list', async () => {
    const bad = createClient(URL_!, serviceKey(SECRET!), { auth: { persistSession: false }, global: { fetch: (u, i) => fetch(String(u).replace('/rest/v1', '').replace('cc_vol_activities', 'cc_vol_nope'), i) } })
    await expect(supabaseVolunteerStore(bad).listActivities()).rejects.toThrow(/0005_volunteers/)
  })
})
