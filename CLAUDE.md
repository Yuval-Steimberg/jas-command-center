# jas-command-center — project memory

Internal console over the five Just A Second systems. Read `README.md` (rules)
and `docs/INTEGRATION_INVENTORY.md` (what each source really is) first.

Non-negotiables:
- Every number comes from a live source read (`lib/integrations/<product>`),
  validated by a Zod contract. Not configured / error states are rendered, never
  zeros. No mock data in the app; fixtures live only in `tests/`.
- Never re-implement a source's business logic (sales, liability, impact KPIs).
  If the source has no endpoint, add a narrow read-only one in the source repo by PR.
- `requirePageAccess()` in pages, `requirePermission()` in actions; audit
  `requested` before and the confirmed outcome after every write.
- Health is `operational` only after a live probe succeeded.
- Website ₪ (decimal) and gift-card agorot are normalised with `lib/money.ts`
  and never summed across systems.

AI assistant (`lib/assistant/`, page `/assistant`):
- Its only reach is `TOOLS` in `lib/assistant/tools.ts`: typed, read-only wrappers
  over the same adapters, plus confirm-only `propose_*` tools. No SQL, no URLs, no writes by the model. A new tool names its
  permission, has a Zod input + strict JSON schema, and trims PII before return
  (everything returned is sent to the model provider).
- Tools offered = the user's role; `runTool` re-checks. Every lookup writes
  `assistant.tool` and every question `assistant.ask` (via = assistant); a failed
  audit write aborts the answer.
- System prompt is frozen (date goes in the user turn) so the prompt cache holds.
  History from the browser is text-only and schema-checked; within one question
  the loop is append-only. Bounded: `MAX_ROUNDS` 6, `DEADLINE_MS` 45 s.
- Actions: `lib/assistant/proposals.ts`. A `propose_*` tool only looks the target up (summary built from
  source data, never model text) and returns a proposal; max 3 per answer. Only the person's Confirm
  click runs it (`confirmProposalAction`): re-checks every permission, re-validates `EXEC_PARAMS`,
  audits `requested` then the outcome (via = assistant), calls the same adapter as the page.
  A new action = a ProposalDef + its EXEC_PARAMS entry + a test that proposing writes nothing.

Gift card money actions (`runCardLifecycle`, card page "Money actions"):
- Owner-only (`gift_cards:financial`). POST `cards/:id/lifecycle` on the gift card system, which runs its
  own /admin functions. Adjust sends a `requestId` (one confirmation = one ledger entry).
- A refund's `provider` field is the truth about the money: `failed`/`not_attempted` means the card is
  refunded but Grow did NOT pay the buyer back. Show that as a warning, never as "refunded".

Website writes (`lib/integrations/website/manage.ts`, pages `/website/orders`, `/website/products`):
- Through the website's `_agent-ops.ts` with `WEBSITE_COMMAND_CENTER_KEY` — a separate key from the
  snapshot-only `WEBSITE_AGENT_API_KEY`, which the website's AI agent also holds.
- Fulfilment statuses only (revenue never moves); products: quick price/original_price/quantity/featured edit on the list.
  409 = changed since loaded → shown as "reload", never retried or overwritten.
- The website has no audit table: the command center's audit (with before/after) is the only record.
- Site content (`/website/content`): exactly the website's SITE_CONTENT_SCHEMA keys (texts, images, shop hours,
  partners) via `content-list`/`content-set`; the website validates per key and refuses a stale edit (409).
  Discount codes, campaigns and review replies share `site_content` but are NOT reachable through it.
  List keys (`*_json`: menu, footer links, team, board, committee) come with a `list` descriptor (fields, maxItems)
  from the website's `src/lib/contentLists.ts`; `ListField` is a generic add/remove/reorder editor that saves the
  whole list as one conditional write. Add a list on the website side only; this editor needs no change.
- Reviews (`/website/reviews`): approve / hide / delete (bulk via `form="reviews-bulk"`) + reply. Reviewer email
  is shown only with `website:read_pii`.
