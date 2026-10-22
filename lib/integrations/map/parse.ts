import { parse, type Node } from 'acorn'

/**
 * Interactive-map keeps its data as JavaScript (`const CATS = {...}; const
 * LOCS = [...]`). We read it as DATA: the file is parsed to an AST and only
 * literal objects, arrays, strings, numbers, booleans and null are accepted.
 * Nothing in it is ever executed, so a bad commit cannot run code here.
 */
export interface MapCategory {
  key: string
  label: string
  icon: string
  color: string
}
export interface MapPlace {
  id: number
  name: string
  sub: string | null
  cat: string
  lat: number
  lng: number
  desc: string | null
  hours: string | null
  contact: string | null
  address: string | null
  [extra: string]: unknown
}
export interface MapData {
  categories: MapCategory[]
  places: MapPlace[]
}

type Literal = string | number | boolean | null | Literal[] | { [k: string]: Literal }

function toValue(node: Node): Literal {
  const n = node as Node & Record<string, any>
  switch (n.type) {
    case 'Literal':
      if (n.regex || typeof n.value === 'bigint') throw new Error('unsupported literal')
      return n.value as Literal
    case 'TemplateLiteral':
      if (n.expressions.length) throw new Error('template expressions are not data')
      return n.quasis.map((q: any) => q.value.cooked).join('')
    case 'UnaryExpression':
      if (n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return -n.argument.value
      throw new Error(`unsupported unary ${n.operator}`)
    case 'ArrayExpression':
      return n.elements.map((e: Node | null) => {
        if (!e || e.type === 'SpreadElement') throw new Error('holes/spread are not data')
        return toValue(e)
      })
    case 'ObjectExpression': {
      const out: Record<string, Literal> = {}
      for (const p of n.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) throw new Error('only plain properties are data')
        const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value)
        out[key] = toValue(p.value)
      }
      return out
    }
    default:
      throw new Error(`unsupported node ${n.type}`)
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

export function parsePlacesData(source: string): MapData {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script' }) as Node & { body: any[] }
  const decls = new Map<string, Literal>()
  for (const stmt of ast.body) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const d of stmt.declarations) if (d.id.type === 'Identifier' && d.init) decls.set(d.id.name, toValue(d.init))
  }
  const cats = decls.get('CATS')
  const locs = decls.get('LOCS')
  if (!cats || typeof cats !== 'object' || Array.isArray(cats)) throw new Error('CATS object not found')
  if (!Array.isArray(locs)) throw new Error('LOCS array not found')

  const categories = Object.entries(cats).map(([key, c]) => {
    const o = (c ?? {}) as Record<string, unknown>
    return { key, label: str(o.label) ?? key, icon: str(o.icon) ?? '', color: str(o.color) ?? '#626B65' }
  })
  const places = locs.map((l, i) => {
    const o = (l ?? {}) as Record<string, unknown>
    if (typeof o.id !== 'number' || typeof o.name !== 'string' || typeof o.lat !== 'number' || typeof o.lng !== 'number')
      throw new Error(`place #${i + 1} is missing id/name/lat/lng`)
    if (Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) throw new Error(`place ${o.id} has impossible coordinates`)
    return {
      ...o,
      id: o.id,
      name: o.name,
      sub: str(o.sub),
      cat: str(o.cat) ?? 'unknown',
      lat: o.lat,
      lng: o.lng,
      desc: str(o.desc),
      hours: str(o.hours),
      contact: str(o.contact),
      address: str(o.address),
    } satisfies MapPlace
  })
  const ids = new Set<number>()
  for (const p of places) {
    if (ids.has(p.id)) throw new Error(`duplicate place id ${p.id}`)
    ids.add(p.id)
  }
  return { categories, places }
}
