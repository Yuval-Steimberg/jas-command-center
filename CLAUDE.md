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
