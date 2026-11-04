-- JAS Command Center — volunteer SCHEDULING: recurring weekly days at a location,
-- one-date absences and one-date assignments (replacements), run by a location's
-- scheduling administrator.
--
-- Phase 1 is one location (Sharon's Workshop, "הסדנה של שרון") open Monday,
-- Tuesday and Wednesday, scheduled by one person (Dafna). The model is already
-- location → slot (a recurring weekday of one activity there) → people, so a
-- second workshop, the store, or another activity is rows, not a redesign.
--
-- Rules, all enforced HERE rather than in either front end:
--
--   * Volunteers never schedule themselves. The only volunteer write is
--     "I will not come on <date>" (and taking that back), and only for a date
--     they are actually scheduled on.
--   * Every scheduling change (required count, regulars, one-date assignments,
--     closures, absences recorded by staff) is made by a scheduling admin of
--     THAT location: auth.uid() must map to an active cc_profiles row listed
--     in cc_vol_location_admins. The service role is NOT an admin: a bug in
--     the volunteer app (which holds the service key) cannot schedule anyone.
--   * The five schedule tables cannot be written directly by anyone — not even
--     the service role through PostgREST. A trigger refuses any write that does
--     not come from one of the functions below, which set a transaction-local
--     flag after checking who is calling.
--   * An absence affects one date only; the recurring assignment is untouched.
--   * Nobody is ever assigned automatically. A replacement is a one-date
--     assignment that only an admin creates.
--   * No duplicates: one live absence per (slot, volunteer, date), one live
--     assignment per (slot, volunteer, date), never an assignment for someone
--     who is already a regular that day, or is absent that day, or is scheduled
--     at another slot at the same time.
--
-- Reads: scheduling admins read their location's rows directly with RLS (and
-- get them in realtime through supabase_realtime); the volunteer app reads a
-- volunteer's own rows server-side with the service role.
--
-- Lock order: volunteer → slot (the same order as 0005's volunteer → shift).
-- Idempotent: safe to run twice. Requires 0001, 0003 and 0005.

-- ── New staff role: volunteer scheduler (lands on /schedule, nothing else) ──
alter table cc_user_roles drop constraint if exists cc_user_roles_role_check;
alter table cc_user_roles add constraint cc_user_roles_role_check
  check (role in ('owner','admin','operations_manager','project_manager','volunteer_coordinator','scheduler','seller','viewer'));
alter table cc_role_permissions drop constraint if exists cc_role_permissions_role_check;
alter table cc_role_permissions add constraint cc_role_permissions_role_check
  check (role in ('owner','admin','operations_manager','project_manager','volunteer_coordinator','scheduler','seller','viewer'));

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists cc_vol_locations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9_]+$'),
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Who schedules which location. Written by the Command Center (owner, service role) only.
create table if not exists cc_vol_location_admins (
  location_id  uuid not null references cc_vol_locations(id) on delete cascade,
  profile_id   uuid not null references cc_profiles(id) on delete cascade,
  granted_by   text not null,
  granted_at   timestamptz not null default now(),
  primary key (location_id, profile_id)
);

