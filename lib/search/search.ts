import 'server-only'
import type { Permission, Product } from '@/lib/auth/rbac'
import { NAV, SECTIONS } from '@/components/shell/nav'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { DESTINATIONS, searchFurnitureItems } from '@/lib/integrations/furniture/manage'
import { searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { listWebsiteOrders, listWebsiteProducts } from '@/lib/integrations/website/manage'
import { getMapData } from '@/lib/integrations/map/adapter'
import { getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import type { SourceResult } from '@/lib/integrations/types'
import { getOpsStore, OpsSetupError } from '@/lib/ops'
import { STATUS_LABEL } from '@/lib/inventory/model'
import { ROLE_LABEL } from '@/lib/crm/model'
import { matchDocs, type SearchDoc } from './match'

export interface SearchGroup {
  key: string
  label: string
  product: Product | null
  /** ok = searched; not_configured / error = could not search; unsupported = the source offers no way to search it yet. */
  state: 'ok' | 'not_configured' | 'error' | 'unsupported'
  note?: string
  results: SearchDoc[]
}

/**
 * One search box over everything the command center can read. Each group says
 * whether it was searched: "no results" and "could not search" are different
 * answers, and a source with no search endpoint says so instead of looking empty.
 * Only sources the user may read are searched at all.
 */
export async function searchEverything(query: string, can: (p: Permission) => boolean): Promise<SearchGroup[]> {
  const top = NAV.flatMap((s) => s.items).filter((i) => !i.permission || can(i.permission))
  const pages: SearchDoc[] = [
    ...top.map((i) => ({ title: i.label, subtitle: i.hint, href: i.href })),
    // Pages inside a section ("Intake from collections", "Messages"), found by name too.
    ...SECTIONS.flatMap((sec) => {
      const parent = top.find((i) => i.href === sec.base)
      if (!parent) return []
      return sec.tabs
        .filter((t) => t.href !== sec.base && (!t.permission || can(t.permission)))
        .map((t) => ({ title: t.label, subtitle: parent.label, href: t.href }))
    }),
  ]

  const fromSource = async <T>(key: string, label: string, product: Product, read: () => Promise<SourceResult<T>>, toDocs: (d: T) => SearchDoc[]): Promise<SearchGroup | null> => {
    if (!can(`${product}:read`)) return null
    const r = await read()
    if (r.state === 'not_configured') return { key, label, product, state: 'not_configured', note: `Not connected (${r.missing.join(', ')})`, results: [] }
    if (r.state === 'error') return { key, label, product, state: 'error', note: r.error, results: [] }
    return { key, label, product, state: 'ok', results: matchDocs(toDocs(r.data), query) }
  }

  // A source that searches server-side. Its own filter decides the hits; matching again here could drop
  // a hit the source found by a field we do not show (an email, an order number).
  const fromQuery = async <T>(key: string, label: string, product: Product, need: Permission, read: () => Promise<SourceResult<T>>, toDocs: (d: T) => SearchDoc[]): Promise<SearchGroup | null> => {
    if (!can(need)) return null
    const r = await read()
    if (r.state === 'not_configured') return { key, label, product, state: 'not_configured', note: `Not connected (${r.missing.join(', ')})`, results: [] }
    if (r.state === 'error') return { key, label, product, state: 'error', note: r.error, results: [] }
    return { key, label, product, state: 'ok', results: toDocs(r.data).slice(0, 10) }
  }

  // The command center's own records: no SourceResult, so a missing migration or a database error is mapped here.
  const fromOps = async (key: string, label: string, product: Product, need: Permission, read: () => Promise<SearchDoc[]>): Promise<SearchGroup | null> => {
    if (!can(need)) return null
    try {
      return { key, label, product, state: 'ok', results: matchDocs(await read(), query).slice(0, 10) }
    } catch (e) {
      return e instanceof OpsSetupError
        ? { key, label, product, state: 'not_configured', note: 'Migration 0003 has not been run', results: [] }
        : { key, label, product, state: 'error', note: e instanceof Error ? e.message : String(e), results: [] }
    }
  }

  const groups = await Promise.all([
    fromOps('inventory', 'Inventory items', 'inventory', 'inventory:read', async () =>
      (await getOpsStore().listItems({ q: query, limit: 50 })).map((i) => ({
        title: `${i.sku} · ${i.title}`,
        subtitle: [STATUS_LABEL[i.status], i.category, i.furnitureProjectName].filter(Boolean).join(' · '),
        href: `/inventory/${i.id}`,
        text: [i.sku, i.description],
      })),
    ),
    // Contacts are found by name, email or phone: personal data, so the group needs read_pii.
    fromOps('contacts', 'Customers & contacts', 'crm', 'crm:read_pii', async () =>
      (await getOpsStore().listContacts({ q: query, limit: 50 })).map((c) => ({
        title: c.fullName,
        subtitle: [c.roles.map((r) => ROLE_LABEL[r]).join(', '), c.phone ?? c.email].filter(Boolean).join(' · '),
        href: `/crm/${c.id}`,
        text: [c.email, c.phone],
      })),
    ),
    { key: 'pages', label: 'Pages', product: null, state: 'ok' as const, results: matchDocs(pages, query) },
    fromSource('furniture', 'Furniture projects', 'furniture', getFurnitureProjects, (ps) =>
      ps.map((p) => ({ title: p.name, subtitle: [p.city, p.developer_name, p.archived ? 'archived' : null].filter(Boolean).join(' · ') || null, href: '/furniture' })),
    ),
    fromSource('map', 'Map places', 'map', getMapData, (m) =>
      m.places.map((p) => ({
        title: p.name,
        subtitle: [m.categories.find((c) => c.key === p.cat)?.label ?? p.cat, p.address].filter(Boolean).join(' · '),
        href: '/map',
        text: [p.sub, p.desc],
      })),
    ),
    fromSource('design', 'Design projects', 'design_agent', getDesignAgentStatus, (s) =>
      s.projects.map((p) => ({ title: p.title || `Project #${p.id}`, subtitle: [p.kind, p.status, p.current_version ? `v${p.current_version}` : null].filter(Boolean).join(' · '), href: '/design-agent' })),
    ),
    (async (): Promise<SearchGroup | null> => {
      if (!can('furniture:read')) return null
      // The database matched one word; every word must match, Hebrew-aware, like the other groups.
      const [hits, projects] = await Promise.all([searchFurnitureItems(query), getFurnitureProjects()])
      const names = new Map(projects.state === 'ok' ? projects.data.map((p) => [p.id, p.name]) : [])
      const g = await fromQuery('furniture-items', 'Furniture items', 'furniture', 'furniture:read', async () => hits, (hs) =>
        matchDocs(
          hs.filter((h) => h.status !== 'discarded').map((h) => ({
            title: h.description,
            subtitle: [names.get(h.project_id), DESTINATIONS.find((d) => d.id === h.gallery_type)?.label].filter(Boolean).join(' · ') || null,
            href: `/furniture/${h.project_id}`,
          })),
          query,
        ),
      )
      return g
    })(),
    // Searching cards finds them by buyer / recipient name or email, so it needs PII access. Masked codes only.
    fromQuery('gift', 'Gift cards', 'gift_cards', 'gift_cards:read_pii', () => searchGiftCards(query), (s) =>
      s.items.map((c) => ({ title: c.maskedCode, subtitle: [c.status, c.recipientName].filter(Boolean).join(' · '), href: `/gift-cards/${c.id}` })),
    ),
    fromQuery('website-orders', 'Website orders', 'website', 'website:read_pii', () => listWebsiteOrders(query), (os) =>
      os.map((o) => ({ title: `#${o.order_number}`, subtitle: [o.customer_name, o.status, `₪${o.total}`].filter(Boolean).join(' · '), href: `/website/orders?q=${encodeURIComponent(o.order_number)}` })),
    ),
    fromQuery('website-products', 'Website products', 'website', 'website:read', () => listWebsiteProducts(query), (ps) =>
      ps.map((p) => ({ title: p.name_he, subtitle: [p.name_en, p.price != null ? `₪${p.price}` : null, p.quantity != null ? `${p.quantity} in stock` : null].filter(Boolean).join(' · '), href: `/website/products/${p.id}` })),
    ),
  ])
  return groups.filter((g): g is SearchGroup => g !== null)
}
