import { describe, expect, it } from 'vitest'
import { matchDocs, normalize } from '@/lib/search/match'

const docs = [
  { title: 'בניין א׳ - רחוב הרצל', subtitle: 'תל אביב', href: '/furniture' },
  { title: 'Café Noa', subtitle: 'Food', href: '/map', text: ['Menachem Begin 34'] },
  { title: 'Overview', href: '/' },
  { title: 'Website & Shop', href: '/website' },
]

describe('cross-system search matching', () => {
  it('ignores niqqud, geresh, case and accents', () => {
    expect(normalize('בִּנְיָן א׳')).toBe('בנין א')
    expect(normalize('  CAFÉ  Noa ')).toBe('cafe noa')
    expect(matchDocs(docs, 'בניין א').map((d) => d.href)).toEqual(['/furniture'])
    expect(matchDocs(docs, 'cafe').map((d) => d.title)).toEqual(['Café Noa'])
  })
  it('needs every word, anywhere in the entry, including hidden text', () => {
    expect(matchDocs(docs, 'noa begin')).toHaveLength(1)
    expect(matchDocs(docs, 'noa herzl')).toHaveLength(0)
  })
  it('ranks title-prefix matches first and ignores one-letter queries', () => {
    expect(matchDocs(docs, 'w')).toEqual([])
    expect(matchDocs([{ title: 'Shop website', href: 'a' }, ...docs], 'website')[0]!.title).toBe('Website & Shop')
  })
})
