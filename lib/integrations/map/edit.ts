import { parse, type Node } from 'acorn'
import { z } from 'zod'
import { parsePlacesData, type MapData } from './parse'

/**
 * Rewrites places-data.js for one added or edited place — as TEXT, touching
 * only that place's line, so the pull request a person reviews is a one-line
 * diff in the file's own style rather than a reformatted file.
 *
 * Pure: the GitHub calls are in github.ts. The result is re-parsed with the
 * same reader the command center uses, so a change that would break the map
 * is refused here instead of reaching review.
 */

/** What a person may set on a place. Coordinates are WGS84 like the rest of the file. */
export const placeInput = z.object({
  name: z.string().trim().min(2).max(80),
  sub: z.string().trim().max(200).nullable(),
  cat: z.string().trim().min(1).max(40),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  desc: z.string().trim().max(2000).nullable(),
  hours: z.string().trim().max(200).nullable(),
  contact: z.string().trim().max(300).nullable(),
  address: z.string().trim().max(200).nullable(),
})
export type PlaceInput = z.infer<typeof placeInput>

/** The route is a walk around the store: a place 25 km away is almost always swapped lat/lng. */
export const MAX_DISTANCE_KM = 25

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** One-line JS object literal in the file's own style; strings are JSON-escaped, which is valid JS. */
function literal(o: Record<string, unknown>): string {
  const parts = Object.entries(o).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}:${v === undefined ? 'null' : JSON.stringify(v)}`)
  return `{${parts.join(', ')}}`
}

type Located = Node & { start: number; end: number }

function locsArray(source: string): { array: Located; elements: (Located & { properties: any[] })[] } {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script' }) as Node & { body: any[] }
  for (const stmt of ast.body) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const d of stmt.declarations) if (d.id.type === 'Identifier' && d.id.name === 'LOCS' && d.init?.type === 'ArrayExpression') return { array: d.init, elements: d.init.elements }
  }
  throw new Error('LOCS array not found')
}

export type EditResult = { ok: true; source: string; data: MapData; placeId: number; summary: string } | { ok: false; message: string }

function validate(input: PlaceInput, data: MapData): string | null {
  if (!data.categories.some((c) => c.key === input.cat)) return `Unknown category "${input.cat}".`
  const anchor = data.places.find((p) => p.cat === 'anchor') ?? data.places[0]
  if (anchor && km(anchor, input) > MAX_DISTANCE_KM) return `That point is ${Math.round(km(anchor, input))} km from ${anchor.name}. Check that latitude and longitude are not swapped.`
  return null
}

function finish(next: string, placeId: number, summary: string): EditResult {
  try {
    return { ok: true, source: next, data: parsePlacesData(next), placeId, summary }
  } catch (e) {
    return { ok: false, message: `The edited file would not parse: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Append a place with the next free id, on its own line before the closing bracket. */
export function addPlace(source: string, input: PlaceInput): EditResult {
  const data = parsePlacesData(source)
  const problem = validate(input, data)
  if (problem) return { ok: false, message: problem }
  if (data.places.some((p) => p.name.trim() === input.name.trim())) return { ok: false, message: `A place named "${input.name}" is already on the map.` }
  const id = Math.max(0, ...data.places.map((p) => p.id)) + 1
  const { array, elements } = locsArray(source)
  const lit = literal({ id, ...input })
  const last = elements[elements.length - 1]
  let next: string
  if (last) {
    // A new line after the last place, keeping the file's trailing-comma style.
    const comma = source.slice(last.end).match(/^[ \t]*,/)
    const at = last.end + (comma ? comma[0].length : 0)
    next = comma ? `${source.slice(0, at)}\n  ${lit},${source.slice(at)}` : `${source.slice(0, at)},\n  ${lit}${source.slice(at)}`
  } else {
    next = `${source.slice(0, array.start)}[\n  ${lit},\n]${source.slice(array.end)}`
  }
  return finish(next, id, `Add place #${id} "${input.name}"`)
}

/** Replace one place's literal in place. Fields not in the form (extra keys) are kept. */
export function editPlace(source: string, id: number, input: PlaceInput): EditResult {
  const data = parsePlacesData(source)
  const current = data.places.find((p) => p.id === id)
  if (!current) return { ok: false, message: `Place #${id} is not in the file.` }
  const problem = validate(input, data)
  if (problem) return { ok: false, message: problem }
  const { elements } = locsArray(source)
  const el = elements.find((e) => e.properties.some((p: any) => p.key?.name === 'id' && p.value?.value === id))
  if (!el) return { ok: false, message: `Place #${id} could not be located in the source.` }
  // Keep the current key order and any extra fields; overwrite the editable ones.
  const merged: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(current)) merged[k] = v
  Object.assign(merged, { id, ...input })
  const changed = (Object.keys(input) as (keyof PlaceInput)[]).filter((k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(input[k] ?? null))
  if (!changed.length) return { ok: false, message: 'Nothing changed.' }
  const next = `${source.slice(0, el.start)}${literal(merged)}${source.slice(el.end)}`
  return finish(next, id, `Edit place #${id} "${input.name}" (${changed.join(', ')})`)
}