-- One recurring operating day of one activity at a location ("Sharon's Workshop, Tuesday").
create table if not exists cc_vol_slots (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references cc_vol_locations(id) on delete cascade,
  activity     text not null default 'workshop' check (activity ~ '^[a-z0-9_]+$'),
  weekday      smallint not null check (weekday between 0 and 6),   -- 0 = Sunday … 6 = Saturday
  starts_at    time,                                                -- Israel wall clock; NULL = not set
  ends_at      time,
  required     integer check (required is null or required between 0 and 200),  -- NULL = not set yet (never shown as 0)
  active       boolean not null default true,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (location_id, activity, weekday),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- A volunteer's recurring assignment to a slot, for a period. Ending it keeps the history.
create table if not exists cc_vol_regulars (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references cc_vol_slots(id) on delete cascade,
  volunteer_id  uuid not null references cc_volunteers(id) on delete cascade,
  starts_on     date not null,
  ends_on       date,                 -- the LAST date included; NULL = until changed
  created_by    text not null,
  created_at    timestamptz not null default now(),
  ended_by      text,
  ended_at      timestamptz,
  check (ends_on is null or ends_on >= starts_on)
);
create unique index if not exists cc_vol_regulars_open on cc_vol_regulars (slot_id, volunteer_id) where ends_on is null;
create index if not exists cc_vol_regulars_volunteer on cc_vol_regulars (volunteer_id);
create index if not exists cc_vol_regulars_slot on cc_vol_regulars (slot_id, starts_on);

-- "I will not come on this date." One date; the recurring assignment is untouched.
create table if not exists cc_vol_absences (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references cc_vol_slots(id) on delete cascade,
  volunteer_id  uuid not null references cc_volunteers(id) on delete cascade,
  on_date       date not null,
  source        text not null check (source in ('volunteer','admin')),
  reason        text,
  reported_by   text not null,        -- volunteer:<id> or the admin's email
  created_at    timestamptz not null default now(),
  withdrawn_at  timestamptz,
  withdrawn_by  text
);
create unique index if not exists cc_vol_absences_live on cc_vol_absences (slot_id, volunteer_id, on_date) where withdrawn_at is null;
create index if not exists cc_vol_absences_date on cc_vol_absences (slot_id, on_date);
create index if not exists cc_vol_absences_volunteer on cc_vol_absences (volunteer_id, on_date);

-- One-date assignments: replacements and extra hands. Only an admin creates them.
-- 'tentative' = asked, not yet confirmed: shown apart and NOT counted as coming.
create table if not exists cc_vol_assignments (
  id                     uuid primary key default gen_random_uuid(),
  slot_id                uuid not null references cc_vol_slots(id) on delete cascade,
  volunteer_id           uuid not null references cc_volunteers(id) on delete cascade,
  on_date                date not null,
  status                 text not null check (status in ('confirmed','tentative')),
  replaces_volunteer_id  uuid references cc_volunteers(id) on delete set null,
  note                   text,
  created_by             text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  cancelled_at           timestamptz,
  cancelled_by           text,
  cancel_reason          text
);
create unique index if not exists cc_vol_assignments_live on cc_vol_assignments (slot_id, volunteer_id, on_date) where cancelled_at is null;
create index if not exists cc_vol_assignments_date on cc_vol_assignments (slot_id, on_date);
create index if not exists cc_vol_assignments_volunteer on cc_vol_assignments (volunteer_id, on_date);

-- The location is closed that date (a holiday): nobody is expected, nothing is missing.
create table if not exists cc_vol_closures (
  slot_id     uuid not null references cc_vol_slots(id) on delete cascade,
  on_date     date not null,
  reason      text,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  primary key (slot_id, on_date)
);

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- The role in the request's JWT ('authenticated', 'service_role', 'anon'), or '' outside PostgREST.
create or replace function cc_vol__jwt_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '')
$$;

-- The signed-in Supabase Auth user (PostgREST and Realtime both set it), or NULL.
create or replace function cc_vol__uid() returns uuid language sql stable as $$
  select auth.uid()
$$;

-- Is the signed-in person a scheduling admin of this location? (RLS policies use it.)
create or replace function cc_vol_is_location_admin(p_location uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
    where a.location_id = p_location and p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid())
$$;

create or replace function cc_vol_is_any_location_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
    where p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid())
$$;

create or replace function cc_vol__slot_admin(p_slot uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_vol_slots s where s.id = p_slot and cc_vol_is_location_admin(s.location_id))
$$;

-- Only the scheduling functions may write the schedule tables.
create or replace function cc_vol__sched_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('cc.vol_sched', true), '') <> 'on' then
    raise exception 'cc_forbidden: schedule changes go through the scheduling functions';
  end if;
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['cc_vol_slots','cc_vol_regulars','cc_vol_absences','cc_vol_assignments','cc_vol_closures'] loop
    execute format('drop trigger if exists %I on %I', t || '_guard', t);
    execute format('create trigger %I before insert or update or delete on %I for each row execute function cc_vol__sched_guard()', t || '_guard', t);
  end loop;
end $$;

