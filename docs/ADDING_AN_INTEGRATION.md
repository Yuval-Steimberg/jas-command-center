# Adding an integration

A product is connected through one adapter. Nothing else in the app knows how
the product stores its data.

1. **Find the contract.** Prefer an endpoint the product already exposes for
   machines. If there is none, add a narrow, read-only, key-protected one *in the
   product's repo* (via PR) that calls the product's own logic — as
   `gift_card_system`'s `/api/integration/v1/summary` does. Read a database
   directly only through views the product already uses.
2. **Write the contract** in `lib/integrations/<product>/contract.ts` as Zod
   schemas. Validate every response; a changed shape must become an error, never
   a wrong number.
3. **Write the adapter** (`adapter.ts`) implementing `IntegrationAdapter`:
   - `config()` — env vars, and which are missing;
   - `capabilities()` — each read/write and its honest status
     (`available` / `needs_credentials` / `needs_source_change` / `not_built` / `unsupported`);
   - `health()` — live probes only; `unknown` when it cannot check;
   - read functions returning `SourceResult<T>` via `readSource()` (caching,
     timing, error capture) and `notConfigured()`.
   - Writes: a function that returns what the source *confirmed*.
4. **Add the product** to `PRODUCTS` in `lib/auth/rbac.ts` (permissions follow
   automatically), to `ADAPTERS` in `lib/integrations/registry.ts`, and a nav
   item in `components/shell/nav.ts`.
5. **Every write** goes through a server action that calls
   `requirePermission()`, writes a `requested` audit row, calls the adapter,
   then writes `succeeded`/`failed` with what the source returned.
6. **Metrics** you display go into `lib/metrics-catalog.ts` with their source.
7. **Alerts**, if any, go into `deriveAlerts()` with a test.
8. **Tests:** a contract test against a local fake server
   (`tests/integration/fake-server.ts`) that asserts the request you send (path,
   auth header, body) and the error path. Run it once against the code with the
   check removed and watch it fail.
