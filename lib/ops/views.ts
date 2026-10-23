import type { Contact, Location } from './types'

/** "Warehouse A › Zone 2 › Shelf 3" for every location, for pickers and tables. */
export function locationLabels(locations: Location[]): Map<string, string> {
  const byId = new Map(locations.map((l) => [l.id, l]))
  const out = new Map<string, string>()
  for (const l of locations) {
    const parts: string[] = []
    let cur: Location | undefined = l
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      parts.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    out.set(l.id, parts.join(' › '))
  }
  return out
}

export const locationOptions = (locations: Location[]) => {
  const labels = locationLabels(locations)
  return locations.filter((l) => l.active).map((l) => ({ id: l.id, label: labels.get(l.id)! })).sort((a, b) => a.label.localeCompare(b.label))
}

/** Without crm:read_pii a contact is shown by number and roles only. */
export function contactLabel(c: Pick<Contact, 'id' | 'fullName' | 'phone' | 'email' | 'roles'>, pii: boolean): string {
  if (!pii) return `Contact ${c.id.slice(0, 8)}${c.roles.length ? ` (${c.roles.join(', ')})` : ''}`
  return [c.fullName, c.phone ?? c.email].filter(Boolean).join(' · ')
}
