import { describe, expect, it } from 'vitest'
import { addPlace, editPlace, removePlace } from '@/lib/integrations/map/edit'
import { parsePlacesData } from '@/lib/integrations/map/parse'

const SOURCE = `// JAS Route
const CATS = {
  anchor: {label:'Just a Second', icon:'📍', color:'#3D5443'},
  cafe:   {label:'קפה ואוכל', icon:'☕', color:'#B8762A'},
};

const LOCS = [
  {id:1,  name:'Just A Second', sub:'חנות', cat:'anchor', lat:32.0620681, lng:34.7780304, desc:'שורה\\nשנייה', hours:"א׳–ה׳", contact:'058', address:'בגין 34', img:'a.jpg'},
  {id:3,  name:'קפה', sub:null, cat:'cafe', lat:32.0618, lng:34.7778, desc:null, hours:null, contact:null, address:null},
];
`
const place = { name: 'גלריה חדשה', sub: 'אמנות', cat: 'cafe', lat: 32.063, lng: 34.779, desc: "it's \"quoted\"\nline", hours: null, contact: null, address: 'השפלה 4' }

const changedLines = (a: string, b: string) => {
  const x = a.split('\n'), y = b.split('\n')
  return y.filter((l, i) => l !== x[i])
}

describe('editing places-data.js as text', () => {
  it('adds a place on one new line with the next id, and the file still parses', () => {
    const r = addPlace(SOURCE, place)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.placeId).toBe(4)
    expect(r.source.split('\n').length).toBe(SOURCE.split('\n').length + 1)
    const added = r.data.places.find((p) => p.id === 4)!
    expect(added).toMatchObject({ name: 'גלריה חדשה', desc: "it's \"quoted\"\nline", lat: 32.063 })
    expect(r.data.places).toHaveLength(3)
  })

  it('edits only that place\'s line and keeps fields the form does not show', () => {
    const r = editPlace(SOURCE, 1, { name: 'Just A Second', sub: 'חנות גלריה', cat: 'anchor', lat: 32.0620681, lng: 34.7780304, desc: 'שורה\nשנייה', hours: 'א׳–ה׳', contact: '058', address: 'בגין 34' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(changedLines(SOURCE, r.source)).toHaveLength(1)
    expect(r.summary).toContain('(sub)')
    expect(parsePlacesData(r.source).places[0]).toMatchObject({ sub: 'חנות גלריה', img: 'a.jpg' })
  })

  it('refuses an unknown category, a far-away point, a duplicate name and a no-op', () => {
    expect(addPlace(SOURCE, { ...place, cat: 'nope' })).toMatchObject({ ok: false })
    expect(addPlace(SOURCE, { ...place, lat: 34.779, lng: 32.063 })).toMatchObject({ ok: false, message: expect.stringMatching(/swapped/) })
    expect(addPlace(SOURCE, { ...place, name: 'קפה' })).toMatchObject({ ok: false })
    expect(editPlace(SOURCE, 3, { name: 'קפה', sub: null, cat: 'cafe', lat: 32.0618, lng: 34.7778, desc: null, hours: null, contact: null, address: null })).toEqual({ ok: false, message: 'Nothing changed.' })
    expect(editPlace(SOURCE, 99, place)).toMatchObject({ ok: false })
  })

  it('removes a place by deleting exactly its line, and never the store itself', () => {
    const r = removePlace(SOURCE, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe(SOURCE.replace(/\n  \{id:3,[^\n]*/, ''))
    expect(r.data.places.map((p) => p.id)).toEqual([1])
    expect(r.summary).toBe('Remove place #3 "קפה"')
    expect(removePlace(SOURCE, 1)).toMatchObject({ ok: false, message: expect.stringMatching(/cannot be removed/) })
    expect(removePlace(SOURCE, 99)).toMatchObject({ ok: false })
  })

  it('removes the last place when the file has no trailing comma', () => {
    const src = SOURCE.replace("address:null},\n];", "address:null}\n];")
    const r = removePlace(src, 3)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.places.map((p) => p.id)).toEqual([1])
  })
})
