-- JAS Command Center — JAS Volunteers: volunteers, activities, shifts, sign-ups,
-- attendance and the notification outbox.
--
-- One database, two front ends: the Command Center's Volunteers module and the
-- standalone volunteer app (volunteers/ in this repo, its own Vercel project).
-- Both talk to these tables through the server with the service role. Every
-- rule that must hold under concurrency lives HERE, in plpgsql, so neither
-- front end can break it:
--
--   * a shift never has more confirmed volunteers than its capacity
--     (the shift row is locked for every join, leave and capacity change);
--   * a volunteer is never confirmed or waitlisted on two overlapping shifts
--     (the volunteer row is locked for every join);
--   * one sign-up row per (shift, volunteer): joining twice returns the same row;
--   * a freed place goes to the longest-waiting volunteer, in the same transaction;
--   * a cancelled activity or shift accepts nobody;
--   * hours exist only from recorded attendance (check-in/out, a coordinator's
--     "full shift", or a correction with a note), never from registering.
--
-- Lock order is always volunteer → shift (joins), or shift alone (leave,
-- promote, capacity, cancel). Promotion never takes a volunteer lock: a
-- waitlisted sign-up already counted in that volunteer's overlap check.
--
-- Same access model as 0001/0003/0004: RLS on, no policies, service role only.
-- Idempotent: safe to run twice. Requires 0001 and 0003.

-- ── New staff role: volunteer coordinator ──────────────────────────────────
alter table cc_user_roles drop constraint if exists cc_user_roles_role_check;
alter table cc_user_roles add constraint cc_user_roles_role_check
  check (role in ('owner','admin','operations_manager','project_manager','volunteer_coordinator','viewer'));
alter table cc_role_permissions drop constraint if exists cc_role_permissions_role_check;
alter table cc_role_permissions add constraint cc_role_permissions_role_check
  check (role in ('owner','admin','operations_manager','project_manager','volunteer_coordinator','viewer'));

