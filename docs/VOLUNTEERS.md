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

## Scheduling (Sharon's Workshop) — migration 0011

Phase 1: one location (הסדנה של שרון, Mon/Tue/Wed), one scheduler (Dafna). The
model already has locations, activities per location and admins per location,
so the store (Liat) and Gil's workshop are rows, not code. Nothing about them is
shown until they exist.

- **Who does what.** Volunteers never schedule themselves: in the volunteer app
  they see their days for the next 6 weeks and report (or undo) an absence for
  one date. The scheduler works in **schedule mode** (`/schedule`, Hebrew, RTL,
  built like `/shop`): the week, one day, the regulars per weekday, and a
  Hebrew assistant. Role `scheduler` has no console permissions; `/` sends it
  to `/schedule`. Owners/admins can open `/schedule` too only if they are also
  listed as that location's scheduler.
- **Where it is enforced.** In the database, not the screen. Every write is a
  `cc_vol_sched_*` security-definer function that checks `auth.uid()` against
  `cc_vol_location_admins`; a trigger refuses any direct write to the five
  schedule tables. The service role (which the volunteer app holds) is NOT a
  scheduler: it can only report or withdraw the signed-in volunteer's own
  absence. Reads go through RLS with the scheduler's own Supabase session, which
  is also what makes realtime (`supabase_realtime`) safe; the screen falls back
  to a 30 s refresh if the socket drops.
- **The numbers.** `buildDay` in `lib/volunteers/schedule.ts` is the one
  definition. Coming = regulars on that date who are not absent + confirmed
  one-date assignments. Missing = max(0, required − coming); `null` (shown as
  "לא נקבע יעד") until the scheduler sets the number, never 0. Tentative
  ("ביקשתי, ממתין/ה") is shown apart and not counted. A closed day has no
  missing. Paused/blocked regulars are listed and not counted.
- **Candidates** only rank: "declared" = the volunteer ticked that weekday in
  their profile (self-reported, unverified); everyone else active is listed as
  "no information". Nothing is assigned automatically.
- **Assistant** (`lib/schedule/assistant.ts`, `ANTHROPIC_API_KEY`): read tools
  over the same store plus `propose_*` tools. Volunteers are `V-xxxxxx` refs in
  everything sent to the model; names are matched on the server and put back in
  the answer. A proposal changes nothing until the scheduler presses Confirm,
  which re-validates and calls the same store function as the buttons. Every
  question and every write is audited (`volunteers.schedule.*`, via assistant).
- **Self sign-up** to activities is hidden in the volunteer app (spec: volunteers
  do not schedule themselves). `VOLUNTEER_OPEN_SIGNUP=on` on the volunteer app
  brings the activities pages and open registration back.

### Part 2 (migration 0012): location managers, reminders, reservists

- **Two kinds of access per location** (`cc_vol_location_admins.access`):
  `schedule` (Dafna: changes it) and `view` (Sharon, Gil, Liat: see who is
  coming, absent and replacing, change nothing). Writes still go only through
  `cc_vol__admin()`, which now accepts `schedule` only; RLS reads accept both,
  so a location manager also gets the live (Realtime) view. Command Center staff
  with `volunteers:read_pii` can open `/schedule` read-only for any location
  (read with the service role, which the database refuses every schedule write;
  they refresh every 30 s instead of Realtime). The assistant is read-only for them.
