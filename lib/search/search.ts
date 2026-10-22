import 'server-only'
import type { Permission, Product } from '@/lib/auth/rbac'
import { NAV } from '@/components/shell/nav'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getMapData } from '@/lib/integrations/map/adapter'
import { getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import type { SourceResult } from '@/lib/integrations/types'
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
  const pages: SearchDoc[] = NAV.flatMap((s) => s.items)
    .filter((i) => !i.permission || can(i.permission))
    .map((i) => ({ title: i.label, subtitle: 'Command center page', href: i.href }))

  const fromSource = async <T>(key: string, label: string, product: Product, read: () => Promise<SourceResult<T>>, toDocs: (d: T) => SearchDoc[]): Promise<SearchGroup | null> => {
    if (!can(`${product}:read`)) return null
    const r = await read()
    if (r.state === 'not_configured') return { key, label, product, state: 'not_configured', note: `Not connected (${r.missing.join(', ')})`, results: [] }
    if (r.state === 'error') return { key, label, product, state: 'error', note: r.error, results: [] }
    return { key, label, product, state: 'ok', results: matchDocs(toDocs(r.data), query) }
  }

  const unsupported = (key: string, label: string, product: Product, note: string): SearchGroup | null =>
    can(`${product}:read`) ? { key, label, product, state: 'unsupported', note, results: [] } : null

  const groups = await Promise.all([
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
    unsupported('gift', 'Gift cards', 'gift_cards', 'Card lookup needs a search endpoint on the gift card system (masked codes only); not built yet.'),
    unsupported('website', 'Website orders & products', 'website', 'The website exposes aggregates only; searching orders or products needs a narrow endpoint there.'),
  ])
  return groups.filter((g): g is SearchGroup => g !== null)
}