-- ── Volunteers ──────────────────────────────────────────────────────────────
create table if not exists cc_volunteers (
  id                    uuid primary key default gen_random_uuid(),
  contact_id            uuid unique references cc_contacts(id) on delete set null,  -- the CRM identity
  full_name             text not null,
  email                 text,            -- lower-case; the sign-in address. NULL once the account is deleted
  phone                 text,            -- digits, 05XXXXXXXX
  adult                 boolean not null default false,   -- confirmed 18 or older
  age_confirmed_at      timestamptz not null default now(), -- confirmed at least the minimum age (16)
  areas                 text[] not null default '{}',
  availability          text[] not null default '{}',     -- sun_morning … sat_evening
  skills                text[] not null default '{}',
  transport             text not null default 'none' check (transport in ('none','car','van')),
  about                 text,
  notify_reminders      boolean not null default true,
  notify_opportunities  boolean not null default false,
  consent_whatsapp      boolean not null default false,   -- recorded for when a WhatsApp business number exists
  consent_at            timestamptz not null default now(),
  status                text not null default 'active' check (status in ('active','paused','blocked','deleted')),
  session_version       integer not null default 1,       -- bump = sign out everywhere
  source                text not null default 'app' check (source in ('app','staff','website_form')),
  last_seen_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists cc_volunteers_email on cc_volunteers (email) where email is not null;
create unique index if not exists cc_volunteers_phone on cc_volunteers (phone) where phone is not null;
create index if not exists cc_volunteers_status on cc_volunteers (status, created_at desc);

-- Internal coordinator notes. Staff only; never shown to the volunteer.
create table if not exists cc_vol_notes (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references cc_volunteers(id) on delete cascade,
  body          text not null,
  author_email  text not null,
  at            timestamptz not null default now()
);
create index if not exists cc_vol_notes_volunteer on cc_vol_notes (volunteer_id, at desc);

-- ── Activities and shifts ───────────────────────────────────────────────────
create table if not exists cc_vol_activities (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  summary                 text,           -- one line on the card
  description             text,
  kind                    text not null default 'other'
                            check (kind in ('collection','sorting','preparation','inventory','donation_event','loading','transport','event','other')),
  status                  text not null default 'draft' check (status in ('draft','published','cancelled','completed')),
  furniture_project_id    text,           -- Furniture-Collect projects.id (the reference; never a copy of the project)
  furniture_project_name  text,           -- display only, refreshed when the activity is saved
  location_name           text,
  address                 text,
  area                    text,
  map_url                 text,
  arrival_info            text,
  requirements            text,           -- physical requirements
  equipment               text,           -- what to bring
  instructions            text,
  adults_only             boolean not null default false,
  required_skills         text[] not null default '{}',
  coordinator_profile_id  uuid references cc_profiles(id) on delete set null,
  coordinator_name        text,
  contact_phone           text,           -- the team's operational phone, never a volunteer's
  photo_urls              text[] not null default '{}',
  signup_closes_hours     integer not null default 0 check (signup_closes_hours between 0 and 168),
  series_id               uuid,           -- activities created together by "repeat weekly" share it
  cancel_reason           text,
  cancelled_at            timestamptz,
  version                 integer not null default 1,
  created_by              text not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists cc_vol_activities_status on cc_vol_activities (status, updated_at desc);
create index if not exists cc_vol_activities_project on cc_vol_activities (furniture_project_id) where furniture_project_id is not null;

create table if not exists cc_vol_shifts (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references cc_vol_activities(id) on delete cascade,
  label           text,
  role            text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        integer not null check (capacity between 1 and 500),
  min_volunteers  integer not null default 0,
  status          text not null default 'open' check (status in ('open','cancelled')),
  checkin_code    text not null default replace(gen_random_uuid()::text, '-', ''),
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  check (min_volunteers >= 0 and min_volunteers <= capacity)
);
create index if not exists cc_vol_shifts_activity on cc_vol_shifts (activity_id, starts_at);
create index if not exists cc_vol_shifts_starts on cc_vol_shifts (starts_at);

-- ── Sign-ups and attendance ─────────────────────────────────────────────────
create table if not exists cc_vol_signups (
  id                 uuid primary key default gen_random_uuid(),
  shift_id           uuid not null references cc_vol_shifts(id) on delete restrict,
  volunteer_id       uuid not null references cc_volunteers(id) on delete restrict,
  status             text not null check (status in ('invited','confirmed','waitlisted','cancelled','declined','removed')),
  source             text not null default 'self' check (source in ('self','invite','staff','walk_in')),
  queued_at          timestamptz,     -- waitlist order
  invited_by         text,
  cancelled_at       timestamptz,
  cancel_reason      text,
  attendance         text not null default 'unknown' check (attendance in ('unknown','present','absent','excused')),
  check_in_at        timestamptz,
  check_out_at       timestamptz,
  minutes            integer check (minutes is null or minutes between 0 and 1440),
  attendance_method  text check (attendance_method is null or attendance_method in ('coordinator','qr','full_shift','correction')),
  attendance_by      text,
  attendance_note    text,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (shift_id, volunteer_id),
  check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at),
  -- Hours only with recorded presence.
  check (minutes is null or attendance = 'present')
);
create index if not exists cc_vol_signups_volunteer on cc_vol_signups (volunteer_id, created_at desc);
create index if not exists cc_vol_signups_shift on cc_vol_signups (shift_id, status, queued_at);

-- Append-only history of every sign-up and attendance change, by volunteers and staff alike.
create table if not exists cc_vol_events (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  signup_id     uuid references cc_vol_signups(id) on delete set null,
  shift_id      uuid,
  volunteer_id  uuid,
  kind          text not null,
  actor         text not null,   -- staff email, or volunteer:<id>, or system
  detail        jsonb not null default '{}'
);
create index if not exists cc_vol_events_signup on cc_vol_events (signup_id, at);
create index if not exists cc_vol_events_volunteer on cc_vol_events (volunteer_id, at desc);
create index if not exists cc_vol_events_at on cc_vol_events (at desc);

create or replace function cc_vol_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'cc_vol_events is append-only';
end $$;
drop trigger if exists cc_vol_events_no_change on cc_vol_events;
create trigger cc_vol_events_no_change before update or delete on cc_vol_events
  for each row execute function cc_vol_events_append_only();

-- ── Notifications outbox (email today; channel kept for WhatsApp later) ─────
create table if not exists cc_vol_outbox (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid references cc_volunteers(id) on delete cascade,
  to_email      text,
  channel       text not null default 'email' check (channel in ('email')),
  kind          text not null,
  dedupe_key    text not null unique,
  subject       text not null,
  body          text not null,
  status        text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  not_before    timestamptz not null default now(),
  attempts      integer not null default 0,
  last_error    text,
  sent_at       timestamptz,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists cc_vol_outbox_due on cc_vol_outbox (status, not_before);

-- ── Sign-in codes (email one-time codes for the volunteer app) ──────────────
create table if not exists cc_vol_login_codes (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists cc_vol_login_codes_email on cc_vol_login_codes (email, created_at desc);

-- ── Functions ───────────────────────────────────────────────────────────────

-- Register (or update the registration of) a volunteer and link the CRM contact,
-- in one transaction. Matching: the volunteer by email; the contact by email,
-- then phone. A phone that already belongs to ANOTHER volunteer is refused.
create or replace function cc_vol_register(p jsonb)
returns setof cc_volunteers language plpgsql as $$
declare
  v cc_volunteers;
  c_id uuid;
  e text := lower(trim(p->>'email'));
  ph text := nullif(p->>'phone', '');
begin
  if e is null or e = '' then raise exception 'cc_conflict: an email address is required'; end if;
  if coalesce(p->>'full_name', '') = '' then raise exception 'cc_conflict: a name is required'; end if;
  if ph is not null and exists (select 1 from cc_volunteers where phone = ph and email is distinct from e) then
    raise exception 'cc_conflict: this phone number is already registered with another email';
  end if;
  select id into c_id from cc_contacts where email = e limit 1;
  if c_id is null and ph is not null then select id into c_id from cc_contacts where phone = ph limit 1; end if;
  if c_id is null then
    insert into cc_contacts (full_name, email, phone, roles, source)
    values (p->>'full_name', e, case when exists (select 1 from cc_contacts where phone = ph) then null else ph end, array['volunteer'], 'volunteer_app')
    returning id into c_id;
  else
    update cc_contacts set roles = case when 'volunteer' = any(roles) then roles else array_append(roles, 'volunteer') end, updated_at = now() where id = c_id;
  end if;
  insert into cc_volunteers (contact_id, full_name, email, phone, adult, areas, availability, skills, transport, about,
                             notify_reminders, notify_opportunities, consent_whatsapp, source)
  values (case when exists (select 1 from cc_volunteers where contact_id = c_id) then null else c_id end,
          p->>'full_name', e, ph, coalesce((p->>'adult')::boolean, false),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p->'areas') x), '{}'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p->'availability') x), '{}'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p->'skills') x), '{}'),
          coalesce(p->>'transport', 'none'), nullif(p->>'about', ''),
          coalesce((p->>'notify_reminders')::boolean, true), coalesce((p->>'notify_opportunities')::boolean, false),
          coalesce((p->>'consent_whatsapp')::boolean, false), coalesce(p->>'source', 'app'))
  on conflict (email) where email is not null do nothing
  returning * into v;
  if v.id is null then raise exception 'cc_conflict: this email is already registered'; end if;
  insert into cc_vol_events (volunteer_id, kind, actor, detail) values (v.id, 'registered', coalesce(p->>'actor', 'volunteer:' || v.id), jsonb_build_object('source', v.source));
  return next v;
