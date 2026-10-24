# JAS Volunteers

One database, two front ends:

| | Where | Who | Auth |
|---|---|---|---|
| Volunteer app | `volunteers/` (its own Next app, its own Vercel project) | volunteers, public | email one-time code → signed cookie |
| Volunteers module | `app/(app)/volunteers/` in the Command Center | staff | the Command Center's Supabase Auth + roles |

Both run the same rules from `lib/volunteers/` and the same SQL functions in
`supabase/migrations/0005_volunteers.sql`. The volunteer app imports
`lib/volunteers` with relative paths (`@shared/*`) and resolves npm packages
from its own `node_modules`, because Vercel installs only `volunteers/package.json`.

## Where each rule lives

- **Capacity, waitlist, overlap, idempotent joins, attendance** — plpgsql in 0005,
  under row locks (lock order: volunteer → shift). A freed place goes to the
  longest-waiting volunteer in the same transaction. Staff placing someone on a
  full shift is refused, not waitlisted. A walk-in (QR on the day, or staff
  "walk-in") is the only join that may exceed capacity, and only on the day.
- **Hours** come only from attendance (check-in/out, "full shift", or a
  correction with a note). Registering or being confirmed is never an hour.
- **Matching** (`lib/volunteers/rules.ts` `scoreMatch`, `admin.ts` `recommend`)
  only ranks. Staff press Invite; the volunteer accepts. Nothing auto-assigns.
- **Notifications** (`notify.ts`) go into `cc_vol_outbox` with a dedupe key and a
  `not_before` that respects quiet hours (21:00–08:00 Israel). The outbox is
  drained by the volunteer app's `/api/cron` (daily, Vercel) and by the Command
  Center's `/api/cron/sweep` (hourly, `.github/workflows/sweep.yml`). Opt-outs
  are per kind (reminders, opportunities); account email (codes, confirmations,
  cancellations by the team) is not optional. Volunteers never see each other's
  contact details: the volunteer app shows counts, never names.
- **Identity**: a volunteer row links to one CRM contact (`contact_id`, unique),
  matched by normalised email then phone. Volunteer details stay in
  `cc_volunteers`; the CRM shows the role, not the volunteer's preferences or notes.
- **Audit**: every staff write goes through `runAct` (requested → outcome in
  `cc_audit_log`); every volunteer-side change is an append-only `cc_vol_events` row.

## Roles (Command Center)

| Permission | owner | admin | operations_manager | project_manager | volunteer_coordinator | viewer |
|---|---|---|---|---|---|---|
| `volunteers:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `volunteers:read_pii` (names, emails, phones) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `volunteers:operate` (invite, assign, remove, attendance, messages, notes) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `volunteers:write` (activities, shifts, register a volunteer, status; erase also needs read_pii) | ✓ | ✓ | ✓ | ✓ | ✓ | |

A volunteer coordinator also reads furniture projects (to link an activity) and
the map, and nothing about money, customers or other products.
See `lib/auth/rbac.ts` for the exact list; it is the source of truth.

## Owner setup (in this order)

1. **Database.** Command Center Supabase → SQL Editor → run
   `supabase/migrations/0005_volunteers.sql` (idempotent; needs 0001 and 0003,
   already applied). Until it runs, both front ends say "run 0005" instead of
   showing empty lists.
2. **Volunteer app on Vercel.** New Project → import `jas-command-center` →
   **Root Directory = `volunteers`** (framework Next.js). Environment variables
   (Production):
   - `SUPABASE_URL` — the Command Center's Supabase URL (same project as step 1)
   - `SUPABASE_SERVICE_ROLE_KEY` — that project's service role key
   - `VOLUNTEER_SESSION_SECRET` — 32+ random characters, used by nothing else
     (`openssl rand -base64 48`)
   - `SENDGRID_API_KEY` — the same paid SendGrid account (the domain is already authenticated)
   - `VOLUNTEER_APP_URL` — the app's public URL, e.g. `https://volunteers.justasecond.co.il`
     or the `*.vercel.app` URL Vercel gives it
   - `CRON_SECRET` — any random string; Vercel cron sends it automatically
   - optional: `VOLUNTEER_EMAIL_FROM` (default `Just A Second · מתנדבים <volunteers@justasecond.co.il>`),
     `VOLUNTEER_REPLY_TO`, `VOLUNTEER_TEAM_PHONE` (default 058-787-6549)
3. **Command Center env** (existing Vercel project) → add `VOLUNTEER_APP_URL`
   (same value as step 2; used for the QR code and email links) → redeploy.
4. **Staff.** Give coordinators the `volunteer_coordinator` role in
   `/settings/staff`.
5. **Verify.** Open `<VOLUNTEER_APP_URL>/api/health` — it must say
   `database: ok` and list no missing config. Then register yourself in the app,
   publish one activity in `/volunteers/activities/new`, and join it.
6. Optional: a custom domain (`volunteers.justasecond.co.il`) is a CNAME in Wix
   DNS to `cname.vercel-dns.com`, then add it in the Vercel project.

The Command Center's `vercel.json` skips its own build when only `volunteers/`
changed; the volunteer app's `vercel.json` skips its build unless `volunteers/`
or the shared library changed.

## Assistant, analytics, production check

- **Assistant** (`lib/assistant/volunteer-tools.ts`, `volunteer-proposals.ts`): `get_volunteer_overview`
  and `suggest_volunteers_for_shift` (volunteers:read) return counts and references (`V-1a2b3c`) — never a
  name, phone or email, since tool results go to the model provider. `propose_volunteer_invite` and
  `propose_volunteer_message_shift` (volunteers:operate) only describe the action; the person's Confirm runs
  the same store calls and emails as the shift page. A message carries a request id from the proposal, so
  confirming twice sends once.
- **Analytics** (`lib/analytics/volunteers.ts`): a Volunteers section built on `volunteerStats` — the same
  function as Volunteers → Reports — with signed up (expected), attended (actual) and registered as separate
  metrics (`vol.*` in `lib/metrics-catalog.ts`). It also flows into the business reports.
- **Production check** (`lib/selfcheck/volunteers.ts`): the 0005 tables read through the Command Center
  (and failed volunteer emails in 7 days), and the volunteer app's own `/api/health`.

## Deliberately not built (and why)

- **Phone (SMS) login and WhatsApp/SMS notifications.** There is no SMS or
  WhatsApp provider on the account (the customer WhatsApp inbox was parked on
  2026-10-24). Login is email-code only; phone is stored for staff. Adding SMS
  means choosing a provider (cost per message) and is one adapter in `mail.ts`.
- **Interactive Map link.** The map is a static 21-place route with no notion of
  volunteers or activities; an activity carries its own place and arrival notes.

## Known risks

- The volunteer app holds the service role key. Every query is server-side and
  scoped to the signed-in volunteer, but a bug in that app reads the whole
  Command Center database. A Postgres role limited to `cc_vol_*` and
  `cc_contacts` would shrink that; it is not set up.
- Email codes are rate-limited per address (`countLoginCodes`), not per IP.
- Reminders go out within an hour of their time only if the hourly sweep
  workflow runs; Vercel Hobby cron alone is daily.

## Tests

- `tests/unit/volunteers-*.test.ts`, `tests/integration/volunteers.test.ts` — rules,
  time zones (DST), paging, matching, permissions, on the memory store.
- `tests/integration/volunteers-postgrest.test.ts` — the Supabase store against a
  real PostgREST + Postgres (opt-in, see `tests/sql/README.md`).
- `tests/sql/` — the SQL functions under real concurrency.