- Blog (`/website/blog`, `/new`, `/[id]`): create/edit/delete via `blog-*`; content is the website's markdown subset,
  never HTML; edits and deletes conditional on updated_at.
- Products (`/website/products/new`, `/[id]`): full form via `product-save|get|delete`, plus `product-meta`
  (categories + low-stock threshold), `category-create`, `low-stock-set`. Images are LINKS (upload still happens in
  the website's storage, now uploadable: `ImageUpload` resizes in the browser, `uploadImageAction` gets a signed link via
  `image-upload-url` and PUTs straight to Supabase Storage). `published` is sent only when the website returns that column (`hasPublished`).
- Marketing (`/website/marketing`): discount codes via `discount-save|delete` (one code per write; the website keeps
  `usedCount`), subscribers (`website:read_pii` to see, + `website:write` to unsubscribe; the address is kept out of
  the audit log), campaign history, and campaign send (`campaign-send`, plain text; a per-page-load requestId makes the
  website refuse a repeat with 409; never retried; 60 s timeout + page `maxDuration`).
- Messages (`/website/inquiries`): the site's contact/volunteer/donation forms (`site_inquiries`, website PR #33; the
  forms used to fake "sent"). `website:read_pii` to see, `website:operate` to mark handled.
- The owner decided (2026-10-22) to RETIRE the website's /manager: build admin features here, not there.

Furniture writes (`lib/integrations/furniture/manage.ts`, page `/furniture/[id]`):
- Only column updates the field app itself makes: `projects.archived`, `items.gallery_type` (its
  trigger derives `intended_for_collection`). Item PATCH is conditional on `updated_at`.
- Never tick `collected`, finish an apartment or confirm a handover from here: those carry the
  collector's name and completion rules that live in the app's client code.

Map writes (`lib/integrations/map/edit.ts` + `github.ts`, page `/map`):
- A place change (add / edit / remove; the anchor store is never removed) is a pull request on Interactive-map, never a commit to the published branch. `edit.ts`
  rewrites ONE line of places-data.js as text and re-parses the result; the commit names the blob it was
  computed from, so a file changed in between is refused (409), not overwritten.
- Map visitors: `ga4.ts`, GA4 Data API with a read-only service account (JWT signed with node:crypto).

Source facts that are easy to get wrong:
- whatssup-bot is the owner's DESIGN agent (allowlisted numbers), not a
  customer WhatsApp bot. No customer inbox exists.
- The website also sells gift cards as cart lines, separate from gift_card_system.
- Interactive-map is a static GitHub Pages site; data = `places-data.js`,
  parsed as an AST (`lib/integrations/map/parse.ts`), never executed.
- Three separate Supabase projects (website, gift cards, furniture) + the
  command center's own. The bot uses SQLite on Railway.

Commands: `npm run dev | test | typecheck | lint | build`. Local login: set
`CC_DEV_PASSWORD` + `CC_SESSION_SECRET` in `.env.local` (disabled in production).
`next dev` redirects to `localhost` — drive it via `localhost`, not 127.0.0.1,
or the dev cookie is lost.

Gotcha: `backdrop-blur` (and `transform`/`filter`) on an element makes it the containing block of every `fixed` child.
The topbar has it, so the phone menu drawer rendered 56px tall inside the header (2026-10-24). Overlays are portalled to
`<body>` (`createPortal` in `MobileNav`); do the same for any new full-screen layer opened from a header or bar.

Gotcha: `cc_user_roles` references `cc_profiles` twice (`profile_id`, `granted_by`),
so any PostgREST embed between them needs a hint (`cc_user_roles!profile_id(...)`)
or the whole query fails with PGRST201. See `lib/auth/profile-query.ts`.

Search, activity, notifications:
- `lib/search/` — `match.ts` is pure (Hebrew niqqud/geresh-insensitive). Each group
  says ok / not_configured / error / unsupported; never render "could not search" as "no results".
- `lib/activity/build.ts` is pure and only uses records that carry their own timestamp.
  A source that was not read contributes nothing and is listed in `gaps`.
- `lib/notifications/` persists the derived alerts. `planSync` resolves an alert only when
  its family (id prefix) was observed this sweep. Marking read is the user's own inbox state
  and is deliberately not audited.