end $$;

-- Hand freed places to the waitlist, longest waiting first. Caller holds the shift lock.
create or replace function cc_vol__promote(p_shift uuid, p_actor text)
returns setof cc_vol_signups language plpgsql as $$
declare
  sh cc_vol_shifts;
  a cc_vol_activities;
  free integer;
  s cc_vol_signups;
begin
  select * into sh from cc_vol_shifts where id = p_shift;
  select * into a from cc_vol_activities where id = sh.activity_id;
  if sh.status <> 'open' or a.status <> 'published' or sh.starts_at <= now() then return; end if;
  free := sh.capacity - (select count(*) from cc_vol_signups where shift_id = p_shift and status = 'confirmed');
  for s in
    select su.* from cc_vol_signups su join cc_volunteers v on v.id = su.volunteer_id
    where su.shift_id = p_shift and su.status = 'waitlisted' and v.status = 'active'
    order by su.queued_at nulls last, su.created_at
  loop
    exit when free <= 0;
    update cc_vol_signups set status = 'confirmed', queued_at = null, version = version + 1, updated_at = now() where id = s.id returning * into s;
    insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor) values (s.id, p_shift, s.volunteer_id, 'promoted', p_actor);
    free := free - 1;
    return next s;
  end loop;
end $$;

-- Join a shift (volunteer, invite acceptance, staff add, or a walk-in on the day).
create or replace function cc_vol_join(p_shift uuid, p_volunteer uuid, p_source text, p_actor text)
returns setof cc_vol_signups language plpgsql as $$
declare
  v cc_volunteers;
  sh cc_vol_shifts;
  a cc_vol_activities;
  ex cc_vol_signups;
  clash record;
  confirmed integer;
  st text;
  s cc_vol_signups;
