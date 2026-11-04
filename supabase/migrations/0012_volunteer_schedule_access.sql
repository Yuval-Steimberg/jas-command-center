-- 0012 — Volunteer scheduling, part 2: who may SEE a location, reminders, reservists.
--
-- Builds on 0011. Idempotent; run it once in the Command Center's Supabase SQL editor.
--
--   * cc_vol_location_admins.access: 'schedule' (changes the schedule, e.g. Dafna)
--     or 'view' (sees it, changes nothing, e.g. Sharon, Gil, Liat for their place).
--     Every write function goes on asking cc_vol__admin(), which now accepts
--     only 'schedule'. Reads (RLS) accept either.
--   * cc_vol_reminders: the history of "please tell us if you can't come" sends.
--     Written only by cc_vol_sched_log_reminder, which a SCHEDULER of the location
--     must call; the Command Center queues the emails only after it succeeded.
--   * cc_volunteers.reservist: a flag shown next to the name. Nothing else reads it.

alter table cc_vol_location_admins add column if not exists access text not null default 'schedule';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cc_vol_location_admins_access_check') then
    alter table cc_vol_location_admins add constraint cc_vol_location_admins_access_check check (access in ('schedule', 'view'));
  end if;
end $$;

alter table cc_volunteers add column if not exists reservist boolean not null default false;

create table if not exists cc_vol_reminders (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references cc_vol_locations(id) on delete cascade,
  week_start  date not null,           -- the Sunday of the week the reminder is about
  channel     text not null check (channel in ('email', 'whatsapp')),
  recipients  integer not null default 0 check (recipients >= 0),
  sent_by     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists cc_vol_reminders_loc on cc_vol_reminders (location_id, week_start desc, created_at desc);

-- ── Access helpers ──────────────────────────────────────────────────────────

-- May the signed-in person CHANGE this location's schedule? (Unchanged name, narrower meaning.)
create or replace function cc_vol_is_location_admin(p_location uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
    where a.location_id = p_location and a.access = 'schedule' and p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid())
$$;

-- May the signed-in person SEE this location's schedule (scheduler or viewer)?
create or replace function cc_vol_can_view_location(p_location uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
    where a.location_id = p_location and p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid())
$$;

create or replace function cc_vol__slot_viewer(p_slot uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_vol_slots s where s.id = p_slot and cc_vol_can_view_location(s.location_id))
$$;

-- Anyone listed on any location (either access) sees volunteers' names and phones.
create or replace function cc_vol_is_any_location_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
    where p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid())
$$;

-- The caller's own access per location (the app shows or hides the buttons; the database still decides).
create or replace function cc_vol_my_access() returns table (location_id uuid, access text)
language sql stable security definer set search_path = public as $$
  select a.location_id, a.access from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
  where p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid()
$$;

-- The calling SCHEDULER's email for this location, or a refusal. Opens the write guard.
create or replace function cc_vol__admin(p_location uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  select p.email into e from cc_vol_location_admins a join cc_profiles p on p.id = a.profile_id
  where a.location_id = p_location and a.access = 'schedule' and p.is_active and p.auth_user_id is not null and p.auth_user_id = cc_vol__uid();
  if e is null then raise exception 'cc_forbidden: only this location''s scheduling administrator can change its schedule'; end if;
  perform set_config('cc.vol_sched', 'on', true);
  return e;
end $$;

-- ── Reminder history ────────────────────────────────────────────────────────

create or replace function cc_vol_sched_log_reminder(p_location uuid, p_week date, p_channel text, p_recipients integer)
returns cc_vol_reminders language plpgsql security definer set search_path = public as $$
declare who text; r cc_vol_reminders;
begin
  who := cc_vol__admin(p_location);
  if p_week is null or extract(dow from p_week) <> 0 then raise exception 'cc_conflict: a reminder is about a week starting on Sunday'; end if;
  if p_channel not in ('email', 'whatsapp') then raise exception 'cc_conflict: unknown channel'; end if;
  insert into cc_vol_reminders (location_id, week_start, channel, recipients, sent_by)
  values (p_location, p_week, p_channel, greatest(coalesce(p_recipients, 0), 0), who) returning * into r;
  return r;
end $$;

-- ── Reads: schedulers AND viewers ───────────────────────────────────────────
alter table cc_vol_reminders enable row level security;
revoke all on cc_vol_reminders from anon, authenticated;
grant select on cc_vol_reminders to authenticated;
grant all on cc_vol_reminders to service_role;

drop policy if exists cc_vol_locations_admin_read on cc_vol_locations;
create policy cc_vol_locations_admin_read on cc_vol_locations for select to authenticated using (cc_vol_can_view_location(id));
drop policy if exists cc_vol_location_admins_own on cc_vol_location_admins;
create policy cc_vol_location_admins_own on cc_vol_location_admins for select to authenticated using (cc_vol_can_view_location(location_id));
drop policy if exists cc_vol_slots_admin_read on cc_vol_slots;
create policy cc_vol_slots_admin_read on cc_vol_slots for select to authenticated using (cc_vol_can_view_location(location_id));
drop policy if exists cc_vol_regulars_admin_read on cc_vol_regulars;
create policy cc_vol_regulars_admin_read on cc_vol_regulars for select to authenticated using (cc_vol__slot_viewer(slot_id));
drop policy if exists cc_vol_absences_admin_read on cc_vol_absences;
create policy cc_vol_absences_admin_read on cc_vol_absences for select to authenticated using (cc_vol__slot_viewer(slot_id));
drop policy if exists cc_vol_assignments_admin_read on cc_vol_assignments;
create policy cc_vol_assignments_admin_read on cc_vol_assignments for select to authenticated using (cc_vol__slot_viewer(slot_id));
drop policy if exists cc_vol_closures_admin_read on cc_vol_closures;
create policy cc_vol_closures_admin_read on cc_vol_closures for select to authenticated using (cc_vol__slot_viewer(slot_id));
drop policy if exists cc_vol_reminders_read on cc_vol_reminders;
create policy cc_vol_reminders_read on cc_vol_reminders for select to authenticated using (cc_vol_can_view_location(location_id));

-- The reservist flag joins the columns a scheduler or viewer may read (still no email, notes or consents).
grant select (id, full_name, phone, availability, status, reservist) on cc_volunteers to authenticated;

do $$
declare f text;
begin
  foreach f in array array['cc_vol_can_view_location(uuid)', 'cc_vol__slot_viewer(uuid)', 'cc_vol_my_access()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function cc_vol__admin(uuid) from public, anon, authenticated, service_role';
  execute 'revoke all on function cc_vol_sched_log_reminder(uuid, date, text, integer) from public, anon';
  execute 'grant execute on function cc_vol_sched_log_reminder(uuid, date, text, integer) to authenticated, service_role';
end $$;
