import type { Probe } from './probe'

/**
 * Checks against what the PUBLIC sees: the website's prerendered pages, its
 * sitemap and llms.txt, and whether admin-only rows leak through the public
 * anon key. Everything here is a plain anonymous GET — the same requests any
 * visitor or crawler can make — and the pure helpers below are unit-tested in
 * tests/unit/selfcheck-public.test.ts.
 */

const TIMEOUT_MS = 10_000

/** A prerendered page carries a canonical link; the SPA shell (app-shell.html) deliberately does not. */
export function isPrerendered(html: string): boolean {
  return /<link[^>]+rel=["']canonical["']/i.test(html) && /<h1[\s>]/i.test(html)
}

/** `<loc>` URLs of a sitemap, in order. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!)
}

/** Script and modulepreload URLs of a Vite page, resolved against the page. Entry script first. */
export function bundleUrls(html: string, base: string): string[] {
  const entry = [...html.matchAll(/<script[^>]+type=["']module["'][^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]!)
  const preload = [...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]!)
  return [...new Set([...entry, ...preload])].map((u) => new URL(u, base).toString())
}

/** The Supabase URL and public (anon / publishable) key a browser bundle was built with. Never a service key. */
export function publicSupabase(js: string): { url: string; key: string } | null {
  const url = js.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/)?.[0]
  if (!url) return null
  const publishable = js.match(/sb_publishable_[A-Za-z0-9_-]{10,}/)?.[0]
  if (publishable) return { url, key: publishable }
  for (const m of js.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[0].split('.')[1]!, 'base64url').toString('utf8')) as { role?: string }
      if (payload.role === 'anon') return { url, key: m[0] }
    } catch {
      // not a JWT
    }
  }
  return null
}

async function get(url: string): Promise<{ status: number; text: string; type: string }> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '' }
}

const elapsed = (started: number) => Date.now() - started
const err = (name: string, started: number, detail: string): Probe => ({ section: 'website', name, state: 'error', latencyMs: elapsed(started), detail: detail.slice(0, 160) })
const ok = (name: string, started: number, detail: string): Probe => ({ section: 'website', name, state: 'ok', latencyMs: elapsed(started), detail: detail.slice(0, 160) })
const unset = (name: string): Probe => ({ section: 'website', name, state: 'not_configured', latencyMs: null, detail: 'needs WEBSITE_URL' })

/** The pages crawlers and AI agents read must be real HTML, not the empty SPA shell. */
export async function probePrerenderedPages(site: string | undefined, paths = ['/', '/press', '/shop', '/blog', '/about', '/gift-card']): Promise<Probe> {
  const name = 'Public pages prerendered for search (SEO)'
  if (!site) return unset(name)
  const started = Date.now()
  try {
    const results = await Promise.all(paths.map(async (p) => ({ p, r: await get(new URL(p, site).toString()) })))
    const bad = results.filter(({ r }) => r.status !== 200 || !isPrerendered(r.text)).map(({ p, r }) => `${p} ${r.status === 200 ? 'SPA shell' : `HTTP ${r.status}`}`)
    return bad.length ? err(name, started, `${bad.length}/${paths.length} not prerendered: ${bad.join(', ')}`) : ok(name, started, `${paths.length}/${paths.length} pages prerendered`)
  } catch (e) {
    return err(name, started, e instanceof Error ? e.message : String(e))
  }
}

/**
 * sitemap.xml and llms.txt exist, and the domain the sitemap names (the
 * canonical one) actually serves this site — a canonical pointing at a domain
 * that serves something else tells Google to index the other site.
 */
export async function probeSitemap(site: string | undefined): Promise<Probe[]> {
  const name = 'sitemap.xml and llms.txt'
  const canonicalName = 'Canonical domain serves this site'
  if (!site) return [unset(name), unset(canonicalName)]
  const started = Date.now()
  let locs: string[] = []
  let llms = ''
  let first: Probe
  try {
    const [sitemap, llmsTxt] = await Promise.all([get(new URL('/sitemap.xml', site).toString()), get(new URL('/llms.txt', site).toString())])
    locs = sitemapLocs(sitemap.text)
    llms = llmsTxt.text
    const problems = [
      sitemap.status !== 200 || !locs.length ? `sitemap.xml ${sitemap.status === 200 ? 'has no URLs' : `HTTP ${sitemap.status}`}` : '',
      llmsTxt.status !== 200 || /<html/i.test(llms) ? `llms.txt ${llmsTxt.status === 200 ? 'is an HTML page' : `HTTP ${llmsTxt.status}`}` : '',
    ].filter(Boolean)
    first = problems.length ? err(name, started, problems.join(', ')) : ok(name, started, `${locs.length} URLs in sitemap, llms.txt ${llms.length} chars`)
  } catch (e) {
    return [err(name, started, e instanceof Error ? e.message : String(e)), { section: 'website', name: canonicalName, state: 'not_configured', latencyMs: null, detail: 'sitemap unreadable' }]
  }
  if (!locs.length) return [first, { section: 'website', name: canonicalName, state: 'not_configured', latencyMs: null, detail: 'no sitemap URLs' }]

  const canonical = new URL(locs[0]!).origin
  if (canonical === new URL(site).origin) return [first, ok(canonicalName, started, `canonical = ${canonical}`)]
  const s2 = Date.now()
  try {
    const there = await get(new URL('/llms.txt', canonical).toString())
    const same = there.status === 200 && there.text.trim().split('\n')[0] === llms.trim().split('\n')[0]
    return [
      first,
      same
        ? ok(canonicalName, s2, `${canonical} serves the same site`)
        : err(canonicalName, s2, `sitemap/canonical URLs use ${canonical}, which does not serve this site (llms.txt there: HTTP ${there.status}${there.status === 200 ? ', different content' : ''})`),
    ]
  } catch (e) {
    return [first, err(canonicalName, s2, `${canonical} unreachable: ${e instanceof Error ? e.message : String(e)}`)]
  }
}

/**
 * The website's site_content table is public CMS, but discount codes, sent
 * campaigns and change requests live in it too. With the public key a browser
 * already holds, none of those rows may be readable (website migration
 * 20261022000000_private_site_content.sql). Prints a count, never a row.
 */
export async function probeAdminRowsPrivate(site: string | undefined): Promise<Probe> {
  const name = 'Discount codes not public (site_content RLS)'
  if (!site) return unset(name)
  const started = Date.now()
  try {
    const page = await get(site)
    let conn: { url: string; key: string } | null = null
    for (const u of bundleUrls(page.text, site).slice(0, 12)) {
      conn = publicSupabase((await get(u)).text)
      if (conn) break
    }
    if (!conn) return err(name, started, 'could not find the public Supabase key in the site bundle')
    const q = 'select=key&or=(key.eq.discount_codes,key.eq.newsletter_campaigns,key.like.change_request_*)'
    const res = await fetch(`${conn.url}/rest/v1/site_content?${q}`, { headers: { apikey: conn.key, Authorization: `Bearer ${conn.key}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) return err(name, started, `public read HTTP ${res.status}`)
    const rows = (await res.json()) as unknown[]
    return rows.length
      ? err(name, started, `${rows.length} admin-only row(s) readable with the public key: run website migration 20261022000000_private_site_content.sql`)
      : ok(name, started, 'admin-only rows hidden from the public key')
  } catch (e) {
    return err(name, started, e instanceof Error ? e.message : String(e))
  }
}