begin
  if p_source not in ('self','invite','staff','walk_in') then raise exception 'cc_conflict: unknown source %', p_source; end if;
  select * into v from cc_volunteers where id = p_volunteer for update;
  if not found then raise exception 'cc_conflict: volunteer not found'; end if;
  if v.status <> 'active' then raise exception 'cc_conflict: this volunteer account is %', v.status; end if;
  select * into sh from cc_vol_shifts where id = p_shift for update;
  if not found then raise exception 'cc_conflict: shift not found'; end if;
  select * into a from cc_vol_activities where id = sh.activity_id;
  if a.status <> 'published' then raise exception 'cc_conflict: this activity is %', a.status; end if;
  if sh.status <> 'open' then raise exception 'cc_conflict: this shift was cancelled'; end if;
  if p_source = 'walk_in' then
    if now() < sh.starts_at - interval '2 hours' or now() > sh.ends_at + interval '12 hours' then
      raise exception 'cc_conflict: a walk-in can be added only on the day of the shift';
    end if;
  elsif sh.starts_at <= now() then
    raise exception 'cc_conflict: this shift has already started';
  elsif p_source <> 'staff' and now() > sh.starts_at - make_interval(hours => a.signup_closes_hours) then
    raise exception 'cc_conflict: sign-up for this shift has closed';
  end if;
  if a.adults_only and not v.adult then raise exception 'cc_conflict: this activity is for volunteers aged 18 and over'; end if;

  select * into ex from cc_vol_signups where shift_id = p_shift and volunteer_id = p_volunteer;
  if found and ex.status in ('confirmed','waitlisted') then return next ex; return; end if;

  select sh2.starts_at, a2.title into clash
  from cc_vol_signups s2 join cc_vol_shifts sh2 on sh2.id = s2.shift_id join cc_vol_activities a2 on a2.id = sh2.activity_id
  where s2.volunteer_id = p_volunteer and s2.status in ('confirmed','waitlisted') and sh2.id <> p_shift and sh2.status = 'open'
    and tstzrange(sh2.starts_at, sh2.ends_at) && tstzrange(sh.starts_at, sh.ends_at)
  limit 1;
  if found then raise exception 'cc_conflict: overlaps another shift you joined (%)', clash.title; end if;

  confirmed := (select count(*) from cc_vol_signups where shift_id = p_shift and status = 'confirmed');
  if confirmed < sh.capacity or p_source = 'walk_in' then st := 'confirmed';
  elsif p_source = 'staff' then raise exception 'cc_conflict: the shift is full (% of %); raise its capacity first', confirmed, sh.capacity;
  else st := 'waitlisted';
  end if;

  if ex.id is null then
    insert into cc_vol_signups (shift_id, volunteer_id, status, source, queued_at)
    values (p_shift, p_volunteer, st, p_source, case when st = 'waitlisted' then now() end)
    returning * into s;
  else
    update cc_vol_signups set status = st, source = case when ex.status = 'invited' then 'invite' else p_source end,
      queued_at = case when st = 'waitlisted' then now() end, cancelled_at = null, cancel_reason = null,
      version = version + 1, updated_at = now()
    where id = ex.id returning * into s;
  end if;
  insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor, detail)
  values (s.id, p_shift, p_volunteer, case when st = 'waitlisted' then 'waitlisted' else 'joined' end, p_actor, jsonb_build_object('source', p_source));
  return next s;
end $$;

-- Invite a volunteer to a shift. Does not take a place: the volunteer accepts (cc_vol_join) or declines.
create or replace function cc_vol_invite(p_shift uuid, p_volunteer uuid, p_actor text)
returns setof cc_vol_signups language plpgsql as $$
declare
  sh cc_vol_shifts;
  a cc_vol_activities;
  v cc_volunteers;
  ex cc_vol_signups;
  s cc_vol_signups;
