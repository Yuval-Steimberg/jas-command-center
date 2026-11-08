import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { can, ROLES, type Role } from '@/lib/auth/rbac'
import { checkAction, moveInOrder, newId, portalFor, resolveDestination, safeNext, shareTarget, type AppUrls } from '@/lib/portal/model'
import { SEED_ACTIONS, SEED_CATEGORIES, seedData } from '@/lib/portal/seed'
import { memoryPortalStore } from '@/lib/portal/store'
import { toView } from '@/lib/portal/model'
import { WHO_OPTIONS } from '@/lib/portal/who'

const APPS: AppUrls = {
  furniture: 'https://collect.example.org',
  volunteers: 'https://volunteers.example.org',
  website: 'https://shop.example.org',
  map: 'https://map.example.org',
  gift_cards: 'https://gift.example.org',
}

const seen = (role: Role, apps = APPS) => portalFor(seedData(), { role }, apps)
const ids = (role: Role, apps = APPS) => seen(role, apps).flatMap((c) => c.actions.map((a) => a.id))

describe('destinations', () => {
  it('resolves internal paths, https addresses and app addresses', () => {
    expect(resolveDestination('/shop/sell', APPS)).toEqual({ ok: true, href: '/shop/sell', external: false, app: null })
    expect(resolveDestination('https://t.me/jas', APPS)).toMatchObject({ ok: true, href: 'https://t.me/jas', external: true })
    expect(resolveDestination('app:website/shop', APPS)).toMatchObject({ ok: true, href: 'https://shop.example.org/shop', app: 'website' })
    expect(resolveDestination('app:furniture', APPS)).toMatchObject({ ok: true, href: 'https://collect.example.org/' })
  })

  it('refuses what could send someone somewhere unexpected', () => {
    for (const bad of ['//evil.example', 'http://plain.example', 'javascript:alert(1)', 'https://user:pw@x.example', '/portal/a/sale', 'app:nope', 'shop/sell', '/a b'])
      expect(resolveDestination(bad, APPS).ok, bad).toBe(false)
    expect(resolveDestination('', APPS)).toEqual({ ok: false, reason: 'empty' })
    expect(resolveDestination('app:volunteers/my', {})).toEqual({ ok: false, reason: 'app_not_configured', app: 'volunteers' })
  })

  it('after sign-in, goes back only to a page on this site', () => {
    expect(safeNext('/portal/a/sale')).toBe('/portal/a/sale')
    expect(safeNext('/shop/items?q=כיסא')).toBe('/shop/items?q=כיסא')
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/login', '', null, undefined]) expect(safeNext(bad), String(bad)).toBeNull()
  })
})

