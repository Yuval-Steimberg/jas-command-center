import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parsePlacesData } from '@/lib/integrations/map/parse'

const sample = readFileSync(path.join(__dirname, '../fixtures/places-data.sample.js'), 'utf8')

describe('places-data.js parser', () => {
  it('reads the real file format', () => {
    const d = parsePlacesData(sample)
    expect(d.categories.map((c) => c.key)).toContain('anchor')
    expect(d.places).toHaveLength(3)
    expect(d.places[0]).toMatchObject({ id: 1, name: 'Just A Second', cat: 'anchor' })
    expect(d.places[0]!.lat).toBeCloseTo(32.06, 1)
    expect(d.places[0]!.desc).toContain('\n') // escape sequences decoded, not raw
  })

  it('never executes code: calls, identifiers and template expressions are rejected', () => {
    expect(() => parsePlacesData(`const CATS = {}; const LOCS = [ fetch('x') ];`)).toThrow()
    expect(() => parsePlacesData('const CATS = {}; const LOCS = [{id:1, name:`${process.env.X}`, lat:1, lng:1}];')).toThrow()
    expect(() => parsePlacesData(`const CATS = { a: someVar }; const LOCS = [];`)).toThrow()
    expect(() => parsePlacesData(`const CATS = { ['a'+'b']: {} }; const LOCS = [];`)).toThrow()
    expect(() => parsePlacesData(`const CATS = { get a() { return 1 } }; const LOCS = [];`)).toThrow()
  })

  it('rejects bad data instead of showing it', () => {
    expect(() => parsePlacesData(`const CATS = {}; const LOCS = [{id:1,name:'a',lat:1,lng:1},{id:1,name:'b',lat:1,lng:1}];`)).toThrow(/duplicate/)
    expect(() => parsePlacesData(`const CATS = {}; const LOCS = [{id:1,name:'a',lat:200,lng:1}];`)).toThrow(/coordinates/)
    expect(() => parsePlacesData(`const CATS = {}; const LOCS = [{id:1,name:'a'}];`)).toThrow(/lat/)
    expect(() => parsePlacesData(`const CATS = {};`)).toThrow(/LOCS/)
  })

  it('accepts negative coordinates', () => {
    expect(parsePlacesData(`const CATS = {}; const LOCS = [{id:1,name:'a',lat:-33.9,lng:-70.6}];`).places[0]!.lat).toBe(-33.9)
  })
})