begin
  select * into v from cc_volunteers where id = p_volunteer;
  if not found or v.status <> 'active' then raise exception 'cc_conflict: this volunteer cannot be invited'; end if;
  select * into sh from cc_vol_shifts where id = p_shift for update;
  if not found then raise exception 'cc_conflict: shift not found'; end if;
  select * into a from cc_vol_activities where id = sh.activity_id;
  if a.status <> 'published' or sh.status <> 'open' or sh.starts_at <= now() then raise exception 'cc_conflict: this shift is not open'; end if;
  if a.adults_only and not v.adult then raise exception 'cc_conflict: this activity is for volunteers aged 18 and over'; end if;
  select * into ex from cc_vol_signups where shift_id = p_shift and volunteer_id = p_volunteer;
  if found and ex.status in ('confirmed','waitlisted','invited') then return next ex; return; end if;
  if found then
    update cc_vol_signups set status = 'invited', source = 'invite', invited_by = p_actor, queued_at = null, cancelled_at = null, cancel_reason = null, version = version + 1, updated_at = now()
    where id = ex.id returning * into s;
  else
    insert into cc_vol_signups (shift_id, volunteer_id, status, source, invited_by) values (p_shift, p_volunteer, 'invited', 'invite', p_actor) returning * into s;
  end if;
  insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor) values (s.id, p_shift, p_volunteer, 'invited', p_actor);
  return next s;
end $$;

-- Leave a shift: 'cancelled' (the volunteer withdrew), 'declined' (an invitation), 'removed' (staff).
-- Returns the changed sign-up first, then anyone promoted from the waitlist.
create or replace function cc_vol_leave(p_signup uuid, p_status text, p_reason text, p_actor text, p_volunteer uuid)
returns setof cc_vol_signups language plpgsql as $$
declare
  s cc_vol_signups;
  sh cc_vol_shifts;
  was text;
  p cc_vol_signups;
begin
  if p_status not in ('cancelled','declined','removed') then raise exception 'cc_conflict: unknown status %', p_status; end if;
  select sh0.* into sh from cc_vol_shifts sh0 join cc_vol_signups s0 on s0.shift_id = sh0.id where s0.id = p_signup for update of sh0;
  if not found then raise exception 'cc_conflict: sign-up not found'; end if;
  select * into s from cc_vol_signups where id = p_signup for update;
  if p_volunteer is not null and s.volunteer_id <> p_volunteer then raise exception 'cc_conflict: sign-up not found'; end if;
  if s.status not in ('invited','confirmed','waitlisted') then return next s; return; end if;  -- already out: nothing to do
  if p_status = 'declined' and s.status <> 'invited' then raise exception 'cc_conflict: only an invitation can be declined'; end if;
  if s.attendance = 'present' then raise exception 'cc_conflict: attendance is already recorded for this shift'; end if;
  if p_volunteer is not null and sh.starts_at <= now() then raise exception 'cc_conflict: the shift has started; please call the coordinator'; end if;
  was := s.status;
  update cc_vol_signups set status = p_status, queued_at = null, cancelled_at = now(), cancel_reason = nullif(p_reason, ''), version = version + 1, updated_at = now()
  where id = p_signup returning * into s;
  insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor, detail)
  values (s.id, s.shift_id, s.volunteer_id, p_status, p_actor, jsonb_build_object('was', was, 'reason', nullif(p_reason, '')));
  return next s;
  if was = 'confirmed' then
    for p in select * from cc_vol__promote(sh.id, 'system') loop return next p; end loop;
  end if;
end $$;

-- Create or update a shift. Capacity can never drop below the confirmed count;
-- raising it promotes the waitlist. Returns {shift, promoted: [signup ids]}.
create or replace function cc_vol_shift_save(p_id uuid, p_activity uuid, p_expect_version integer, p jsonb, p_actor text)
returns jsonb language plpgsql as $$
declare
  sh cc_vol_shifts;
  confirmed integer;
  promoted uuid[] := '{}';
  pr cc_vol_signups;
