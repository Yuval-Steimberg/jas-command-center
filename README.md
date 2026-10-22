# JAS Command Center

One login, one console for every Just A Second system: the website and shop,
gift cards, furniture collection, the WhatsApp design agent and the
neighbourhood map. It reads (and, where a source allows it, acts on) each
system through its own adapter. It replaces none of them.

**Start with [`docs/INTEGRATION_INVENTORY.md`](docs/INTEGRATION_INVENTORY.md)** — the
Phase 1 audit of all five repositories: what each one really does, what can be
integrated, what is blocked and on what.

## Rules this codebase keeps

- **No number without a source.** Every figure comes from a live read of a
  source system (`lib/integrations/*`). A source that is not configured shows
  "not connected — needs X"; a source that failed shows the error. Neither is
  ever rendered as zero. There is no mock data in the app.
- **No business logic duplicated.** "A sale", "liability", "revenue" are
  defined once, in the source system, and read from it. The metrics catalogue
  (`lib/metrics-catalog.ts`, shown on /analytics) names the source of each.
- **Incompatible numbers are not added.** Website revenue (₪, by paid date)
  and gift-card sales (agorot, rolling windows) are shown side by side, never
  summed — the website also sells its own gift cards.
- **Healthy means probed.** A product is "Operational" only when a live check of
  its running service succeeded. Not configured = "Not checked".
- **Authorization is server-side.** `requirePermission()` in every action,
  `requirePageAccess()` in every page; hiding a link is presentation only.
  Gift-card money actions are owner-only by default.
- **Every action is audited** before and after it calls a source, and the UI
  shows what the source confirmed — never an optimistic "done".
- **One broken integration never takes the console down.** Each card loads in
  its own Suspense boundary; health checks run with `Promise.allSettled`.

## Stack

Next.js 14 (App Router) · React 18 · TypeScript strict · Tailwind with the JAS
design tokens · Zod contracts per source · Supabase (Auth + Postgres) for the
console's own data · Vitest. Same stack as `gift_card_system`, deployed the same
way (Vercel).

## Run it

```bash
npm install
cp .env.example .env.local   # set CC_DEV_PASSWORD + CC_SESSION_SECRET for a local login
npm run dev                  # http://localhost:3000
npm test                     # unit + adapter contract tests (local fake sources)
npm run typecheck && npm run lint && npm run build
```

Without any integration variables every page loads and says exactly what is
missing. Production setup: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Adding a product: [`docs/ADDING_AN_INTEGRATION.md`](docs/ADDING_AN_INTEGRATION.md).

## Status (iteration 1)

| Area | State |
| --- | --- |
| Discovery & inventory | Done — `docs/INTEGRATION_INVENTORY.md` |
| Auth (Supabase Auth; local dev login), RBAC (5 roles × per-product permissions + DB overrides), audit log | Built, tested |
| App shell, design system, responsive layout (390 → 1440 px) | Built, checked in Chromium |
| Website: traffic, funnel, paid vs verified revenue, channels, devices, errors | Built — **needs `WEBSITE_AGENT_API_KEY`** |
| Gift cards: health; sales, liability, redeemed, paid-not-delivered | Built — health needs only `GIFT_CARDS_URL`; figures need the gift_card_system PR merged + `INTEGRATION_API_KEY` |
| Furniture: projects, apartments completed, items collected | Built — **needs furniture Supabase URL + key** |
| Design agent: queue health, dead jobs (+ retry), failed sends, projects | Built — **needs `DESIGN_AGENT_URL` (+ `ADMIN_TOKEN`)** |
| Map: places, categories, published commit | Built — works without credentials if the repo is public |
| Alerts (derived live) | Built. Read/unread, assignment and email: next |
| Activity feed, cross-system search, analytics workspace, AI assistant, writes beyond retry | **Not built** — each page says so |

None of the integrations has been exercised against a live system: this build
environment cannot reach any JAS host. Each one is tested against a local fake
of the contract its source repository defines.
