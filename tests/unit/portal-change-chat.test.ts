import { describe, expect, it } from 'vitest'
import { ChatOutputSchema, LIMITS, applyInput, checkChanges, devIssueBody, outputJsonSchema, registryText, toTurns, type ChatOutput } from '@/lib/portal/change-chat'
import { seedData } from '@/lib/portal/seed'
import { memoryPortalStore } from '@/lib/portal/store'
import type { PortalAction } from '@/lib/portal/model'

const APPS = { furniture: 'https://field.example', volunteers: 'https://vol.example', website: 'https://site.example', map: 'https://map.example', gift_cards: 'https://gift.example' }

const blank = {
  id: null,
  title: null,
  description: null,
  destination: null,
  audience: null,
  permission: null,
  category_id: null,
  subtitle: null,
  icon: null,
  active: null,
  direction: null,
} as const

const out = (changes: Partial<ChatOutput['changes'][number]>[], dev: ChatOutput['developer_request'] = null): ChatOutput =>
  ChatOutputSchema.parse({ reply: 'בסדר', changes: changes.map((c) => ({ ...blank, summary: 'שינוי', op: 'edit_action', ...c })), developer_request: dev })

describe('checkChanges', () => {
  it('an edit keeps every field it does not name, and remembers the version it was made from', () => {
    const data = seedData()
    const r = checkChanges(out([{ op: 'edit_action', id: 'sale', title: 'מכירה בקופה' }]), data, APPS)
    expect(r.dropped).toEqual([])
    const c = r.changes[0]!
    expect(c.mode === 'save' && c.kind === 'action').toBe(true)
    if (c.mode !== 'save' || c.kind !== 'action') return
    const sale = data.actions.find((a) => a.id === 'sale')!
    expect(c.row).toMatchObject({ id: 'sale', title: 'מכירה בקופה', destination: sale.destination, permission: sale.permission, categoryId: sale.categoryId, sort: sale.sort })
    expect(c.expectedUpdatedAt).toBe(sale.updatedAt)
    expect(c.show.before).toContain('רישום מכירה')
    expect(c.show.after).toContain('מכירה בקופה')
  })

  it('drops what names nothing, changes nothing, or breaks a link management rule', () => {
    const r = checkChanges(
      out([
        { op: 'edit_action', id: 'no-such', title: 'משהו' },
        { op: 'edit_action', id: 'sale', title: 'רישום מכירה' },
        { op: 'edit_action', id: 'sale', permission: 'root:everything' },
        { op: 'edit_action', id: 'sale', audience: 'customer' },
        { op: 'edit_action', id: 'sale', destination: 'http://evil.example' },
        { op: 'add_action', category_id: 'inventory', title: 'א', destination: '/shop' },
        { op: 'add_action', category_id: 'nope', title: 'כפתור חדש', destination: '/shop' },
      ]),
      seedData(),
      APPS,
    )
    expect(r.changes).toEqual([])
    expect(r.dropped).toHaveLength(7)
    for (const d of r.dropped) expect(d.reason.length).toBeGreaterThan(3)
  })

  it('a new link goes last in its category, with a fresh id', () => {
    const data = seedData()
    const r = checkChanges(out([{ op: 'add_action', category_id: 'inventory', title: 'חיפוש לקוח', description: 'לפי שם או טלפון', destination: '/crm', audience: 'team', permission: 'crm:write' }]), data, APPS)
    expect(r.dropped).toEqual([])
    const c = r.changes[0]!
    if (c.mode !== 'save' || c.kind !== 'action') throw new Error('expected an action save')
    expect(c.expectedUpdatedAt).toBeNull()
    expect(data.actions.some((a) => a.id === c.row.id)).toBe(false)
    expect(c.row.sort).toBe(Math.max(...data.actions.filter((a) => a.categoryId === 'inventory').map((a) => a.sort)) + 1)
  })

  it('"everyone" clears the permission; a category added in the same answer can take a link', () => {
    const r = checkChanges(
      out([
        { op: 'add_category', title: 'אירועים', subtitle: 'סדנאות ומפגשים', icon: 'link', active: true },
        { op: 'add_action', category_id: 'category-1', title: 'לוח אירועים', destination: 'https://site.example/events', audience: 'customer', permission: 'everyone' },
      ]),
      seedData(),
      APPS,
    )
    expect(r.dropped).toEqual([])
    expect(r.changes).toHaveLength(2)
    const a = r.changes[1]!
    if (a.mode !== 'save' || a.kind !== 'action') throw new Error('expected an action save')
    expect(a.row.permission).toBeNull()
    expect(a.row.categoryId).toBe('category-1')
  })

  it('toggle flips only on/off, and never switches on a link without an address', () => {
    const data = seedData()
    const off = data.actions.find((a) => !a.active && !a.destination)!
    const r = checkChanges(out([{ op: 'toggle_action', id: 'sale', title: 'מתעלם' }, { op: 'toggle_action', id: off.id }]), data, APPS)
    expect(r.changes).toHaveLength(1)
    const c = r.changes[0]!
    if (c.mode !== 'save' || c.kind !== 'action') throw new Error('expected an action save')
    expect(c.row.active).toBe(false)
    expect(c.row.title).toBe('רישום מכירה')
    expect(r.dropped).toHaveLength(1)
  })

  it('moves name a real item and a direction', () => {
    const r = checkChanges(out([{ op: 'move_category', id: 'gift-cards', direction: 'up' }, { op: 'move_action', id: 'nope', direction: 'up' }]), seedData(), APPS)
    expect(r.changes).toEqual([expect.objectContaining({ mode: 'move', kind: 'category', id: 'gift-cards', direction: 'up' })])
    expect(r.dropped).toHaveLength(1)
  })

  it('caps proposals per answer and keeps a development request only with a subject', () => {
    const many = Array.from({ length: LIMITS.changes + 3 }, () => ({ op: 'move_category' as const, id: 'map', direction: 'up' as const }))
    expect(checkChanges(out(many), seedData(), APPS).changes).toHaveLength(LIMITS.changes)
    expect(checkChanges(out([], { subject: '  ', details: 'x' }), seedData(), APPS).developerRequest).toBeNull()
    expect(checkChanges(out([], { subject: 'כפתורים גדולים', details: 'בטלפון' }), seedData(), APPS).developerRequest).toEqual({ subject: 'כפתורים גדולים', details: 'בטלפון' })
  })

  it('every checked change survives the round trip through the browser (applyInput)', () => {
    const r = checkChanges(
      out([
        { op: 'edit_action', id: 'sale', title: 'מכירה בקופה', permission: 'everyone' },
        { op: 'add_action', category_id: 'inventory', title: 'חיפוש לקוח', destination: '/crm', audience: 'team', permission: 'crm:write' },
        { op: 'toggle_action', id: 'shop-link' },
        { op: 'add_category', title: 'אירועים', subtitle: '', icon: 'link', active: true },
        { op: 'edit_category', id: 'map', subtitle: 'המקומות שלנו' },
        { op: 'move_action', id: 'sale', direction: 'down' },
        { op: 'move_category', id: 'map', direction: 'up' },
      ]),
      seedData(),
      APPS,
    )
    expect(r.dropped).toEqual([])
    expect(r.changes).toHaveLength(7)
    for (const c of r.changes) expect(applyInput.safeParse(JSON.parse(JSON.stringify(c))).success, c.summary).toBe(true)
    expect(applyInput.safeParse({ mode: 'save', kind: 'action', row: { id: 'x' }, expectedUpdatedAt: null, summary: '', show: { title: '', before: '', after: '' } }).success).toBe(false)
  })

  it('never mutates the registry it reads', () => {
    const data = seedData()
    const copy = JSON.stringify(data)
    checkChanges(out([{ op: 'edit_action', id: 'sale', title: 'מכירה בקופה' }, { op: 'add_category', title: 'חדש', subtitle: '', icon: 'link', active: true }]), data, APPS)
    expect(JSON.stringify(data)).toBe(copy)
  })

  it('a checked change saves through the store, and a stale one is refused', async () => {
    const data = seedData()
    const st = memoryPortalStore(data)
    const c = checkChanges(out([{ op: 'edit_action', id: 'sale', title: 'מכירה בקופה' }]), await st.load(), APPS).changes[0]!
    if (c.mode !== 'save' || c.kind !== 'action') throw new Error('expected an action save')
    await st.saveAction(c.row as Omit<PortalAction, 'updatedAt'>, c.expectedUpdatedAt)
    expect((await st.load()).actions.find((a) => a.id === 'sale')!.title).toBe('מכירה בקופה')
    await expect(st.saveAction(c.row as Omit<PortalAction, 'updatedAt'>, c.expectedUpdatedAt)).rejects.toThrow()
  })
})

