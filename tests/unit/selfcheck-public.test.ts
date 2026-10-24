import { describe, expect, it } from 'vitest'
import { bundleUrls, isPrerendered, publicSupabase, sitemapLocs } from '@/lib/selfcheck/public'

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJlX2hlcmU`

describe('production check: public website helpers', () => {
  it('tells a prerendered page from the SPA shell', () => {
    expect(isPrerendered('<head><link rel="canonical" href="https://x/press"></head><body><h1>בתקשורת</h1></body>')).toBe(true)
    expect(isPrerendered('<head><title>x</title></head><body><div id="root"></div></body>')).toBe(false)
    expect(isPrerendered('<link rel="canonical" href="https://x/"><div id="root"></div>')).toBe(false)
  })

  it('reads sitemap URLs in order', () => {
    expect(sitemapLocs('<urlset><url><loc>https://a.co.il/</loc></url><url><loc> https://a.co.il/press </loc></url></urlset>')).toEqual(['https://a.co.il/', 'https://a.co.il/press'])
    expect(sitemapLocs('<html></html>')).toEqual([])
  })

  it('lists the entry script before preloaded chunks, resolved against the page', () => {
    const html = '<link rel="modulepreload" crossorigin href="/assets/vendor-1.js"><script type="module" crossorigin src="/assets/index-2.js"></script>'
    expect(bundleUrls(html, 'https://site.app/')).toEqual(['https://site.app/assets/index-2.js', 'https://site.app/assets/vendor-1.js'])
  })

  it('finds the anon key, never a service-role key', () => {
    const url = 'https://abcdefghijklmnopqrst.supabase.co'
    expect(publicSupabase(`const u="${url}",k="${jwt({ role: 'anon' })}"`)).toEqual({ url, key: jwt({ role: 'anon' }) })
    expect(publicSupabase(`const u="${url}",k="${jwt({ role: 'service_role' })}"`)).toBeNull()
    expect(publicSupabase(`u="${url}";k="sb_publishable_abcdefghijkl123"`)).toEqual({ url, key: 'sb_publishable_abcdefghijkl123' })
    expect(publicSupabase(`k="${jwt({ role: 'anon' })}"`)).toBeNull()
  })
})