describe('who sees what', () => {
  it('a shop seller sees the shop and customer work only', () => {
    // Intake: a seller may take collected items into storage (inventory:operate), listed under mapping where the job starts.
    expect(ids('seller')).toEqual(['intake', 'gift-buy-link', 'item-search', 'sale', 'item-new', 'customer-new', 'shop-link', 'map-open'])
    expect(seen('seller').map((c) => c.id)).toEqual(['mapping', 'gift-cards', 'inventory', 'map'])
  })

  it('gift cards: redeeming, finding and the admin follow the gift card permissions; the buy link is for everyone', () => {
    const gift = (r: Role, apps = APPS) => ids(r, apps).filter((x) => x.startsWith('gift-'))
    expect(gift('owner')).toEqual(['gift-redeem', 'gift-find', 'gift-buy-link', 'gift-admin'])
    expect(gift('operations_manager')).toEqual(['gift-redeem', 'gift-find', 'gift-buy-link'])
    expect(gift('viewer')).toEqual(['gift-find', 'gift-buy-link'])
    expect(gift('seller')).toEqual(['gift-buy-link'])
    for (const r of ROLES) expect(gift(r).includes('gift-admin'), r).toBe(can(r, 'gift_cards:write'))
    // The gift card system's address not configured: its two links are hidden, never dead buttons.
    const { gift_cards: _, ...noGift } = APPS
    expect(gift('owner', noGift)).toEqual(['gift-find', 'gift-buy-link'])
    expect(resolveDestination('app:gift_cards/employee', APPS)).toMatchObject({ ok: true, href: 'https://gift.example.org/employee' })
  })

  it('a volunteer coordinator sees volunteers, not money or customers', () => {
    const v = ids('volunteer_coordinator')
    expect(v).toEqual(expect.arrayContaining(['schedule', 'attendance', 'volunteer-reminder', 'map-apartment', 'projects']))
    for (const x of ['sale', 'item-search', 'customer-new', 'inventory-manage', 'links', 'staff']) expect(v).not.toContain(x)
  })

  it('only the owner manages the portal and the staff', () => {
    for (const r of ROLES) {
      expect(ids(r).includes('links'), r).toBe(r === 'owner')
      expect(ids(r).includes('staff'), r).toBe(can(r, 'users:manage'))
    }
  })

  it('a link with no address, or whose app has no address here, is never shown', () => {
    expect(ids('owner')).not.toContain('designers-group')
    expect(ids('owner', { ...APPS, furniture: undefined })).not.toContain('map-apartment')
    expect(ids('owner')).toContain('map-apartment')
  })

  it('switched-off links and categories disappear, and an empty category is left out', () => {
    const d = seedData()
    d.categories.find((c) => c.id === 'map')!.active = false
    d.actions.find((a) => a.id === 'sale')!.active = false
    const shown = portalFor(d, { role: 'owner' }, APPS)
    expect(shown.map((c) => c.id)).not.toContain('map')
    expect(shown.flatMap((c) => c.actions.map((a) => a.id))).not.toContain('sale')
    expect(portalFor(d, { role: null }, APPS)).toEqual([])
  })

  it('respects per-deployment permission overrides', () => {
    expect(ids('seller')).toContain('sale')
    const shown = portalFor(seedData(), { role: 'seller', overrides: { seller: { 'inventory:financial': false } } }, APPS)
    expect(shown.flatMap((c) => c.actions.map((a) => a.id))).not.toContain('sale')
  })

  it('every role but the scheduler (who lives in schedule mode) sees something', () => {
    for (const r of ROLES) if (r !== 'scheduler') expect(ids(r).length, r).toBeGreaterThan(0)
  })
})

/** The permission a page demands, for the destinations this repo serves. */
function pagePermission(path: string): string | null | undefined {
  const p = path.split('?')[0]!
  if (p.startsWith('/schedule')) return 'schedule' // its own database grant (migration 0011)
  const shop = p.startsWith('/shop')
  const file = join(process.cwd(), shop || p.startsWith('/portal') ? join('app', p) : join('app', '(app)', p), 'page.tsx')
  if (!existsSync(file)) return undefined
  const m = readFileSync(file, 'utf8').match(/requirePageAccess\('([^']+)'\)/)
  return m?.[1] ?? (shop ? 'inventory:read' : null)
}