describe('the output schema', () => {
  it('the JSON schema sent to the API names exactly the fields the parser reads', () => {
    const s = outputJsonSchema() as { required: string[]; properties: { changes: { items: { required: string[] } } } }
    expect(s.required.sort()).toEqual(Object.keys(ChatOutputSchema.shape).sort())
    expect(s.properties.changes.items.required.sort()).toEqual(Object.keys(ChatOutputSchema.shape.changes.element.shape).sort())
  })
})

describe('toTurns', () => {
  const img = 'data:image/jpeg;base64,AAAA'
  it('starts and ends with the owner, merges same-role turns, wraps the owner words', () => {
    const t = toTurns([
      { role: 'assistant', text: 'שלום' },
      { role: 'owner', text: 'א' },
      { role: 'owner', text: 'ב', images: [img] },
    ])!
    expect(t).toHaveLength(1)
    expect(t[0]!.role).toBe('user')
    expect(t[0]!.text).toContain('<owner_message>א</owner_message>')
    expect(t[0]!.images).toHaveLength(1)
    expect(toTurns([{ role: 'owner', text: 'א' }, { role: 'assistant', text: 'ב' }])).toBeNull()
  })

  it('keeps only the newest screenshots and ignores anything that is not an image data URL', () => {
    const t = toTurns([
      { role: 'owner', text: '1', images: [img, img, img] },
      { role: 'assistant', text: 'ok' },
      { role: 'owner', text: '2', images: [img, img, 'https://x.example/a.png'] },
    ])!
    expect(t[0]!.images.length + t[2]!.images.length).toBe(LIMITS.imagesTotal)
    expect(t[2]!.images).toHaveLength(2)
  })
})

describe('registryText and devIssueBody', () => {
  it('the registry lists every category and link with its id', () => {
    const data = seedData()
    const text = registryText(data)
    for (const a of data.actions) expect(text).toContain(`action ${a.id} |`)
    for (const c of data.categories) expect(text).toContain(`category ${c.id} |`)
  })

  it('the issue body carries the spec and the conversation, never image data', () => {
    const body = devIssueBody({ subject: 'x', details: 'כפתורים גדולים יותר', requestedBy: 'יעל', conversation: [{ role: 'owner', text: 'בקשה' }], screenshots: 2 })
    expect(body).toContain('כפתורים גדולים יותר')
    expect(body).toContain('יעל')
    expect(body).toContain('בקשה')
    expect(body).not.toContain('base64')
  })
})
