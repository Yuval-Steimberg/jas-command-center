import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * public/portal-guide.html is SENT (WhatsApp, email) and opened outside the
 * portal, so every link must work on its own: anchors land on a section,
 * other links are absolute https to pages that exist, and the preview card
 * WhatsApp builds (og:*) uses absolute addresses it can fetch without a login.
 */
const ROOT = process.cwd()
const html = readFileSync(join(ROOT, 'public/portal-guide.html'), 'utf8')
const BASE = 'https://jas-command-center.vercel.app'
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!)
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!))

describe('the standalone portal guide', () => {
  it('every in-page link lands on a section', () => {
    const anchors = hrefs.filter((h) => h.startsWith('#'))
    expect(anchors.length).toBeGreaterThanOrEqual(10)
    for (const a of anchors) expect(ids.has(a.slice(1)), a).toBe(true)
  })

  it('every other link is absolute https on the command center, to a page that exists', () => {
    const external = hrefs.filter((h) => !h.startsWith('#'))
    expect(external.length).toBeGreaterThan(0)
    for (const h of external) {
      expect(h.startsWith(`${BASE}/`), h).toBe(true)
      const path = new URL(h).pathname
      const exists =
        path === '/portal-guide.html'
          ? existsSync(join(ROOT, 'public/portal-guide.html'))
          : path === '/shop-icon'
            ? existsSync(join(ROOT, 'app/shop-icon/route.tsx'))
            : existsSync(join(ROOT, 'app', path, 'page.tsx'))
      expect(exists, h).toBe(true)
    }
  })

  it('has a WhatsApp preview card with absolute addresses', () => {
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image']) expect(html, p).toMatch(new RegExp(`property="${p}" content="[^"]+"`))
    for (const m of html.matchAll(/property="og:(?:url|image)" content="([^"]+)"/g)) expect(m[1]!.startsWith(`${BASE}/`), m[1]).toBe(true)
  })

  it('opens without a login: the middleware never runs on it', () => {
    const mw = readFileSync(join(ROOT, 'middleware.ts'), 'utf8')
    expect(mw).toMatch(/matcher:.*portal-guide\.html/)
    expect(mw).toMatch(/matcher:.*shop-icon/)
  })
})
