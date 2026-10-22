# Deployment and operations

## 1. Command center database (new Supabase project)

1. Create a Supabase project for the command center. Do **not** reuse the
   website's, the gift cards' or the furniture app's project.
2. SQL Editor → run `supabase/migrations/0001_init.sql` (idempotent).
3. Authentication → Providers → Email: **disable sign-ups**.
4. Authentication → Users → Add user (the owner; Auto Confirm).
5. SQL Editor → edit and run `supabase/add-staff.sql` (role `owner`).

## 2. Vercel project

New Vercel project from this repo (framework: Next.js). Production branch:
`main`. Set the variables in `.env.example`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Command center Supabase → Settings → API |
| `WEBSITE_URL` | The website's production URL |
| `WEBSITE_AGENT_API_KEY` | Generate 32 random chars; set the same value as `AGENT_API_KEY` on the website's Vercel project (the design agent may already use it as `WEBSITE_METRICS_TOKEN` — reuse that value) |
| `WEBSITE_COMMAND_CENTER_KEY` | Generate a NEW 32+ char value (not the agent key); set the same value as `COMMAND_CENTER_API_KEY` on the website's Vercel project and redeploy the website. Turns on /website/orders and /website/products |
| `GIFT_CARDS_URL` | `https://gift.justasecond.co.il` |
| `GIFT_CARDS_INTEGRATION_KEY` | Generate 40 random chars; set the same value as `INTEGRATION_API_KEY` on the gift card Vercel project (after its PR is merged), then redeploy it |
| `FURNITURE_SUPABASE_URL`, `FURNITURE_SUPABASE_KEY` | Furniture Supabase (`fdxqfwmtrqbaeqejynmu`) → Settings → API. See §3 |
| `FURNITURE_APP_URL` | The field app's production URL |
| `DESIGN_AGENT_URL`, `DESIGN_AGENT_ADMIN_TOKEN` | Railway → service → Networking (domain) and Variables (`ADMIN_TOKEN`) |
| `GITHUB_TOKEN` | To propose map place changes (fine-grained, `Interactive-map` only, Contents + Pull requests: read and write). Reads work without it on a public repo |
| `MAP_GA4_PROPERTY_ID` | Map visitors: the numeric GA4 property id (not the `G-` measurement id) |
| `GA4_SERVICE_ACCOUNT_JSON` | Map visitors: a Google service-account key file, its email added as Viewer on that property |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys. Set a monthly spend limit (Settings → Limits). Optional `ASSISTANT_MODEL` (default `claude-opus-5-5`) |

Env changes need a redeploy. Generate secrets with `openssl rand -base64 32`.
Never paste them in chat or commit them.

## 3. Furniture database access (least privilege)

The adapter only reads `projects` and `project_summary_counts`. The service
role key works but bypasses RLS on worker data. Preferred, before go-live:
create a dedicated read-only Postgres role in the furniture project, grant
`SELECT` on exactly those two objects, and use a key for it. Tracked as S8 in the
inventory.

## 4. Verify

- `GET /api/health` → `{ ok: true }` (liveness only, public).
- Sign in → **Integrations**: every configured product should show live checks
  with a timestamp and latency. A red check shows the source's own error.
- **Settings → Audit log** records the sign-in.

## 5. Operations

- **Backups:** the command center stores only staff, permissions and the audit
  log; enable Supabase daily backups (Pro) or export `cc_audit_log` periodically.
- **Retention:** `cc_audit_log` is append-only by trigger. If a retention limit
  is required, drop the trigger inside a maintenance transaction, delete rows
  older than the limit, and recreate it.
- **Rotating a source key:** set the new value on the source first, then here,
  redeploy both. The integration shows `HTTP 401` in between — that is correct.
- **Monitoring:** point an uptime monitor at `/api/health`; source problems are
  visible on the overview and in Notifications.
