-- 0012: a location VIEWER (Sharon, Gil, Liat) sees the schedule and changes nothing;
-- reminders are logged only by a scheduler. Run after schedule.sql (same fixtures).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'sharon@x.test') on conflict do nothing;
insert into cc_profiles (id, auth_user_id, email, full_name) values
  ('a3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'sharon@x.test', 'Sharon') on conflict do nothing;
delete from cc_vol_location_admins where profile_id = 'a3333333-3333-4333-8333-333333333333';
insert into cc_vol_location_admins (location_id, profile_id, granted_by, access)
  select id, 'a3333333-3333-4333-8333-333333333333', 'owner@x.test', 'view' from cc_vol_locations where slug = 'sharon_workshop';
update cc_volunteers set reservist = true where id = 'b0000000-0000-4000-8000-000000000003';

create temp table t2 as
  select (select id from cc_vol_locations where slug = 'sharon_workshop') as loc,
         (select id from cc_vol_slots where weekday = 2) as tue,
         cc_vol__today() + 14 + ((2 - extract(dow from cc_vol__today())::int + 7) % 7) as d,
         (cc_vol__today() - extract(dow from cc_vol__today())::int + 7) as next_sun;
grant select on t2 to authenticated, service_role, anon;

create or replace function pg_temp.expect_fail(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED FAILURE did not happen: %', sql;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'wrong error for %: % (wanted %)', sql, sqlerrm, pattern; end if;
  raise notice 'refused as expected: %', sqlerrm;
end $$;
create or replace function pg_temp.as_sharon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false) $$;
create or replace function pg_temp.as_dafna() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false) $$;
create or replace function pg_temp.as_other() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false) $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;

-- ── Sharon (viewer) sees everything about her location … ──────────────────
select pg_temp.as_sharon();
set role authenticated;
select count(*) = 3 as ok from cc_vol_slots \gset
\if :ok \else \echo 'FAIL: viewer should see 3 slots' \quit \endif
select count(*) >= 1 as ok from cc_vol_regulars \gset
\if :ok \else \echo 'FAIL: viewer should see the regulars' \quit \endif
select count(*) = 1 as ok from cc_volunteers where reservist \gset
\if :ok \else \echo 'FAIL: viewer should read the reservist flag' \quit \endif
select access = 'view' as ok from cc_vol_my_access() \gset
\if :ok \else \echo 'FAIL: my_access should say view' \quit \endif
select pg_temp.expect_fail($$select email from cc_volunteers$$, 'permission denied');
-- … and changes nothing, through any function.
select pg_temp.expect_fail($$select cc_vol_sched_update_slot((select tue from t2), null, '{"required":"9"}')$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_add_regular((select tue from t2), 'b0000000-0000-4000-8000-000000000002', cc_vol__today())$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t2), 'b0000000-0000-4000-8000-000000000002', (select d from t2), 'confirmed', null, null)$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t2), 'b0000000-0000-4000-8000-000000000001', (select d from t2), null, 'admin')$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_closure((select tue from t2), (select d from t2), true, 'x')$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_log_reminder((select loc from t2), (select next_sun from t2), 'email', 3)$$, 'scheduling administrator');
select pg_temp.expect_fail($$insert into cc_vol_reminders (location_id, week_start, channel, sent_by) values ((select loc from t2), (select next_sun from t2), 'email', 'x')$$, 'permission denied');
reset role;

-- ── Dafna (scheduler) logs a reminder; it must be about a Sunday-week ─────
select pg_temp.as_dafna();
set role authenticated;
select access = 'schedule' as ok from cc_vol_my_access() \gset
\if :ok \else \echo 'FAIL: my_access should say schedule' \quit \endif
select recipients = 3 and sent_by = 'dafna@x.test' as ok from cc_vol_sched_log_reminder((select loc from t2), (select next_sun from t2), 'email', 3) \gset
\if :ok \else \echo 'FAIL: reminder not logged' \quit \endif
select pg_temp.expect_fail($$select cc_vol_sched_log_reminder((select loc from t2), (select next_sun from t2) + 1, 'email', 3)$$, 'starting on Sunday');
select pg_temp.expect_fail($$select cc_vol_sched_log_reminder((select loc from t2), (select next_sun from t2), 'sms', 3)$$, 'unknown channel');
reset role;

-- Sharon sees the history; another staff member sees nothing at all.
select pg_temp.as_sharon();
set role authenticated;
select count(*) >= 1 as ok from cc_vol_reminders \gset
\if :ok \else \echo 'FAIL: viewer should see reminder history' \quit \endif
reset role;
select pg_temp.as_other();
set role authenticated;
select (select count(*) from cc_vol_reminders) + (select count(*) from cc_vol_slots) + (select count(*) from cc_volunteers) = 0 as ok \gset
\if :ok \else \echo 'FAIL: unlisted staff should see nothing' \quit \endif
select count(*) = 0 as ok from cc_vol_my_access() \gset
\if :ok \else \echo 'FAIL: unlisted staff has no access rows' \quit \endif
reset role;

-- The volunteer app (service role) cannot log a reminder either.
select pg_temp.as_service();
set role service_role;
select pg_temp.expect_fail($$select cc_vol_sched_log_reminder((select loc from t2), (select next_sun from t2), 'email', 3)$$, 'scheduling administrator');
reset role;

-- A viewer promoted to scheduler can schedule straight away.
update cc_vol_location_admins set access = 'schedule' where profile_id = 'a3333333-3333-4333-8333-333333333333';
select pg_temp.as_sharon();
set role authenticated;
select count(*) = 1 as ok from cc_vol_sched_closure((select tue from t2), (select d from t2), true, 'חג') \gset
reset role;
update cc_vol_location_admins set access = 'view' where profile_id = 'a3333333-3333-4333-8333-333333333333';
\echo 'schedule-access.sql: all checks passed'
