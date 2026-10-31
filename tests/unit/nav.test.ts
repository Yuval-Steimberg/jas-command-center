import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV, SECTIONS, START_TASKS, activeTab, isActive, sectionOf } from '@/components/shell/nav'
import { can, ROLES } from '@/lib/auth/rbac'

/** The file that renders a console path, and the permission it demands, if any. */
function pagePermission(href: string): { exists: boolean; permission: string | null } {
  const base = href.startsWith('/shop') ? join('app', href) : join('app', '(app)', href)
  const file = join(process.cwd(), base, 'page.tsx')
  if (!existsSync(file)) return { exists: false, permission: null }
  const m = readFileSync(file, 'utf8').match(/requirePageAccess\('([^']+)'\)/)
  return { exists: true, permission: m?.[1] ?? null }
}

const top = NAV.flatMap((g) => g.items)
// A tab with no permission of its own is seen only inside its section, so it inherits the section's.
const links = [
  ...top,
  ...SECTIONS.flatMap((s) => s.tabs.map((t) => ({ ...t, permission: t.permission ?? top.find((i) => i.href === s.base)?.permission }))),
  ...START_TASKS,
]

describe('navigation map', () => {
  it('every link opens a real page', () => {
    for (const l of links) expect(pagePermission(l.href).exists, l.href).toBe(true)
  })

  it('a link asks for the same permission as the page it opens, so nobody is shown a dead end', () => {
    for (const l of links) {
      const page = pagePermission(l.href).permission
      if (!page) continue
      // Anyone who is shown the link can open the page (a link may be stricter, never looser).
      for (const r of ROLES) if (!l.permission || can(r, l.permission as never)) expect(can(r, page as never), `${r} → ${l.href}`).toBe(true)
    }
  })

  it('every entry says what it is for', () => {
    for (const i of NAV.flatMap((g) => g.items)) expect(i.hint.length, i.href).toBeGreaterThan(10)
  })

  it('every top-level page appears once', () => {
    const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href))
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('a section with tabs is reachable from the sidebar', () => {
    const hrefs = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)))
    for (const s of SECTIONS) expect(hrefs.has(s.base), s.base).toBe(true)
  })

  it('a shop seller still gets the counter and none of the reports', () => {
    const seller = NAV.flatMap((g) => g.items).filter((i) => !i.permission || can('seller', i.permission))
    expect(seller.map((i) => i.href)).toContain('/shop')
    for (const r of ROLES) expect(NAV.flatMap((g) => g.items).filter((i) => !i.permission || can(r, i.permission)).length).toBeGreaterThan(0)
  })
})

describe('active page', () => {
  it('highlights the deepest matching tab', () => {
    const tabs = sectionOf('/website/products/new')!.tabs
    expect(activeTab('/website/products/new', tabs)).toBe('/website/products')
    expect(activeTab('/website', tabs)).toBe('/website')
    expect(activeTab('/inventory/123', sectionOf('/inventory/123')!.tabs)).toBe('/inventory')
  })

  it('does not confuse sections that share a prefix', () => {
    expect(sectionOf('/shop')).toBeNull()
    expect(isActive('/salesforce', '/sales')).toBe(false)
    expect(isActive('/', '/')).toBe(true)
    expect(isActive('/crm', '/')).toBe(false)
  })
})
