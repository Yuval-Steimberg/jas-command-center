// Browser smoke test: every page renders for a signed-in owner with NO source
// configured, which is the state where a careless page shows zeros or crashes.
// Starts `next dev` with the local login (production builds refuse it), signs
// in, and for each page checks: no server error, no Next error overlay, a
// heading, and no sideways scroll at phone width.
//
//   npm run smoke            (CHROMIUM_PATH=/path/to/chrome to use a local browser)
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.SMOKE_PORT ?? 3123)
const BASE = `http://localhost:${PORT}`
const PASSWORD = 'smoke-test-password'
const PAGES = [
  '/', '/guide', '/notifications', '/search?q=test', '/analytics', '/reports', '/assistant', '/integrations',
  '/website', '/website/orders', '/website/products', '/website/content', '/website/reviews', '/website/blog', '/website/marketing', '/website/inquiries',
  '/gift-cards', '/furniture', '/furniture/new', '/design-agent', '/map',
  '/crm', '/crm/new', '/crm/pipeline', '/inventory', '/inventory/new', '/inventory/intake', '/inventory/website', '/inventory/online', '/inventory/locations', '/inventory/scan', '/inventory/labels', '/sales', '/sales/new', '/deliveries', '/tasks', '/suppliers', '/suppliers/orders/new',
  '/volunteers', '/volunteers/activities', '/volunteers/activities/new', '/volunteers/calendar', '/volunteers/calendar?view=month', '/volunteers/people', '/volunteers/reports',
  '/settings', '/settings/staff', '/settings/notifications',
  '/shop', '/shop/sell', '/shop/new', '/shop/scan', '/shop/items', '/shop/sales', '/shop/deliveries', '/shop/labels',
]

// Only the local login; every source and Supabase variable is blanked so nothing real is reached.
const blank = Object.fromEntries(Object.keys(process.env).filter((k) => /SUPABASE|WEBSITE_|GIFT_CARDS_|FURNITURE_|DESIGN_AGENT_|MAP_|GA4_|GITHUB_TOKEN|VERCEL_TOKEN|ANTHROPIC|SENDGRID/.test(k)).map((k) => [k, '']))
const server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
  env: { ...process.env, ...blank, CC_DEV_PASSWORD: PASSWORD, CC_SESSION_SECRET: 's'.repeat(40), NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  // Own process group, so stopping it also stops the server npx started.
  detached: true,
})
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.status < 500) return
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`next dev did not start\n${log.slice(-2000)}`)
}

const failures = []
let browser
try {
  await waitUp()
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  // Signed out: everything goes to /login.
  await page.goto(`${BASE}/gift-cards`)
  if (!page.url().includes('/login')) failures.push(`signed-out /gift-cards did not redirect to /login (${page.url()})`)

  await page.fill('input[name="password"]', PASSWORD)
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), page.click('button[type="submit"], form button')])

  for (const path of PAGES) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 90_000 })
    const status = res?.status() ?? 0
    const text = await page.locator('body').innerText()
    const h1 = await page.locator('h1').count()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const problems = [
      status >= 500 && `HTTP ${status}`,
      /Application error|Unhandled Runtime Error|Internal Server Error/.test(text) && 'error page',
      page.url().includes('/forbidden') && 'owner was sent to /forbidden',
      !h1 && 'no heading',
      overflow > 1 && `scrolls sideways by ${overflow}px at 390px`,
    ].filter(Boolean)
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path}${problems.length ? ` — ${problems.join(', ')}` : ''}`)
    if (problems.length) failures.push(`${path}: ${problems.join(', ')}`)
  }

  // The phone menu must cover the screen: a blurred header once trapped it at 56px tall with no links visible.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.click('button[aria-label="Open navigation"]')
  const menu = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"][aria-label="Navigation"] > div')
    const r = panel?.getBoundingClientRect()
    return { height: Math.round(r?.height ?? 0), links: panel ? [...panel.querySelectorAll('a')].filter((a) => { const b = a.getBoundingClientRect(); return b.height > 0 && b.top >= 0 && b.bottom <= innerHeight }).length : 0 }
  })
  const menuOk = menu.height >= 800 && menu.links >= 5
  console.log(`${menuOk ? 'ok  ' : 'FAIL'} phone menu — ${menu.height}px tall, ${menu.links} links on screen`)
  if (!menuOk) failures.push(`phone menu: ${menu.height}px tall, ${menu.links} links on screen`)
} catch (e) {
  failures.push(String(e instanceof Error ? e.stack : e))
} finally {
  await browser?.close()
  try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill('SIGTERM') }
}

if (failures.length) {
  console.error(`\n${failures.length} smoke failure(s):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(`\nAll ${PAGES.length} pages render.`)
process.exit(0)
