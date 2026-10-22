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
  over the same adapters. No SQL, no URLs, no writes. A new tool names its
  permission, has a Zod input + strict JSON schema, and trims PII before return
  (everything returned is sent to the model provider).
- Tools offered = the user's role; `runTool` re-checks. Every lookup writes
  `assistant.tool` and every question `assistant.ask` (via = assistant); a failed
  audit write aborts the answer.
- System prompt is frozen (date goes in the user turn) so the prompt cache holds.
  History from the browser is text-only and schema-checked; within one question
  the loop is append-only. Bounded: `MAX_ROUNDS` 6, `DEADLINE_MS` 45 s.
- Write actions are not built. When they are: confirmation step in the UI,
  `requested` audit before, confirmed outcome after — never executed by the model alone.

Website writes (`lib/integrations/website/manage.ts`, pages `/website/orders`, `/website/products`):
- Through the website's `_agent-ops.ts` with `WEBSITE_COMMAND_CENTER_KEY` — a separate key from the
  snapshot-only `WEBSITE_AGENT_API_KEY`, which the website's AI agent also holds.
- Fulfilment statuses only (revenue never moves); products: price/original_price/quantity/featured.
  409 = changed since loaded → shown as "reload", never retried or overwritten.
- The website has no audit table: the command center's audit (with before/after) is the only record.

Furniture writes (`lib/integrations/furniture/manage.ts`, page `/furniture/[id]`):
- Only column updates the field app itself makes: `projects.archived`, `items.gallery_type` (its
  trigger derives `intended_for_collection`). Item PATCH is conditional on `updated_at`.
- Never tick `collected`, finish an apartment or confirm a handover from here: those carry the
  collector's name and completion rules that live in the app's client code.

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

