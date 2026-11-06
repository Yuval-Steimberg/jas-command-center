import { describe, expect, it } from 'vitest'
import { catalogEditFields, catalogState, needsCatalogPhoto, websiteBlockers, websitePhotos } from '@/lib/inventory/catalog'

const base = { photoUrl: 'https://p/orig.jpg', extraPhotos: ['https://p/side.jpg'], catalogPhotoUrl: null as string | null, catalogPhotoFrom: null as string | null, catalogPhotoOff: false, catalogPhotoError: null as string | null }

describe('website photos: the catalog photo never hides the real piece', () => {
  it('without a catalog photo the website gets the originals as before', () => {
    expect(websitePhotos(base)).toEqual({ main: 'https://p/orig.jpg', gallery: ['https://p/side.jpg'] })
  })
  it('with a current catalog photo it is the main image and EVERY original is in the gallery', () => {
    const it = { ...base, catalogPhotoUrl: 'https://p/cat.jpg', catalogPhotoFrom: 'https://p/orig.jpg' }
    expect(websitePhotos(it)).toEqual({ main: 'https://p/cat.jpg', gallery: ['https://p/orig.jpg', 'https://p/side.jpg'] })
  })
  it('a catalog photo of an OLD main photo is not used', () => {
    const it = { ...base, catalogPhotoUrl: 'https://p/cat.jpg', catalogPhotoFrom: 'https://p/older.jpg' }
    expect(websitePhotos(it).main).toBe('https://p/orig.jpg')
    expect(catalogState(it)).toBe('pending')
    expect(needsCatalogPhoto(it)).toBe(true)
  })
  it('"use the original" wins over a ready catalog photo', () => {
    const it = { ...base, catalogPhotoUrl: 'https://p/cat.jpg', catalogPhotoFrom: 'https://p/orig.jpg', catalogPhotoOff: true }
    expect(websitePhotos(it).main).toBe('https://p/orig.jpg')
    expect(catalogState(it)).toBe('original')
    expect(needsCatalogPhoto(it)).toBe(false)
  })
})

describe('catalog photo: made once per photo', () => {
  it('a failure is not retried for the same photo (no paying every hour)', () => {
    const it = { ...base, catalogPhotoFrom: 'https://p/orig.jpg', catalogPhotoError: 'Photoroom answered 500' }
    expect(needsCatalogPhoto(it)).toBe(false)
    expect(catalogState(it)).toBe('failed')
  })
  it('before migration 0016 (columns undefined) nothing is made', () => {
    const it = { photoUrl: 'https://p/orig.jpg' } as never
    expect(needsCatalogPhoto(it)).toBe(false)
    expect(catalogState(it)).toBe('unavailable')
  })
  it('no https photo, nothing to make', () => {
    expect(needsCatalogPhoto({ ...base, photoUrl: 'http://p/x.jpg' })).toBe(false)
    expect(needsCatalogPhoto({ ...base, photoUrl: null })).toBe(false)
  })
})

describe('Photoroom request: only edits around the product', () => {
  it('asks for cut-out, backdrop, shadow, hue-preserving light, 4:5 JPEG', () => {
    expect(catalogEditFields()).toEqual({
      removeBackground: 'true', 'background.color': 'F6F1E4', padding: '0.1', outputSize: '1600x2000', 'shadow.mode': 'ai.soft', 'export.format': 'jpeg',
      'lighting.mode': 'ai.preserve-hue-and-saturation',
    })
  })
  it('never asks for anything that redraws the item', () => {
    const keys = Object.keys(catalogEditFields()).join(' ')
    for (const banned of ['beautify', 'upscale', 'uncrop', 'expand', 'textRemoval', 'describeAnyChange', 'background.prompt', 'templateId']) expect(keys).not.toContain(banned)
  })
  it('retry without relight; a bad backdrop value falls back to cream', () => {
    expect(catalogEditFields({ lighting: false })).not.toHaveProperty('lighting.mode')
    expect(catalogEditFields({ background: '#ffffff' })['background.color']).toBe('FFFFFF')
    expect(catalogEditFields({ background: 'red;x' })['background.color']).toBe('F6F1E4')
  })
})

describe('ready for the website, with nobody pressing anything', () => {
  const locs = [{ id: 'shop', name: 'חנות' }, { id: 'ws', name: 'בית מלאכה' }]
  const ready = { status: 'in_storage' as const, photoUrl: 'https://p/o.jpg', priceMinor: 45000, priceApproved: true, quantity: 1, locationId: 'shop' }
  it('in storage, photo, approved price, not in the workshop', () => {
    expect(websiteBlockers(ready, locs)).toEqual([])
  })
  it("the AI's price never goes up alone", () => {
    expect(websiteBlockers({ ...ready, priceApproved: false }, locs)).toEqual(['price_not_approved'])
    expect(websiteBlockers({ ...ready, priceMinor: null }, locs)).toEqual(['price'])
  })
  it('an unfinished piece in the workshop waits', () => {
    expect(websiteBlockers({ ...ready, locationId: 'ws' }, locs)).toEqual(['workshop'])
  })
  it('no photo, sold or no stock', () => {
    expect(websiteBlockers({ ...ready, photoUrl: null, status: 'sold', quantity: 0 }, locs)).toEqual(['status', 'photo', 'stock'])
  })
})
