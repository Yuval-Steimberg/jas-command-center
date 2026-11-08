import { describe, expect, it } from 'vitest'
import { buildToday, classifyScan, frequent, type Use } from '@/lib/portal/today'
import { memoryUsageStore } from '@/lib/portal/usage'
import type { Handover } from '@/lib/sales/handovers'
import type { Item, Task } from '@/lib/ops/types'

const TODAY = '2026-11-08'
const ME = 'me-profile'

const handover = (o: Partial<Handover>): Handover =>
  ({ key: Math.random().toString(36), line: null, delivery: null, sale: null, item: null, kind: 'pickup', scheduledFor: null, timeWindow: null, address: null, ref: null, contactId: null, overdue: false, ...o }) as Handover
const item = (o: Partial<Item>): Item => ({ id: `i-${Math.random()}`, status: 'reserved', reservedUntil: null, ...o }) as Item
const task = (o: Partial<Task>): Task =>
  ({ id: `t-${Math.random()}`, title: 'x', detail: null, status: 'open', dueAt: null, assigneeProfileId: null, entityKind: null, entityId: null, source: 'manual', dedupeKey: null, createdBy: 'a', createdAt: '', completedAt: null, completedBy: null, ...o }) as Task

describe('buildToday', () => {
  it('words the shop queues, urgent first, each line opening its screen', () => {
    const r = buildToday({
      handovers: [handover({ overdue: true, kind: 'delivery' }), handover({ kind: 'delivery', scheduledFor: `${TODAY}T10:00:00Z` }), handover({ kind: 'delivery', scheduledFor: '2026-11-12' }), handover({}), handover({})],
      reserved: [item({ reservedUntil: `${TODAY}T20:00:00Z` }), item({ reservedUntil: '2026-11-20' })],
      tasks: [task({ assigneeProfileId: ME, dueAt: '2026-11-07' }), task({ assigneeProfileId: ME }), task({ dueAt: TODAY }), task({}), task({ assigneeProfileId: 'other', dueAt: TODAY })],
      userId: ME,
      today: TODAY,
    })
    expect(r.unreadable).toEqual([])
    const byKey = Object.fromEntries(r.lines.map((l) => [l.key, l]))
    expect(byKey['handover-late']!.text).toBe('משלוח אחד באיחור')
    expect(byKey['handover-today']!.text).toBe('משלוח אחד יוצא היום')
    expect(byKey['handover-pickup']!.text).toBe('2 לקוחות אמורים לאסוף פריטים שקנו')
    expect(byKey['reserved-ending']!.href).toMatch(/^\/shop\/items\/i-/)
    expect(byKey['tasks-due']!.text).toBe('משימה אחת שלך להיום')
    expect(byKey['tasks-mine']!.text).toBe('משימה פתוחה אחת שלך')
    expect(byKey['tasks-free']!.text).toBe('משימה אחת להיום שאף אחד עוד לא לקח')
    // A delivery later this week and an unassigned task with no date are not "today".
    expect(r.lines).toHaveLength(7)
    const firstCalm = r.lines.findIndex((l) => !l.urgent)
    expect(r.lines.slice(firstCalm).every((l) => !l.urgent)).toBe(true)
  })

  it('a queue that could not be read is named, never shown as nothing to do; one the person may not see is silent', () => {
    const r = buildToday({ handovers: undefined, reserved: null, tasks: [], userId: ME, today: TODAY })
    expect(r.lines).toEqual([])
    expect(r.unreadable).toEqual(['מסירות'])
  })
})

describe('frequent', () => {
  const shown = ['sale', 'item-search', 'item-new', 'customer-new', 'inquiries'].map((id) => ({ id }))
  const u = (actionId: string, uses: number, lastUsedAt = '2026-11-01'): Use => ({ actionId, uses, lastUsedAt })
  it('two uses or more, most used first, ties by the latest, only what the person can still see, at most four', () => {
    const top = frequent([u('sale', 9), u('item-search', 3, '2026-11-02'), u('item-new', 3, '2026-11-05'), u('gone', 50), u('inquiries', 1), u('customer-new', 2)], shown)
    expect(top.map((a) => a.id)).toEqual(['sale', 'item-new', 'item-search', 'customer-new'])
    expect(frequent([u('sale', 1)], shown)).toEqual([])
  })

  it('the memory store counts per person and per button', async () => {
    const st = memoryUsageStore(new Map())
    await st.record('a', 'sale')
    await st.record('a', 'sale')
    await st.record('b', 'sale')
    await st.record('a', 'item-new')
    expect((await st.forProfile('a')).find((x) => x.actionId === 'sale')!.uses).toBe(2)
    expect((await st.forProfile('b')).map((x) => x.actionId)).toEqual(['sale'])
    expect((await st.totals()).get('sale')).toBe(3)
  })
})

describe('classifyScan', () => {
  const id = '3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f'
  it('item labels: the QR link (either screen) or the SKU', () => {
    expect(classifyScan(`https://cc.example/inventory/${id}`)).toEqual({ kind: 'item', id })
    expect(classifyScan(`https://cc.example/shop/items/${id}?x=1`)).toEqual({ kind: 'item', id })
    expect(classifyScan(' JAS-0042 ')).toEqual({ kind: 'sku', code: 'JAS-0042' })
    expect(classifyScan('104233')).toEqual({ kind: 'sku', code: '104233' })
  })

  it('gift cards: the recipient QR link or the printed code, in any case or spacing', () => {
    const token = 'aB3_dE5-fG7hJ9kL1mN2pQ4rS6tU8vW0xY2zA4bC6d'
    expect(classifyScan(`https://gift.justasecond.co.il/gift/${token}`)).toEqual({ kind: 'gift_url', token })
    expect(classifyScan('jas 7f3k qp2m 9')).toEqual({ kind: 'gift_code', code: 'JAS-7F3K-QP2M-9' })
    expect(classifyScan('JAS-7F3K-QP2M-9')).toEqual({ kind: 'gift_code', code: 'JAS-7F3K-QP2M-9' })
    // Not over http, and not a short path segment.
    expect(classifyScan(`http://gift.example/gift/${token}`).kind).toBe('sku')
    expect(classifyScan('https://gift.example/gift/abc').kind).toBe('sku')
  })

  it('nothing typed is nothing', () => {
    expect(classifyScan('   ')).toEqual({ kind: 'empty' })
  })
})