Analytics (`/analytics`, `lib/analytics/`):
- `model.ts` is pure and is the ONE shape the page and the CSV export both read (`csv.ts`), so an export equals the screen.
  Sections never combine: website ₪ and gift-card face value are never added.
- Every metric id must exist in `lib/metrics-catalog.ts` with the same basis and product (unit test enforces it).
  `basis: 'period'` = selected range vs the equally long period before; `'now'` = current state, never compared.
- Period data per source: website MetricsSnapshot (`daily`/`dailyPrevious`, optional for older deploys),
  gift cards `GET /api/integration/v1/sales` (gift_card_system #7), design agent `GET /admin/activity`
  (whatssup-bot #39, called once per period). Furniture exposes no item timestamps: progress is "now" only.
- Custom range `?from=&to=` (validated in `range.ts`, ≤366 days, not future) overrides the preset; the
  top-bar preset select clears it. `/analytics/export?kind=metrics|daily|tables` is audited as `analytics.export`.


Reports (`/reports`, `lib/reports/`):
- `business.ts` is pure: daily/weekly/monthly summary built ONLY from the analytics report, the visible alerts and live
  health. Improved/declined = ≥10% (≥2 pp for rates) on complete data; actions = open non-info alerts + unreadable
  sources. No forecasts or invented opportunities. Markdown export `/reports/export?kind=` is audited as `report.export`.
  Scheduled email delivery is not built: the console has no email provider.

Deployments (`lib/integrations/vercel/`): read-only `GET /v6/deployments?target=production` with `VERCEL_TOKEN`.
`summarise.ts` (pure) splits "live" (newest READY) from "newest attempt"; a product's failed newest deploy is a
`deploy:` warning alert (the console's own project maps to no product and never alerts).

AI activity: `/assistant` lists the audit rows with via=assistant (own rows; everyone's with `audit:read`).

Furniture field actions + impact (`lib/integrations/furniture/field.ts`, project page):
- KPIs and the four field writes (collect / finish apartment / reopen / handover) go through the field app's own
  `api/command-center.js` (Furniture-Collect `src/server/`), which builds them from the same modules its screens use.
  The command center never computes a mass, rate or completion rule. `FURNITURE_COMMAND_CENTER_KEY`.
- Field writes need `furniture:operate`; never retried (a 409 is an answer); finish names outstanding items first
  (a second press sends `confirmOutstanding`).

Staff (`/settings/staff`, `lib/staff/`): invite (Supabase `inviteUserByEmail` → `/login/set-password`), change role,
deactivate. `rules.ts` is pure and tested: nobody changes themselves, only an owner makes/unmakes owners, the last
active owner cannot be removed.

Notification settings + email (`lib/notifications/prefs.ts`, `deliver.ts`, migration `0002_notification_prefs.sql`):
- Per person: muted products, severity floor, alert email, report email. Critical alerts are never muted.
- Assigning an alert needs `<product>:operate` and is audited; reading/settings are personal and not audited.
- `/api/cron/sweep` (hourly via `.github/workflows/sweep.yml`) persists alerts and emails newly opened ones once
  (`emailed_at`); `/api/cron/reports` (Vercel cron 18:00 UTC) sends daily / Sunday weekly / 1st monthly, once per
  Israeli day (`cc_sync_state` `report:<kind>`). Both locked by `CRON_SECRET`; SendGrid via `SENDGRID_API_KEY`.

Smoke test: `npm run smoke` (CI job `smoke`) signs in on `next dev` with no source configured and checks 22 pages:
no 5xx, no error overlay, a heading, no sideways scroll at 390px. A new page goes in `PAGES` in `tests/smoke/smoke.mjs`.

Production check (`lib/selfcheck/`, `/api/cron/selfcheck`, `.github/workflows/prod-check.yml`):
- Runs every read a page depends on, once, against production, and prints states + counts in the Actions log
  (never names, emails, codes or keys). Same `CRON_SECRET`; URL derived from the `SWEEP_URL` secret. Daily 05:30 UTC
  and on demand; fails when a configured section errors. A new page's read goes in `runSelfCheck`.
- This is how a session without access to the live hosts verifies production: trigger the workflow, read the log.
- `public.ts` checks what visitors get, anonymously: website pages are prerendered (canonical + h1, not the SPA shell),
  sitemap.xml/llms.txt exist, the sitemap's canonical domain serves the same site, and admin-only `site_content` rows
  (discount codes) are NOT readable with the public key found in the site's own bundle. Also one probe per Vercel project
  (live commit; newest deploy failed = error).

Design agent business OS (`getDesignAgentOs`, whatssup-bot `GET /admin/os`): pending manager approvals, automations,
this month's AI cost. Read-only: approvals are decided in the bot's own /cc, where the hash binding lives.

Customers, inventory, fulfilment (`docs/CRM_INVENTORY.md`, migration `0003_crm_inventory.sql`):
- The command center OWNS the physical item after intake, contacts/leads/timeline, tasks, deliveries. The website owns a listed
  item's price/publish/stock and every order; the field app the item before intake; gift cards their balances. Never copy those.
- Item state changes only through `store.applyItem` (SQL `cc_inventory_apply`: row lock, expected status/version, one movement,
  idempotent by movement ref). Movements are append-only (trigger). Never update `cc_inventory_items` directly.
- Sold in one place: zero the website stock first (`setWebsiteStock`, compare-and-set), then apply; restore on failure
  (`lib/inventory/service.ts`). A website 409 is an answer, never retried.
- `lib/sync/run.ts` is the only bridge from website orders/forms; anything inconsistent becomes an `automation:double_sale`
  task, never a second sale. Runs in `/api/cron/sweep` and "Sync now".
- Writes: server actions call `runAct` (`lib/ops/act.ts`). Contact names/phones/emails need `crm:read_pii`, and are never
  returned to the assistant (contacts are ids + roles).
- In-store sales value is the only money kept here; never add it to website revenue or gift card figures.
- `getOpsStore()` = Supabase in production, memory for dev/tests (same semantics). Tests: `tests/integration/ops.test.ts`.
- Suppliers (`/suppliers`, `lib/suppliers/`, migration `0004_suppliers.sql`): purchase orders + receiving. Receiving only through
  `getSupplierStore().receive` (SQL `cc_po_receive`: locks, never more than ordered, creates items via `cc_inventory_create`,
  idempotent per request id). Lines change only before anything arrived. Received items keep `supplier_id` /
  `purchase_order_id` / `unit_cost_minor` forever (`cc_inventory_apply` never writes them). Tests: `tests/integration/suppliers.test.ts`;
  the SQL was run against a real Postgres 16, including four concurrent receipts of the same units (one wins).
- Website-made products (phone studio `/manager/quick`; the rest of /manager is retired): adopted into
  inventory by sync step `website_products` (`lib/sync/products.ts`: id cursor, first run adopts nothing, 10-min settle,
  never `jas-NNNNNN` slugs) or by hand on `/inventory/website`; stock changed on the website without an order → one
  `automation:website_stock` task, never auto-corrected. No migration (source stays `manual`; provenance = intake ref).
- The customer WhatsApp inbox (360dialog, coexistence) was PARKED by the owner on 2026-10-24; not built.

Volunteers (`docs/VOLUNTEERS.md`, migration `0005_volunteers.sql`, `lib/volunteers/`, `app/(app)/volunteers/`, app `volunteers/`):
- Two front ends, one database. `volunteers/` is its own Next app + Vercel project (Root Directory `volunteers`); it imports
  `lib/volunteers` via `@shared/*`, so that library uses RELATIVE imports only and npm packages resolve from `volunteers/node_modules`
  (Vercel installs only that package.json; CI's `volunteers` job builds it that way). The root tsconfig excludes `volunteers/`.
- Capacity, waitlist (FIFO), overlap, attendance live in plpgsql under row locks (volunteer → shift). Joins are idempotent; staff on a
  full shift is refused, not waitlisted; walk-ins exceed capacity, on the day only. Hours only from attendance. Matching only ranks.
- Notifications = `cc_vol_outbox` (dedupe key, `not_before` past quiet hours 21:00–08:00), drained by `/api/cron/sweep` and the app's
  `/api/cron`. `notifyVolunteers` never throws: a failed email is a warning on the action, not a failed write.
- Errors cross Next bundles, so test `e.conflict === true`, never `instanceof ConflictError`.
- Every Supabase list is paged (`.range`, 1000) and long `in()` lists chunked (150): PostgREST caps at max_rows silently.
- Assistant: `volunteer-tools.ts` (reads; volunteers are `V-xxxxxx` refs, never names) + `volunteer-proposals.ts` (invite, message;
  message dedupes on a requestId made at proposal time). Analytics: `lib/analytics/volunteers.ts` over `volunteerStats` only.
  Production check: `lib/selfcheck/volunteers.ts` (tables + the app's /api/health, a separate Vercel project).


Shop sales + shop mode (`docs/CRM_INVENTORY.md`, migration `0006_shop_sales.sql`, `lib/sales/`, `app/shop/`):
- A sale sells every line or none (SQL `cc_sale_create`: item locks, replay by request id); returns only through `cc_sale_return`.
  Payments are hand-recorded and a refund is a negative payment; `saleMoney` is the one definition of due/paid/balance.
- Listed items: website stock first (`shiftWebsiteStock`, compare-and-set), undone if the sale is refused. A shop sale needs only
  `inventory:financial`.
- `/shop` is Hebrew, RTL, for the counter; it shares components with the console (`components/sales/`, `components/inventory/item-form.tsx`).
  Server pages must not call functions from a `'use client'` module: form defaults live in `item-values.ts`.
- `seller` role → `/` redirects to `/shop`; `/inventory/[id]` redirects to `/shop/items/[id]`. Manifest + icon are excluded from the middleware.
- Photo AI: `lib/inventory/ai.ts` (`PHOTO_AI_MODEL`, default claude-sonnet-5-5) returns suggestions only; duplicate photos warn, never block.
- runAct for product `inventory` revalidates the `/sales`, `/shop` and `/inventory` trees.
- Shop look: `data-shop` on the layout scopes `globals.css` rules (16px fields so iOS does not zoom, 44px fields/buttons, RTL
  disclosure chevrons, themed selection/caret). One orange per screen: the active tab is sage, a handover is forest (`tone="strong"`).
  Checkout's sticky total sits ABOVE the fixed tab bar in shop mode; never `bottom-0` there. Shared pieces: `components/shop/bits.tsx`.
- Shop tabs: ראשי / מלאי / מכירות / מסירות (`tabOf` in `components/shop/shop-nav.tsx`). Handover = ONE list, `buildHandovers`
  (`lib/sales/handovers.ts`, pure, tested) via `handoverQueue()`: open shop lines + deliveries planned on /deliveries (a line's own
  delivery is listed with its line). The home counts, /shop/deliveries and the console's "Shop pickups waiting" all read it; the
  buttons are `HandoverControls` (shared with the sale page). Sales lists (console + shop) = `recentSales()`. "In stock" = `AVAILABLE`
  everywhere (snapshot, items filter). Home "sold this month" + category bars = `inventorySection` (same as /analytics). Dates DD/MM/YYYY
  (`formatDay`/`formatDayTime`).
- Labels: QR (item link) + Code 128-B of the SKU (`lib/inventory/barcode.ts`, decoded by zxing when written), `/shop/labels?ids=`.
- Website shop (`/inventory/online`, `website:write`): hide website products (unpublish via `hideWebsiteProducts`, never delete: orders point at them)
  and put items in storage on sale in bulk (`listManyOnWebsite` = `listOnWebsite` per item, published, category matched by Hebrew name,
  30 per press). `CC_SLUG` also covers the kept 4-digit serials (`jas-0042`) so the adoption sync never adopts our own listing.
- jas-inventory data: imported once by SQL (project file `jas-inventory-import/import-jas-inventory.sql`), keeping its 4-digit
  serials (JAS-0042). `skuCandidates()` makes scan/lookup try the typed code, the 6-digit CC form and the legacy one.