begin
  if p_id is null then
    if not exists (select 1 from cc_vol_activities where id = p_activity and status in ('draft','published')) then
      raise exception 'cc_conflict: shifts can be added only to a draft or published activity';
    end if;
    insert into cc_vol_shifts (activity_id, label, role, starts_at, ends_at, capacity, min_volunteers)
    values (p_activity, nullif(p->>'label', ''), nullif(p->>'role', ''), (p->>'starts_at')::timestamptz, (p->>'ends_at')::timestamptz,
            (p->>'capacity')::integer, coalesce((p->>'min_volunteers')::integer, 0))
    returning * into sh;
    insert into cc_vol_events (shift_id, kind, actor, detail) values (sh.id, 'shift_created', p_actor, p);
    return jsonb_build_object('shift', to_jsonb(sh), 'promoted', '[]'::jsonb);
  end if;
  select * into sh from cc_vol_shifts where id = p_id for update;
  if not found then raise exception 'cc_conflict: shift not found'; end if;
  if p_expect_version is not null and sh.version <> p_expect_version then raise exception 'cc_conflict: the shift changed since it was loaded'; end if;
  if sh.status <> 'open' then raise exception 'cc_conflict: the shift was cancelled'; end if;
  confirmed := (select count(*) from cc_vol_signups where shift_id = p_id and status = 'confirmed');
  if (p->>'capacity')::integer < confirmed then
    raise exception 'cc_conflict: % volunteers are confirmed; remove someone before lowering capacity to %', confirmed, (p->>'capacity')::integer;
  end if;
  update cc_vol_shifts set label = nullif(p->>'label', ''), role = nullif(p->>'role', ''),
    starts_at = (p->>'starts_at')::timestamptz, ends_at = (p->>'ends_at')::timestamptz,
    capacity = (p->>'capacity')::integer, min_volunteers = coalesce((p->>'min_volunteers')::integer, 0),
    version = version + 1, updated_at = now()
  where id = p_id returning * into sh;
  insert into cc_vol_events (shift_id, kind, actor, detail) values (sh.id, 'shift_updated', p_actor, p);
  for pr in select * from cc_vol__promote(p_id, p_actor) loop promoted := promoted || pr.id; end loop;
  return jsonb_build_object('shift', to_jsonb(sh), 'promoted', to_jsonb(promoted));
end $$;

-- Cancel one shift, or (p_shift null) every open shift of an activity and the activity itself.
-- Every live sign-up becomes 'cancelled' with the reason; returns them so the volunteers can be told.
create or replace function cc_vol_cancel(p_activity uuid, p_shift uuid, p_reason text, p_actor text)
returns setof cc_vol_signups language plpgsql as $$
declare
  sh cc_vol_shifts;
  s cc_vol_signups;
begin
  if p_shift is null then
    update cc_vol_activities set status = 'cancelled', cancel_reason = nullif(p_reason, ''), cancelled_at = now(), version = version + 1, updated_at = now()
    where id = p_activity and status in ('draft','published');
    if not found then raise exception 'cc_conflict: the activity is not open'; end if;
  end if;
  -- A shift that already finished is history (its attendance stays): only shifts still to come or under way are cancelled.
  for sh in select * from cc_vol_shifts where activity_id = p_activity and status = 'open' and ends_at > now() and (p_shift is null or id = p_shift) order by starts_at for update loop
    update cc_vol_shifts set status = 'cancelled', version = version + 1, updated_at = now() where id = sh.id;
    insert into cc_vol_events (shift_id, kind, actor, detail) values (sh.id, 'shift_cancelled', p_actor, jsonb_build_object('reason', nullif(p_reason, '')));
    for s in
      update cc_vol_signups set status = 'cancelled', queued_at = null, cancelled_at = now(), cancel_reason = coalesce(nullif(p_reason, ''), 'shift cancelled'), version = version + 1, updated_at = now()
      where shift_id = sh.id and status in ('invited','confirmed','waitlisted') and attendance <> 'present'
      returning *
    loop
      insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor) values (s.id, sh.id, s.volunteer_id, 'cancelled_by_team', p_actor);
      return next s;
    end loop;
  end loop;
  if p_shift is not null and not exists (select 1 from cc_vol_shifts where id = p_shift and activity_id = p_activity) then
    raise exception 'cc_conflict: shift not found';
  end if;
end $$;

-- Record attendance. p_op: check_in | check_out | full_shift | absent | excused | correct | reset.
-- 'correct' needs a note and sets the times (and with them the minutes) explicitly.
create or replace function cc_vol_attendance(p_signup uuid, p_op text, p_in timestamptz, p_out timestamptz, p_note text, p_actor text, p_expect_version integer)
returns setof cc_vol_signups language plpgsql as $$
declare
  s cc_vol_signups;
  sh cc_vol_shifts;
  before jsonb;
  t timestamptz := now();