-- The calling admin's email for this location, or a refusal. Opens the write guard.
create or replace function cc_vol__admin(p_location uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  select p.email into e from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
  where a.location_id = p_location and p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid();
  if e is null then raise exception 'cc_forbidden: only this location''s scheduling administrator can change its schedule'; end if;
  perform set_config('cc.vol_sched', 'on', true);
  return e;
end $$;

-- Volunteer-side writes come from the volunteer app's server (service role), which has signed the volunteer in.
create or replace function cc_vol__volunteer_caller() returns void
language plpgsql security definer set search_path = public as $$
begin
  if cc_vol__jwt_role() <> 'service_role' then raise exception 'cc_forbidden: volunteers report absences through the volunteer app'; end if;
  perform set_config('cc.vol_sched', 'on', true);
end $$;

create or replace function cc_vol__today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Jerusalem')::date
$$;

-- The slot, locked, checked to be open on that date.
create or replace function cc_vol__slot_on(p_slot uuid, p_date date) returns cc_vol_slots
language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots;
begin
  select * into s from cc_vol_slots where id = p_slot for update;
  if not found then raise exception 'cc_conflict: that day of the schedule does not exist'; end if;
  if not s.active or not exists (select 1 from cc_vol_locations l where l.id = s.location_id and l.active) then
    raise exception 'cc_conflict: that day is not part of the schedule any more';
  end if;
  if p_date is not null and extract(dow from p_date)::int <> s.weekday then
    raise exception 'cc_conflict: % is not a % of this schedule', p_date, (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[s.weekday + 1];
  end if;
  return s;
end $$;

-- How a volunteer is on a slot that date: 'regular', 'assigned' (one-date) or NULL. Absences aside.
create or replace function cc_vol__scheduled(p_slot uuid, p_volunteer uuid, p_date date) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from cc_vol_regulars r where r.slot_id = p_slot and r.volunteer_id = p_volunteer
                 and r.starts_on <= p_date and (r.ends_on is null or r.ends_on >= p_date)) then 'regular'
    when exists (select 1 from cc_vol_assignments a where a.slot_id = p_slot and a.volunteer_id = p_volunteer
                 and a.on_date = p_date and a.cancelled_at is null) then 'assigned'
  end
$$;

create or replace function cc_vol__absent(p_slot uuid, p_volunteer uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_vol_absences a where a.slot_id = p_slot and a.volunteer_id = p_volunteer and a.on_date = p_date and a.withdrawn_at is null)
$$;

create or replace function cc_vol__active_volunteer(p_volunteer uuid) returns cc_volunteers
language plpgsql security definer set search_path = public as $$
declare v cc_volunteers;
begin
  select * into v from cc_volunteers where id = p_volunteer for update;
  if not found then raise exception 'cc_conflict: volunteer not found'; end if;
  if v.status <> 'active' then raise exception 'cc_conflict: this volunteer''s account is not active'; end if;
  return v;
end $$;

create or replace function cc_vol__event(p_volunteer uuid, p_kind text, p_actor text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into cc_vol_events (volunteer_id, kind, actor, detail) values (p_volunteer, p_kind, p_actor, p_detail)
$$;

-- ── Admin: the slot itself (required count, hours) ──────────────────────────
create or replace function cc_vol_sched_update_slot(p_slot uuid, p_expect_version integer, p jsonb)
returns setof cc_vol_slots language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; actor text;
begin
  s := cc_vol__slot_on(p_slot, null);
  actor := cc_vol__admin(s.location_id);
  if p_expect_version is not null and s.version <> p_expect_version then
    raise exception 'cc_conflict: someone changed this day in the meantime; reload and try again';
  end if;
  return query
  update cc_vol_slots set
    required  = case when p ? 'required' then nullif(p->>'required', '')::integer else required end,
    starts_at = case when p ? 'starts_at' then nullif(p->>'starts_at', '')::time else starts_at end,
    ends_at   = case when p ? 'ends_at' then nullif(p->>'ends_at', '')::time else ends_at end,
    version = version + 1, updated_at = now()
  where id = p_slot returning *;
  perform cc_vol__event(null, 'schedule.slot_updated', actor, jsonb_build_object('slot', p_slot, 'change', p));
end $$;

-- ── Admin: recurring regulars ───────────────────────────────────────────────
create or replace function cc_vol_sched_add_regular(p_slot uuid, p_volunteer uuid, p_from date)
returns setof cc_vol_regulars language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; actor text; r cc_vol_regulars; other text;
begin
  perform cc_vol__active_volunteer(p_volunteer);
  s := cc_vol__slot_on(p_slot, null);
  actor := cc_vol__admin(s.location_id);
  if p_from is null or p_from < cc_vol__today() then raise exception 'cc_conflict: a regular day starts today or later'; end if;
  if exists (select 1 from cc_vol_regulars where slot_id = p_slot and volunteer_id = p_volunteer and (ends_on is null or ends_on >= p_from)) then
    raise exception 'cc_conflict: this volunteer is already a regular on this day';
  end if;
  -- Another slot on the same weekday at an overlapping time (a second activity, later): one place at a time.
  select l.name into other from cc_vol_regulars r2 join cc_vol_slots s2 on s2.id = r2.slot_id join cc_vol_locations l on l.id = s2.location_id
  where r2.volunteer_id = p_volunteer and s2.id <> p_slot and s2.weekday = s.weekday and s2.active
    and (r2.ends_on is null or r2.ends_on >= p_from)
    and (s.starts_at is null or s.ends_at is null or s2.starts_at is null or s2.ends_at is null or (s2.starts_at < s.ends_at and s.starts_at < s2.ends_at))
  limit 1;
  if other is not null then raise exception 'cc_conflict: this volunteer is already a regular at % on that weekday', other; end if;
  insert into cc_vol_regulars (slot_id, volunteer_id, starts_on, created_by) values (p_slot, p_volunteer, p_from, actor) returning * into r;
  -- One-date assignments the new regular day now covers would count them twice.
  update cc_vol_assignments set cancelled_at = now(), cancelled_by = actor, cancel_reason = 'now a regular on this day', updated_at = now()
  where slot_id = p_slot and volunteer_id = p_volunteer and on_date >= p_from and cancelled_at is null;
  perform cc_vol__event(p_volunteer, 'schedule.regular_added', actor, jsonb_build_object('slot', p_slot, 'from', p_from));
  return next r;
end $$;

-- End a regular day. p_last = the last date they come; before it started = it never happened.
create or replace function cc_vol_sched_end_regular(p_regular uuid, p_last date)
returns setof cc_vol_regulars language plpgsql security definer set search_path = public as $$
declare r cc_vol_regulars; s cc_vol_slots; actor text;
begin
  select * into r from cc_vol_regulars where id = p_regular;
  if not found then raise exception 'cc_conflict: that regular day was not found'; end if;
  perform 1 from cc_volunteers where id = r.volunteer_id for update;
  s := cc_vol__slot_on(r.slot_id, null);
  actor := cc_vol__admin(s.location_id);
  select * into r from cc_vol_regulars where id = p_regular for update;
  if p_last is null or p_last < cc_vol__today() - 1 then raise exception 'cc_conflict: the last day can be yesterday at the earliest; past weeks are history'; end if;
  if r.ends_on is not null and r.ends_on <= p_last then return next r; return; end if;
  if p_last < r.starts_on then
    delete from cc_vol_regulars where id = p_regular;
    r.ends_on := null;
  else
    update cc_vol_regulars set ends_on = p_last, ended_by = actor, ended_at = now() where id = p_regular returning * into r;
  end if;
  update cc_vol_absences set withdrawn_at = now(), withdrawn_by = actor
  where slot_id = r.slot_id and volunteer_id = r.volunteer_id and on_date > p_last and withdrawn_at is null
    and not exists (select 1 from cc_vol_assignments a where a.slot_id = r.slot_id and a.volunteer_id = r.volunteer_id and a.on_date = cc_vol_absences.on_date and a.cancelled_at is null);
  perform cc_vol__event(r.volunteer_id, 'schedule.regular_ended', actor, jsonb_build_object('slot', r.slot_id, 'last', p_last));
  return next r;
end $$;

-- ── Absences (the volunteer's one action; also recorded by the admin) ───────
create or replace function cc_vol_sched_absence(p_slot uuid, p_volunteer uuid, p_date date, p_reason text, p_source text)
returns setof cc_vol_absences language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; actor text; a cc_vol_absences;
begin
  if p_source not in ('volunteer','admin') then raise exception 'cc_conflict: unknown source'; end if;
  perform 1 from cc_volunteers where id = p_volunteer for update;
  if not found then raise exception 'cc_conflict: volunteer not found'; end if;
  s := cc_vol__slot_on(p_slot, p_date);
  if p_source = 'volunteer' then
    perform cc_vol__volunteer_caller();
    actor := 'volunteer:' || p_volunteer;
    if p_date < cc_vol__today() then raise exception 'cc_conflict: that day has passed'; end if;
  else
    actor := cc_vol__admin(s.location_id);
  end if;
  if exists (select 1 from cc_vol_closures where slot_id = p_slot and on_date = p_date) then
    raise exception 'cc_conflict: the workshop is closed that day, so nobody is expected';
  end if;
  if cc_vol__scheduled(p_slot, p_volunteer, p_date) is null then
    raise exception 'cc_conflict: this volunteer is not scheduled on that day';
  end if;
  select * into a from cc_vol_absences where slot_id = p_slot and volunteer_id = p_volunteer and on_date = p_date and withdrawn_at is null;
  if found then return next a; return; end if;   -- reported twice = reported once
  insert into cc_vol_absences (slot_id, volunteer_id, on_date, source, reason, reported_by)
  values (p_slot, p_volunteer, p_date, p_source, nullif(left(trim(coalesce(p_reason, '')), 300), ''), actor) returning * into a;
  perform cc_vol__event(p_volunteer, 'schedule.absence', actor, jsonb_build_object('slot', p_slot, 'date', p_date, 'source', p_source));
  return next a;
end $$;

-- Take an absence back. A volunteer only their own and only before the day; an admin any.
create or replace function cc_vol_sched_withdraw_absence(p_absence uuid, p_source text, p_volunteer uuid)
returns setof cc_vol_absences language plpgsql security definer set search_path = public as $$
declare a cc_vol_absences; s cc_vol_slots; actor text;
begin
  select * into a from cc_vol_absences where id = p_absence;
  if not found then raise exception 'cc_conflict: that absence was not found'; end if;
  perform 1 from cc_volunteers where id = a.volunteer_id for update;
  s := cc_vol__slot_on(a.slot_id, null);
  if p_source = 'volunteer' then
    perform cc_vol__volunteer_caller();
    if p_volunteer is distinct from a.volunteer_id then raise exception 'cc_conflict: that absence was not found'; end if;
    if a.on_date < cc_vol__today() then raise exception 'cc_conflict: that day has passed'; end if;
    actor := 'volunteer:' || p_volunteer;
  elsif p_source = 'admin' then
    actor := cc_vol__admin(s.location_id);
  else
    raise exception 'cc_conflict: unknown source';
  end if;
  select * into a from cc_vol_absences where id = p_absence for update;
  if a.withdrawn_at is not null then return next a; return; end if;
  update cc_vol_absences set withdrawn_at = now(), withdrawn_by = actor where id = p_absence returning * into a;
  perform cc_vol__event(a.volunteer_id, 'schedule.absence_withdrawn', actor, jsonb_build_object('slot', a.slot_id, 'date', a.on_date, 'source', p_source));
  return next a;
end $$;

-- ── Admin: one-date assignments (replacements) ──────────────────────────────
create or replace function cc_vol__assign(p_slot uuid, p_volunteer uuid, p_date date, p_status text, p_replaces uuid, p_note text, actor text)
returns cc_vol_assignments language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; a cc_vol_assignments; other text;
begin
  select * into s from cc_vol_slots where id = p_slot;
  if p_status not in ('confirmed','tentative') then raise exception 'cc_conflict: unknown status'; end if;
  if p_date < cc_vol__today() then raise exception 'cc_conflict: that day has passed'; end if;
  if exists (select 1 from cc_vol_closures where slot_id = p_slot and on_date = p_date) then
    raise exception 'cc_conflict: the workshop is closed that day';
  end if;
  if cc_vol__absent(p_slot, p_volunteer, p_date) then
    raise exception 'cc_conflict: this volunteer reported they will not come that day; take the absence back instead';
  end if;
  if cc_vol__scheduled(p_slot, p_volunteer, p_date) = 'regular' then
    raise exception 'cc_conflict: this volunteer already comes that day as a regular';
  end if;
  select * into a from cc_vol_assignments where slot_id = p_slot and volunteer_id = p_volunteer and on_date = p_date and cancelled_at is null;
  if found then
    if a.status <> p_status then
      update cc_vol_assignments set status = p_status, updated_at = now() where id = a.id returning * into a;
    end if;
    return a;   -- assigned twice = assigned once
  end if;
  -- Somewhere else at the same time that day (a second activity, later).
  select l.name into other from cc_vol_slots s2 join cc_vol_locations l on l.id = s2.location_id
  where s2.id <> p_slot and s2.weekday = s.weekday and s2.active
    and (s.starts_at is null or s.ends_at is null or s2.starts_at is null or s2.ends_at is null or (s2.starts_at < s.ends_at and s.starts_at < s2.ends_at))
    and cc_vol__scheduled(s2.id, p_volunteer, p_date) is not null and not cc_vol__absent(s2.id, p_volunteer, p_date)
  limit 1;
  if other is not null then raise exception 'cc_conflict: this volunteer is already scheduled at % at that time', other; end if;
  if p_replaces is not null and (p_replaces = p_volunteer or cc_vol__scheduled(p_slot, p_replaces, p_date) is null) then
    raise exception 'cc_conflict: the person being replaced is not scheduled that day';
  end if;
  insert into cc_vol_assignments (slot_id, volunteer_id, on_date, status, replaces_volunteer_id, note, created_by)
  values (p_slot, p_volunteer, p_date, p_status, p_replaces, nullif(left(trim(coalesce(p_note, '')), 300), ''), actor) returning * into a;
  perform cc_vol__event(p_volunteer, 'schedule.assigned', actor, jsonb_build_object('slot', p_slot, 'date', p_date, 'status', p_status, 'replaces', p_replaces));
  return a;
end $$;

create or replace function cc_vol_sched_assign(p_slot uuid, p_volunteer uuid, p_date date, p_status text, p_replaces uuid, p_note text)
returns setof cc_vol_assignments language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; actor text;
begin
  perform cc_vol__active_volunteer(p_volunteer);
  s := cc_vol__slot_on(p_slot, p_date);
  actor := cc_vol__admin(s.location_id);
  return next cc_vol__assign(p_slot, p_volunteer, p_date, p_status, p_replaces, p_note, actor);
end $$;

-- "Schedule Ruti instead of Yossi": record Yossi's absence (if not already) and assign Ruti, in one transaction.
create or replace function cc_vol_sched_replace(p_slot uuid, p_date date, p_out uuid, p_in uuid, p_status text, p_reason text)
returns setof cc_vol_assignments language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; actor text;
begin
  if p_out = p_in then raise exception 'cc_conflict: a volunteer cannot replace themselves'; end if;
  -- Volunteer locks in id order: two replaces touching the same pair cannot deadlock.
  perform 1 from cc_volunteers where id in (p_out, p_in) order by id for update;
  perform cc_vol__active_volunteer(p_in);
  s := cc_vol__slot_on(p_slot, p_date);
  actor := cc_vol__admin(s.location_id);
  if cc_vol__scheduled(p_slot, p_out, p_date) is null then raise exception 'cc_conflict: the person being replaced is not scheduled that day'; end if;
  if not cc_vol__absent(p_slot, p_out, p_date) then
    if p_date < cc_vol__today() then raise exception 'cc_conflict: that day has passed'; end if;
    insert into cc_vol_absences (slot_id, volunteer_id, on_date, source, reason, reported_by)
    values (p_slot, p_out, p_date, 'admin', nullif(left(trim(coalesce(p_reason, '')), 300), ''), actor);
    perform cc_vol__event(p_out, 'schedule.absence', actor, jsonb_build_object('slot', p_slot, 'date', p_date, 'source', 'admin'));
  end if;
  return next cc_vol__assign(p_slot, p_in, p_date, p_status, p_out, null, actor);
end $$;

create or replace function cc_vol_sched_assignment_status(p_assignment uuid, p_status text)
returns setof cc_vol_assignments language plpgsql security definer set search_path = public as $$
declare a cc_vol_assignments; s cc_vol_slots; actor text;
begin
  if p_status not in ('confirmed','tentative') then raise exception 'cc_conflict: unknown status'; end if;
  select * into a from cc_vol_assignments where id = p_assignment;
  if not found then raise exception 'cc_conflict: that assignment was not found'; end if;
  perform 1 from cc_volunteers where id = a.volunteer_id for update;
  s := cc_vol__slot_on(a.slot_id, null);
  actor := cc_vol__admin(s.location_id);
  select * into a from cc_vol_assignments where id = p_assignment for update;
  if a.cancelled_at is not null then raise exception 'cc_conflict: that assignment was cancelled'; end if;
  if a.status = p_status then return next a; return; end if;
  update cc_vol_assignments set status = p_status, updated_at = now() where id = p_assignment returning * into a;
  perform cc_vol__event(a.volunteer_id, 'schedule.assignment_' || p_status, actor, jsonb_build_object('slot', a.slot_id, 'date', a.on_date));
  return next a;
end $$;

create or replace function cc_vol_sched_cancel_assignment(p_assignment uuid, p_reason text)
returns setof cc_vol_assignments language plpgsql security definer set search_path = public as $$
declare a cc_vol_assignments; s cc_vol_slots; actor text;
begin
  select * into a from cc_vol_assignments where id = p_assignment;
  if not found then raise exception 'cc_conflict: that assignment was not found'; end if;
  perform 1 from cc_volunteers where id = a.volunteer_id for update;
  s := cc_vol__slot_on(a.slot_id, null);
  actor := cc_vol__admin(s.location_id);
  select * into a from cc_vol_assignments where id = p_assignment for update;
  if a.cancelled_at is not null then return next a; return; end if;
  update cc_vol_assignments set cancelled_at = now(), cancelled_by = actor, cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 300), ''), updated_at = now()
  where id = p_assignment returning * into a;
  -- An absence that belonged only to this assignment has nothing left to describe.
  update cc_vol_absences set withdrawn_at = now(), withdrawn_by = actor
  where slot_id = a.slot_id and volunteer_id = a.volunteer_id and on_date = a.on_date and withdrawn_at is null
    and cc_vol__scheduled(a.slot_id, a.volunteer_id, a.on_date) is null;
  perform cc_vol__event(a.volunteer_id, 'schedule.assignment_cancelled', actor, jsonb_build_object('slot', a.slot_id, 'date', a.on_date));
  return next a;
end $$;

-- ── Admin: closed days ──────────────────────────────────────────────────────
create or replace function cc_vol_sched_closure(p_slot uuid, p_date date, p_closed boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare s cc_vol_slots; actor text;
begin
  s := cc_vol__slot_on(p_slot, p_date);
  actor := cc_vol__admin(s.location_id);
  if p_date < cc_vol__today() then raise exception 'cc_conflict: that day has passed'; end if;
  if p_closed then
    insert into cc_vol_closures (slot_id, on_date, reason, created_by) values (p_slot, p_date, nullif(left(trim(coalesce(p_reason, '')), 200), ''), actor)
    on conflict (slot_id, on_date) do update set reason = excluded.reason;
  else
    delete from cc_vol_closures where slot_id = p_slot and on_date = p_date;
  end if;
  perform cc_vol__event(null, case when p_closed then 'schedule.closed' else 'schedule.reopened' end, actor, jsonb_build_object('slot', p_slot, 'date', p_date));
  return p_closed;
end $$;

-- ── Phase 1 data: Sharon's Workshop, Monday–Wednesday (required set by Dafna) ──
do $$
declare loc uuid;
begin
  perform set_config('cc.vol_sched', 'on', true);
  insert into cc_vol_locations (slug, name) values ('sharon_workshop', 'הסדנה של שרון') on conflict (slug) do nothing;
  select id into loc from cc_vol_locations where slug = 'sharon_workshop';
  insert into cc_vol_slots (location_id, activity, weekday) values (loc, 'workshop', 1), (loc, 'workshop', 2), (loc, 'workshop', 3)
  on conflict (location_id, activity, weekday) do nothing;
end $$;

-- ── Access: RLS for admins' reads, functions for every write ────────────────
alter table cc_vol_locations        enable row level security;
alter table cc_vol_location_admins  enable row level security;
alter table cc_vol_slots            enable row level security;
alter table cc_vol_regulars         enable row level security;
alter table cc_vol_absences         enable row level security;
alter table cc_vol_assignments      enable row level security;
alter table cc_vol_closures         enable row level security;
revoke all on cc_vol_locations, cc_vol_location_admins, cc_vol_slots, cc_vol_regulars, cc_vol_absences, cc_vol_assignments, cc_vol_closures from anon, authenticated;
grant select on cc_vol_locations, cc_vol_location_admins, cc_vol_slots, cc_vol_regulars, cc_vol_absences, cc_vol_assignments, cc_vol_closures to authenticated;
grant all on cc_vol_locations, cc_vol_location_admins, cc_vol_slots, cc_vol_regulars, cc_vol_absences, cc_vol_assignments, cc_vol_closures to service_role;

drop policy if exists cc_vol_locations_admin_read on cc_vol_locations;
create policy cc_vol_locations_admin_read on cc_vol_locations for select to authenticated using (cc_vol_is_location_admin(id));
drop policy if exists cc_vol_location_admins_own on cc_vol_location_admins;
create policy cc_vol_location_admins_own on cc_vol_location_admins for select to authenticated using (cc_vol_is_location_admin(location_id));
drop policy if exists cc_vol_slots_admin_read on cc_vol_slots;
create policy cc_vol_slots_admin_read on cc_vol_slots for select to authenticated using (cc_vol_is_location_admin(location_id));
drop policy if exists cc_vol_regulars_admin_read on cc_vol_regulars;
create policy cc_vol_regulars_admin_read on cc_vol_regulars for select to authenticated using (cc_vol__slot_admin(slot_id));
drop policy if exists cc_vol_absences_admin_read on cc_vol_absences;
create policy cc_vol_absences_admin_read on cc_vol_absences for select to authenticated using (cc_vol__slot_admin(slot_id));
drop policy if exists cc_vol_assignments_admin_read on cc_vol_assignments;
create policy cc_vol_assignments_admin_read on cc_vol_assignments for select to authenticated using (cc_vol__slot_admin(slot_id));
drop policy if exists cc_vol_closures_admin_read on cc_vol_closures;
create policy cc_vol_closures_admin_read on cc_vol_closures for select to authenticated using (cc_vol__slot_admin(slot_id));

-- A scheduling admin sees every volunteer's name, phone (to call a replacement), declared
-- availability and status — and no other column (no email, notes, consents).
revoke all on cc_volunteers from authenticated;
grant select (id, full_name, phone, availability, status) on cc_volunteers to authenticated;
drop policy if exists cc_volunteers_scheduler_read on cc_volunteers;
create policy cc_volunteers_scheduler_read on cc_volunteers for select to authenticated using (cc_vol_is_any_location_admin());

do $$
declare f text;
begin
  -- Policy helpers: callable by the signed-in role (they only answer about the caller).
  foreach f in array array['cc_vol_is_location_admin(uuid)', 'cc_vol_is_any_location_admin()', 'cc_vol__slot_admin(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Internal pieces: never called directly over PostgREST.
  foreach f in array array['cc_vol__admin(uuid)', 'cc_vol__volunteer_caller()', 'cc_vol__slot_on(uuid, date)', 'cc_vol__scheduled(uuid, uuid, date)',
    'cc_vol__absent(uuid, uuid, date)', 'cc_vol__active_volunteer(uuid)', 'cc_vol__event(uuid, text, text, jsonb)',
    'cc_vol__assign(uuid, uuid, date, text, uuid, text, text)', 'cc_vol__sched_guard()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- The scheduling API. Each function checks WHO is calling (admin of the location, or the volunteer app).
  foreach f in array array['cc_vol_sched_update_slot(uuid, integer, jsonb)', 'cc_vol_sched_add_regular(uuid, uuid, date)', 'cc_vol_sched_end_regular(uuid, date)',
    'cc_vol_sched_absence(uuid, uuid, date, text, text)', 'cc_vol_sched_withdraw_absence(uuid, text, uuid)',
    'cc_vol_sched_assign(uuid, uuid, date, text, uuid, text)', 'cc_vol_sched_replace(uuid, date, uuid, uuid, text, text)',
    'cc_vol_sched_assignment_status(uuid, text)', 'cc_vol_sched_cancel_assignment(uuid, text)', 'cc_vol_sched_closure(uuid, date, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Realtime: the admin's weekly overview listens to these (RLS decides what each listener receives).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cc_vol_slots','cc_vol_regulars','cc_vol_absences','cc_vol_assignments','cc_vol_closures'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
