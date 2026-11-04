import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { askSchedule, calendarNote, EXEC_PARAMS, executeProposal, namesForRefs, volunteerRef, type CreateMessage } from '@/lib/schedule/assistant'
import { memoryScheduleStore, seedSchedule } from '@/lib/volunteers/schedule-store'
import { buildDay, type SchedVolunteer } from '@/lib/volunteers/schedule'

const NOW = Date.parse('2026-11-04T08:00:00Z') // Wednesday
const TODAY = '2026-11-04'
const TUE = '2026-11-10'
const people: SchedVolunteer[] = [
  { id: '1a2b3c4d-0000-4000-8000-000000000001', fullName: 'יוסי כהן', phone: '0500000001', availability: ['tue_morning'], status: 'active' },
  { id: '9f8e7d6c-0000-4000-8000-000000000002', fullName: 'רותי לוי', phone: '0500000002', availability: ['tue_morning'], status: 'active' },
]
const [yossi, ruti] = people as [SchedVolunteer, SchedVolunteer]

function setup() {
  const d = seedSchedule()
  d.admins.push({ locationId: d.locations[0]!.id, email: 'dafna@x' })
  const store = memoryScheduleStore(d, { kind: 'admin', email: 'dafna@x' }, () => people, () => NOW)
  const tue = d.slots.find((s) => s.weekday === 2)!
  return { d, store, tue, loc: d.locations[0]!.id }
}

/** A scripted model: each round returns the next canned response, and every request is kept. */
function scripted(rounds: ((req: Anthropic.Beta.MessageCreateParamsNonStreaming) => Anthropic.Beta.BetaContentBlock[])[]) {
  const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []
  let i = 0
  const create: CreateMessage = async (req) => {
    seen.push(structuredClone(req))
    const content = rounds[i++]!(req)
    const tool = content.some((b) => b.type === 'tool_use')
    return { id: `m${i}`, type: 'message', role: 'assistant', model: 'x', content, stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Beta.BetaMessage
  }
  return { create, seen }
}
const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input }) as unknown as Anthropic.Beta.BetaContentBlock
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Anthropic.Beta.BetaContentBlock
const lastResults = (req: Anthropic.Beta.MessageCreateParamsNonStreaming) => JSON.stringify(req.messages.at(-1)!.content)

describe('the scheduling assistant', () => {
  it('"put Ruti instead of Yossi on Tuesday": looks them up, proposes, changes nothing until confirmed', async () => {
    const { store, tue, loc } = setup()
    await store.addRegular(tue.id, yossi.id, TODAY)
    const audits: string[] = []
    let ref = { yossi: '', ruti: '' }
    const { create, seen } = scripted([
      () => [use('t1', 'find_volunteer', { name: 'יוסי' }), use('t2', 'find_volunteer', { name: 'רותי' })],
      (req) => {
        const r = lastResults(req)
        ref = { yossi: /V-1a2b3c/.exec(r)![0], ruti: /V-9f8e7d/.exec(r)![0] }
        return [use('t3', 'propose_replace', { date: TUE, out_ref: ref.yossi, in_ref: ref.ruti, confirmed: true })]
      },
      () => [text(`הכרטיס למטה ישבץ את ${volunteerRef(ruti.id)} במקום ${volunteerRef(yossi.id)} ב-${TUE}. צריך את האישור שלך.`)],
    ])
    const res = await askSchedule('תשבץ את רותי במקום יוסי ביום שלישי', [], { create, model: 'm', store, locationId: loc, today: TODAY, audit: async (e) => void audits.push(`${e.action}:${e.target}:${e.outcome}`) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // The answer reaches the screen with names, not references.
    expect(res.answer).toContain('רותי לוי')
    expect(res.answer).toContain('יוסי כהן')
    expect(res.answer).not.toMatch(/V-[0-9a-f]{6}/)
    // Names and phones never went to the model provider (only the person's own question carries a name).
    const sent = JSON.stringify(seen.map((r) => r.messages.slice(1)))
    expect(sent).not.toContain('לוי')
    expect(sent).not.toContain('0500000002')
    // One proposal; nothing changed yet.
    expect(res.proposals).toHaveLength(1)
    const p = res.proposals![0]!
    expect(p.summary).toContain('רותי לוי במקום יוסי כהן')
    let day = buildDay(await store.load(loc, TUE, TUE), tue, TUE)
    expect(day.absent).toHaveLength(0)
    expect(day.assigned).toHaveLength(0)
    expect(audits).toContain('assistant.propose:replace:succeeded')
    expect(audits.at(-1)).toBe('assistant.ask:schedule:succeeded')

    // Confirm = re-validated params through the same store functions.
    const params = EXEC_PARAMS[p.kind].parse(p.params)
    await executeProposal(p.kind, params, store)
    day = buildDay(await store.load(loc, TUE, TUE), tue, TUE)
    expect(day.absent.map((x) => x.volunteer.id)).toEqual([yossi.id])
    expect(day.assigned.map((x) => x.volunteer.id)).toEqual([ruti.id])
    expect(day.coming).toBe(1)
  })

  it('refuses to propose what the schedule does not allow, and says why to the model', async () => {
    const { store, loc } = setup()
    const { create, seen } = scripted([
      () => [use('t1', 'propose_replace', { date: TUE, out_ref: volunteerRef(yossi.id), in_ref: volunteerRef(ruti.id), confirmed: true })],
      () => [text('יוסי לא משובץ ביום הזה.')],
    ])
    const res = await askSchedule('x', [], { create, model: 'm', store, locationId: loc, today: TODAY, audit: async () => undefined })
    expect(res.ok && res.proposals).toBeFalsy()
    expect(lastResults(seen[1]!)).toContain('is not scheduled')
  })

  it('answers "how many are missing" from the same numbers as the screen', async () => {
    const { store, tue, loc } = setup()
    await store.updateSlot(tue.id, null, { required: 4 })
    await store.addRegular(tue.id, yossi.id, TODAY)
    const { create, seen } = scripted([() => [use('t1', 'get_schedule', { from: TUE, to: TUE })], () => [text('חסרים 3.')]])
    await askSchedule('כמה חסרים ביום שלישי?', [], { create, model: 'm', store, locationId: loc, today: TODAY, audit: async () => undefined })
    const r = JSON.parse(JSON.parse(lastResults(seen[1]!))[0].content)
    expect(r.days[0]).toMatchObject({ date: TUE, required: 4, coming: 1, missing: 3 })
  })

  it('an audit failure stops the answer', async () => {
    const { store, loc } = setup()
    const { create } = scripted([() => [text('hi')]])
    await expect(askSchedule('x', [], { create, model: 'm', store, locationId: loc, today: TODAY, audit: async () => { throw new Error('db down') } })).rejects.toThrow('db down')
  })

  it('gives the model the real dates for "Tuesday" and turns references back into names', () => {
    expect(calendarNote(TODAY, [1, 2, 3])).toContain('Tuesday 2026-11-10')
    expect(calendarNote(TODAY, [1, 2, 3])).toContain('Wednesday 2026-11-04')
    expect(namesForRefs(`${volunteerRef(ruti.id)} and V-000000`, people)).toBe('רותי לוי and V-000000')
  })
})