begin
  select * into s from cc_vol_signups where id = p_signup for update;
  if not found then raise exception 'cc_conflict: sign-up not found'; end if;
  if p_expect_version is not null and s.version <> p_expect_version then raise exception 'cc_conflict: someone else changed this attendance; reload'; end if;
  if s.status <> 'confirmed' then raise exception 'cc_conflict: only a confirmed volunteer can have attendance (this one is %)', s.status; end if;
  select * into sh from cc_vol_shifts where id = s.shift_id;
  if p_op in ('check_in','check_out','full_shift') and (t < sh.starts_at - interval '2 hours') then
    raise exception 'cc_conflict: the shift has not started yet';
  end if;
  before := jsonb_build_object('attendance', s.attendance, 'in', s.check_in_at, 'out', s.check_out_at, 'minutes', s.minutes);
  if p_op = 'check_in' then
    update cc_vol_signups set attendance = 'present', check_in_at = coalesce(p_in, t), check_out_at = null, minutes = null, attendance_method = 'coordinator' where id = s.id;
  elsif p_op = 'check_out' then
    if s.check_in_at is null then raise exception 'cc_conflict: check the volunteer in first'; end if;
    if coalesce(p_out, t) < s.check_in_at then raise exception 'cc_conflict: check-out is before check-in'; end if;
    update cc_vol_signups set check_out_at = coalesce(p_out, t),
      minutes = least(1440, round(extract(epoch from (coalesce(p_out, t) - s.check_in_at)) / 60)::integer), attendance_method = coalesce(attendance_method, 'coordinator') where id = s.id;
  elsif p_op = 'full_shift' then
    update cc_vol_signups set attendance = 'present', check_in_at = sh.starts_at, check_out_at = sh.ends_at,
      minutes = round(extract(epoch from (sh.ends_at - sh.starts_at)) / 60)::integer, attendance_method = 'full_shift' where id = s.id;
  elsif p_op in ('absent','excused') then
    update cc_vol_signups set attendance = p_op, check_in_at = null, check_out_at = null, minutes = null, attendance_method = 'coordinator' where id = s.id;
  elsif p_op = 'correct' then
    if coalesce(trim(p_note), '') = '' then raise exception 'cc_conflict: a correction needs a note saying why'; end if;
    if p_in is null or p_out is null or p_out < p_in then raise exception 'cc_conflict: give a check-in and a later check-out time'; end if;
    if p_out - p_in > interval '24 hours' then raise exception 'cc_conflict: more than 24 hours for one shift'; end if;
    update cc_vol_signups set attendance = 'present', check_in_at = p_in, check_out_at = p_out,
      minutes = round(extract(epoch from (p_out - p_in)) / 60)::integer, attendance_method = 'correction' where id = s.id;
  elsif p_op = 'reset' then
    update cc_vol_signups set attendance = 'unknown', check_in_at = null, check_out_at = null, minutes = null, attendance_method = null where id = s.id;
  else
    raise exception 'cc_conflict: unknown attendance operation %', p_op;
  end if;
  update cc_vol_signups set attendance_by = p_actor, attendance_note = coalesce(nullif(trim(p_note), ''), attendance_note), version = version + 1, updated_at = now()
  where id = s.id returning * into s;
  insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor, detail)
  values (s.id, s.shift_id, s.volunteer_id, 'attendance_' || p_op, p_actor,
          jsonb_build_object('before', before, 'after', jsonb_build_object('attendance', s.attendance, 'in', s.check_in_at, 'out', s.check_out_at, 'minutes', s.minutes), 'note', nullif(trim(p_note), '')));
  return next s;
end $$;

-- QR self check-in: the code printed on the shift's QR, scanned by a confirmed volunteer during the shift.
-- First scan checks in; a scan 15+ minutes later checks out.
create or replace function cc_vol_self_checkin(p_shift uuid, p_volunteer uuid, p_code text)
returns setof cc_vol_signups language plpgsql as $$
declare
  sh cc_vol_shifts;
  s cc_vol_signups;
  t timestamptz := now();
  op text;
begin
  select * into sh from cc_vol_shifts where id = p_shift;
  if not found or sh.checkin_code <> coalesce(p_code, '') then raise exception 'cc_conflict: this check-in code is not valid'; end if;
  if sh.status <> 'open' then raise exception 'cc_conflict: this shift was cancelled'; end if;
  if t < sh.starts_at - interval '1 hour' or t > sh.ends_at + interval '2 hours' then raise exception 'cc_conflict: check-in is open from an hour before the shift until two hours after it'; end if;
  select * into s from cc_vol_signups where shift_id = p_shift and volunteer_id = p_volunteer for update;
  if not found or s.status <> 'confirmed' then raise exception 'cc_conflict: you are not confirmed for this shift; ask the coordinator'; end if;
  if s.check_out_at is not null or s.attendance in ('absent','excused') then return next s; return; end if;
  if s.check_in_at is null then
    op := 'check_in';
    update cc_vol_signups set attendance = 'present', check_in_at = t, attendance_method = 'qr', attendance_by = 'volunteer:' || p_volunteer, version = version + 1, updated_at = now() where id = s.id returning * into s;
  elsif t - s.check_in_at >= interval '15 minutes' then
    op := 'check_out';
    update cc_vol_signups set check_out_at = t, minutes = least(1440, round(extract(epoch from (t - s.check_in_at)) / 60)::integer), attendance_by = 'volunteer:' || p_volunteer, version = version + 1, updated_at = now() where id = s.id returning * into s;
  else
    return next s; return;
  end if;
  insert into cc_vol_events (signup_id, shift_id, volunteer_id, kind, actor, detail) values (s.id, p_shift, p_volunteer, 'attendance_' || op, 'volunteer:' || p_volunteer, jsonb_build_object('method', 'qr'));
  return next s;