describe('the seeded links', () => {
  it('every internal destination is a real page, never looser than the page it opens', () => {
    for (const a of SEED_ACTIONS.filter((x) => x.destination.startsWith('/'))) {
      const page = pagePermission(a.destination)
      expect(page, a.destination).not.toBeUndefined()
      if (!page || page === 'schedule') continue
      for (const r of ROLES) if (!a.permission || can(r, a.permission)) expect(can(r, page as never), `${r} → ${a.id} → ${a.destination}`).toBe(true)
    }
  })

  it('customer links are public addresses, and pass the save rules', () => {
    for (const a of SEED_ACTIONS) {
      if (a.audience === 'customer') expect(a.destination.startsWith('/'), a.id).toBe(false)
      expect(checkAction(a, APPS, WHO_OPTIONS.map((o) => o.permission).filter(Boolean) as string[]), a.id).toEqual([])
    }
  })

  it('ids are unique and every category exists', () => {
    expect(new Set(SEED_ACTIONS.map((a) => a.id)).size).toBe(SEED_ACTIONS.length)
    for (const a of SEED_ACTIONS) expect(SEED_CATEGORIES.some((c) => c.id === a.categoryId), a.id).toBe(true)
    expect(SEED_CATEGORIES).toHaveLength(7)
  })

  it('the migrations insert exactly the same set', () => {
    const sql = ['0014_portal.sql', '0015_portal_gift_cards.sql', '0017_portal_change_chat.sql'].map((f) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8')).join('\n')
    const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`)
    for (const c of SEED_CATEGORIES) expect(sql, c.id).toContain(`(${q(c.id)}, ${q(c.title)}, ${q(c.subtitle)}, ${q(c.icon)}, ${c.sort}, ${c.active})`)
    for (const a of SEED_ACTIONS)
      expect(sql, a.id).toContain(`(${q(a.id)}, ${q(a.categoryId)}, ${q(a.title)}, ${q(a.description)}, ${q(a.destination)}, ${q(a.audience)}, ${q(a.permission)}, ${a.sort}, ${a.active})`)
  })

  it('every seeded permission has a name in link management', () => {
    for (const a of SEED_ACTIONS) expect(WHO_OPTIONS.some((o) => o.permission === a.permission), a.id).toBe(true)
  })
})

describe('sharing', () => {
  const shown = (id: string) => seen('owner').flatMap((c) => c.actions).find((a) => a.id === id)!

  it('a team link is shared as the portal link, which checks sign-in and permission', () => {
    expect(shareTarget(shown('sale'), 'https://cc.example')).toBe('https://cc.example/portal/a/sale')
    expect(toView(shown('sale')).shareUrl).toBe('/portal/a/sale')
  })

  it('a customer link is shared as the public address itself, never a sign-in page', () => {
    expect(shareTarget(shown('shop-link'), 'https://cc.example')).toBe('https://shop.example.org/shop')
    expect(toView(shown('shop-link')).shareUrl).toBe('https://shop.example.org/shop')
  })
})

describe('link management rules', () => {
  const base = { categoryId: 'design', title: 'קבוצה', description: '', destination: '', audience: 'team' as const, permission: null, active: false }
  const known = ['inventory:read', 'users:manage']

  it('a link can be saved off without an address, but not switched on', () => {
    expect(checkAction(base, APPS, known)).toEqual([])
    expect(checkAction({ ...base, active: true }, APPS, known)).toHaveLength(1)
    expect(checkAction({ ...base, active: true, destination: 'https://t.me/x' }, APPS, known)).toEqual([])
  })

  it('a bad address or an unknown permission is refused even when off', () => {
    expect(checkAction({ ...base, destination: 'http://x.example' }, APPS, known)).toHaveLength(1)
    expect(checkAction({ ...base, permission: 'made:up' }, APPS, known)).toHaveLength(1)
  })

  it('nothing internal or managerial is offered as a link to send outside', () => {
    expect(checkAction({ ...base, audience: 'customer', destination: '/inventory' }, APPS, known).length).toBeGreaterThan(0)
    expect(checkAction({ ...base, audience: 'customer', destination: 'https://x.example', permission: 'users:manage' }, APPS, known).length).toBeGreaterThan(0)
  })

  it('reorders and names new rows predictably', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'up')).toEqual(['a', 'c', 'b'])
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c'])
    expect(newId('design', new Set(['design-1']))).toBe('design-2')
  })
})

describe('memory store', () => {
  it('a stale edit is refused, never overwrites the newer one', async () => {
    const st = memoryPortalStore(seedData())
    const a = (await st.load()).actions.find((x) => x.id === 'sale')!
    const saved = await st.saveAction({ ...a, title: 'מכירה' }, a.updatedAt)
    expect(saved.updatedAt > a.updatedAt).toBe(true)
    await expect(st.saveAction({ ...a, title: 'ישן' }, a.updatedAt)).rejects.toMatchObject({ conflict: true })
    await expect(st.deleteAction('sale', a.updatedAt)).rejects.toMatchObject({ conflict: true })
    expect((await st.load()).actions.find((x) => x.id === 'sale')!.title).toBe('מכירה')
  })

  it('adding refuses a taken id or a missing category; reorder writes positions', async () => {
    const st = memoryPortalStore(seedData())
    const a = (await st.load()).actions[0]!
    await expect(st.saveAction(a, null)).rejects.toMatchObject({ conflict: true })
    await expect(st.saveAction({ ...a, id: 'x-1', categoryId: 'nope' }, null)).rejects.toMatchObject({ conflict: true })
    await st.reorder('category', ['admin', 'volunteers'])
    const cats = (await st.load()).categories
    expect(cats.find((c) => c.id === 'admin')!.sort).toBe(1)
    expect(cats.find((c) => c.id === 'volunteers')!.sort).toBe(2)
  })

  it('the seed itself is never mutated by edits', async () => {
    const st = memoryPortalStore(seedData())
    const a = (await st.load()).actions.find((x) => x.id === 'sale')!
    await st.saveAction({ ...a, title: 'אחר' }, a.updatedAt)
    expect(SEED_ACTIONS.find((x) => x.id === 'sale')!.title).toBe('רישום מכירה')
  })
})