- **Weekly reminder** (`/schedule/remind`, scheduler only): "can't come? tell us"
  for the coming week (this week on Sunday). Email: one per volunteer expected
  that week (regulars + confirmed one-date assignments, not already absent, not
  on a closed day), dedupe key `sched-reminder:<location>:<week>:<volunteer>`, so
  pressing twice sends nothing new. The database records each send first
  (`cc_vol_sched_log_reminder`, scheduler only) in `cc_vol_reminders`, which is
  the history on the page. **WhatsApp**: there is no WhatsApp sending account
  (the connected number is the owner's design agent), so the button opens
  WhatsApp with the text filled in (`wa.me/?text=`) and Dafna picks the
  volunteers' group; the app records only that it was opened. The page lists
  who will NOT get an email (no address, or reminders turned off). Not automatic:
  the spec starts with a coordinator-pressed reminder.
- **Absence alert**: when a volunteer reports an absence in the app, every
  scheduler of that location gets an email (who, which date, how the day now
  stands, link to fill it if the volunteer app has `COMMAND_CENTER_URL`). Sent at
  once when the day is within ~36 h, otherwise after quiet hours. Best-effort:
  the absence is already recorded and shown live.
- **New volunteer from schedule mode** (קבועים → "+ מתנדב/ת חדש/ה"): name, mobile,
  email (still required: it is the sign-in), reservist, optionally a regular day
  from today. Weekly reminders are ON for them (being a regular is what the
  reminder is about; they can turn it off in the app).
- **Reservist** (`cc_volunteers.reservist`): a "מילואים" mark next to the name,
  set by the scheduler. Nothing is computed from it.
- **Assistant**: `propose_add_regular` ("put Ruti on Wednesdays"); read-only for
  location managers and staff (no `propose_*` tools offered, refused if called).
- Days Sunday–Friday need no code: a slot row per weekday per location.

### Three places (migration 0013)

- בית המלאכה של שרון (Dafna, ~10 a day), מתחם כללי (Gil, mostly reservists, ~2–4), חנות הגלריה (Liat, ~2–3); all Sunday–Friday.
- Dafna coordinates every place: grant her **Schedules** on all three; Gil and Liat **Schedules** on their own; Sharon **Location manager** on the workshop.
- Required per day starts at 10 / 2 / 2 only where unset; changed on קבועים.
- Several places → chips at the top of /schedule; the last one opened is remembered (cookie, per device).

### Owner setup for scheduling

1. Supabase (Command Center project) → SQL Editor → run
   `supabase/migrations/0011_volunteer_schedule.sql`, then
   `0012_volunteer_schedule_access.sql` (both idempotent; 0011 needs 0005).
2. `/settings/staff` → invite Dafna (and Sharon) with the role **Volunteer schedule**.
3. Same page → **Volunteer schedule** → Sharon's Workshop → Add → Dafna as
   "Schedules", Sharon as "Location manager (sees it only)".
4. Volunteer app (Vercel) env, optional: `COMMAND_CENTER_URL` = the Command
   Center's URL, for the link in the absence email. Redeploy after adding.
5. Dafna opens the Command Center on her phone (add to home screen), goes to
   קבועים, sets how many are needed each day and adds the regulars.
6. Check: the volunteer app's `/api/health` now includes `schedule: ok`, and
   the production check shows "Volunteer schedule (migration 0011)" ok.

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
- Schedule: the volunteer app can report an absence for any volunteer id it is
  given (it holds the service key). The database limits it to absences, never
  assignments, and every report is a `cc_vol_events` row naming its source.
- Schedule: volunteers are not emailed when they are assigned as a replacement
  or when an absence is recorded for them by the scheduler. The scheduler calls.
- Reminders go out within an hour of their time only if the hourly sweep
  workflow runs; Vercel Hobby cron alone is daily.

## Tests

- `tests/unit/volunteers-*.test.ts`, `tests/integration/volunteers.test.ts` — rules,
  time zones (DST), paging, matching, permissions, on the memory store.
- `tests/integration/volunteers-postgrest.test.ts` — the Supabase store against a
  real PostgREST + Postgres (opt-in, see `tests/sql/README.md`).
- `tests/sql/` — the SQL functions under real concurrency (`schedule.sql` +
  `schedule-concurrency.sh` for 0011).
- `tests/integration/schedule*.test.ts` — the schedule rules and the assistant
  (references only, nothing changes before Confirm), on the memory store.