end $$;

-- Delete a volunteer's personal data (their own request, or staff). Keeps anonymous
-- attendance so project totals stay true; cancels every future sign-up (promoting
-- the waitlist); unlinks the CRM contact. Returns the anonymised row.
create or replace function cc_vol_forget(p_volunteer uuid, p_actor text)
returns setof cc_volunteers language plpgsql as $$
declare
  v cc_volunteers;
  s record;
  x cc_vol_signups;
begin
  select * into v from cc_volunteers where id = p_volunteer for update;
  if not found then raise exception 'cc_conflict: volunteer not found'; end if;
  for s in select su.id from cc_vol_signups su join cc_vol_shifts sh on sh.id = su.shift_id
           where su.volunteer_id = p_volunteer and su.status in ('invited','confirmed','waitlisted') and sh.starts_at > now() loop
    for x in select * from cc_vol_leave(s.id, 'cancelled', 'account deleted', p_actor, null) loop null; end loop;
  end loop;
  if v.contact_id is not null then
    update cc_contacts set roles = array_remove(roles, 'volunteer'), updated_at = now() where id = v.contact_id;
  end if;
  delete from cc_vol_notes where volunteer_id = p_volunteer;
  delete from cc_vol_outbox where volunteer_id = p_volunteer and status in ('pending','failed');
  update cc_volunteers set full_name = 'Deleted volunteer', email = null, phone = null, about = null, areas = '{}', availability = '{}', skills = '{}',
    contact_id = null, status = 'deleted', session_version = session_version + 1, notify_reminders = false, notify_opportunities = false, consent_whatsapp = false, updated_at = now()
  where id = p_volunteer returning * into v;
  insert into cc_vol_events (volunteer_id, kind, actor) values (p_volunteer, 'forgotten', p_actor);
  return next v;
end $$;

-- Claim due outbox rows for sending (a row stuck in 'sending' for 15+ minutes is claimed again).
create or replace function cc_vol_outbox_claim(p_limit integer)
returns setof cc_vol_outbox language plpgsql as $$
begin
  return query
  update cc_vol_outbox set status = 'sending', claimed_at = now(), attempts = attempts + 1
  where id in (
    select id from cc_vol_outbox
    where (status in ('pending','failed') and not_before <= now() and attempts < 5)
       or (status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts < 5)
    order by not_before limit p_limit for update skip locked)
  returning *;
end $$;

-- ── Lock it down ────────────────────────────────────────────────────────────
alter table cc_volunteers       enable row level security;
alter table cc_vol_notes        enable row level security;
alter table cc_vol_activities   enable row level security;
alter table cc_vol_shifts       enable row level security;
alter table cc_vol_signups      enable row level security;
alter table cc_vol_events       enable row level security;
alter table cc_vol_outbox       enable row level security;
alter table cc_vol_login_codes  enable row level security;
revoke all on cc_volunteers, cc_vol_notes, cc_vol_activities, cc_vol_shifts, cc_vol_signups, cc_vol_events, cc_vol_outbox, cc_vol_login_codes from anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'cc_vol_register(jsonb)', 'cc_vol__promote(uuid, text)', 'cc_vol_join(uuid, uuid, text, text)', 'cc_vol_invite(uuid, uuid, text)',
    'cc_vol_leave(uuid, text, text, text, uuid)', 'cc_vol_shift_save(uuid, uuid, integer, jsonb, text)', 'cc_vol_cancel(uuid, uuid, text, text)',
    'cc_vol_attendance(uuid, text, timestamptz, timestamptz, text, text, integer)', 'cc_vol_self_checkin(uuid, uuid, text)',
    'cc_vol_forget(uuid, text)', 'cc_vol_outbox_claim(integer)', 'cc_vol_events_append_only()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
