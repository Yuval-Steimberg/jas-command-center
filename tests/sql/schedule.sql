-- Rules and access for 0011 (volunteer scheduling), on a real Postgres 16 with
-- Supabase's roles stubbed (see README.md). Stops at the first unexpected result.
-- Every refusal it expects is caught and printed as a NOTICE.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ── Fixtures (as the owner of the database, like the SQL editor) ───────────
delete from cc_vol_location_admins;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'dafna@x.test'),
  ('22222222-2222-4222-8222-222222222222', 'other@x.test') on conflict do nothing;
insert into cc_profiles (id, auth_user_id, email, full_name) values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'dafna@x.test', 'Dafna'),
  ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'other@x.test', 'Other staff') on conflict do nothing;
insert into cc_vol_location_admins (location_id, profile_id, granted_by)
  select id, 'a1111111-1111-4111-8111-111111111111', 'owner@x.test' from cc_vol_locations where slug = 'sharon_workshop';
insert into cc_volunteers (id, full_name, email, phone, availability, status) values
  ('b0000000-0000-4000-8000-000000000001', 'יוסי כהן', 'yossi@x.test', '0500000001', '{tue_morning}', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'רותי לוי', 'ruti@x.test', '0500000002', '{tue_morning}', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'אבי מזרחי', 'avi@x.test', '0500000003', '{}', 'active'),
  ('b0000000-0000-4000-8000-000000000004', 'מושהה', 'paused@x.test', '0500000004', '{}', 'paused') on conflict do nothing;

create temp table t_ctx as
  select (select id from cc_vol_slots where weekday = 2) as tue,
         (select id from cc_vol_slots where weekday = 1) as mon,
         -- a Tuesday at least a week ahead, so "today" never interferes
         cc_vol__today() + 7 + ((2 - extract(dow from cc_vol__today())::int + 7) % 7) as d;
grant select on t_ctx to authenticated, service_role, anon;

create or replace function pg_temp.expect_fail(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED FAILURE did not happen: %', sql;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'wrong error for %: % (wanted %)', sql, sqlerrm, pattern; end if;
  raise notice 'refused as expected: %', sqlerrm;
end $$;

create or replace function pg_temp.as_dafna() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false)
$$;
create or replace function pg_temp.as_other() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false)
$$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false)
$$;

-- ── Dafna sets up Tuesday ──────────────────────────────────────────────────
select pg_temp.as_dafna();
set role authenticated;
select count(*) = 3 as sees_three_days from cc_vol_slots \gset
\if :sees_three_days \else \echo 'FAIL: Dafna should see 3 slots' \quit \endif
select required from cc_vol_sched_update_slot((select tue from t_ctx), null, '{"required":"3","starts_at":"09:00","ends_at":"13:00"}');
select pg_temp.expect_fail($$select cc_vol_sched_update_slot((select tue from t_ctx), 1, '{"required":"4"}')$$, 'changed this day');
select count(*) from cc_vol_sched_add_regular((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', cc_vol__today());
select count(*) from cc_vol_sched_add_regular((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000003', cc_vol__today());
select pg_temp.expect_fail($$select cc_vol_sched_add_regular((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', cc_vol__today())$$, 'already a regular');
select pg_temp.expect_fail($$select cc_vol_sched_add_regular((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000004', cc_vol__today())$$, 'not active');
select pg_temp.expect_fail($$select cc_vol_sched_add_regular((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', cc_vol__today() - 1)$$, 'today or later');

-- Direct writes are impossible for a signed-in admin (no grant) …
select pg_temp.expect_fail($$insert into cc_vol_assignments (slot_id, volunteer_id, on_date, status, created_by) values ((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx), 'confirmed', 'x')$$, 'permission denied');
select pg_temp.expect_fail($$update cc_vol_slots set required = 99$$, 'permission denied');
-- … and Dafna can read volunteers' name/phone/availability, but not their email.
select count(*) >= 4 as reads_volunteers from cc_volunteers \gset
\if :reads_volunteers \else \echo 'FAIL: Dafna should read volunteers' \quit \endif
select pg_temp.expect_fail($$select email from cc_volunteers$$, 'permission denied');
reset role;

-- ── The volunteer app (service role) can ONLY report absences ──────────────
select pg_temp.as_service();
set role service_role;
select pg_temp.expect_fail($$insert into cc_vol_assignments (slot_id, volunteer_id, on_date, status, created_by) values ((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx), 'confirmed', 'x')$$, 'scheduling functions');
select pg_temp.expect_fail($$update cc_vol_slots set required = 99$$, 'scheduling functions');
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx), 'confirmed', null, null)$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_add_regular((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', cc_vol__today())$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx), null, 'admin')$$, 'scheduling administrator');
-- Yossi will not come on that Tuesday. Twice = once.
create temp table t_abs as select * from cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx), 'מחלה', 'volunteer');
select (select id from t_abs) = (select id from cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx), null, 'volunteer')) as same_absence \gset
\if :same_absence \else \echo 'FAIL: a repeated absence must return the same row' \quit \endif
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx), null, 'volunteer')$$, 'not scheduled');
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx) + 1, null, 'volunteer')$$, 'is not a Tuesday');
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx) - 14 - 7 * 52, null, 'volunteer')$$, 'passed');
-- The recurring assignment is untouched by the absence.
select count(*) = 1 as still_regular from cc_vol_regulars where volunteer_id = 'b0000000-0000-4000-8000-000000000001' and ends_on is null \gset
\if :still_regular \else \echo 'FAIL: an absence must not end the regular day' \quit \endif
reset role;

-- A signed-in person cannot pose as the volunteer app.
select pg_temp.as_dafna();
set role authenticated;
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000003', (select d from t_ctx), null, 'volunteer')$$, 'through the volunteer app');

-- ── Dafna fills the gap; duplicates are refused ────────────────────────────
create temp table t_asg as select * from cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx), 'tentative', 'b0000000-0000-4000-8000-000000000001', 'שאלתי בטלפון');
select (select id from t_asg) = (select id from cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx), 'confirmed', null, null)) as same_assignment \gset
\if :same_assignment \else \echo 'FAIL: assigning twice must return the same row' \quit \endif
select status = 'confirmed' as now_confirmed from cc_vol_assignments where id = (select id from t_asg) \gset
\if :now_confirmed \else \echo 'FAIL: second assign should confirm' \quit \endif
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000003', (select d from t_ctx), 'confirmed', null, null)$$, 'already comes that day as a regular');
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx), 'confirmed', null, null)$$, 'take the absence back');
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000004', (select d from t_ctx), 'confirmed', null, null)$$, 'not active');
-- "Replace Avi with the paused volunteer" fails as a whole: Avi's absence is NOT left behind.
select pg_temp.expect_fail($$select cc_vol_sched_replace((select tue from t_ctx), (select d from t_ctx), 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004', 'confirmed', null)$$, 'not active');
select count(*) = 0 as no_partial from cc_vol_absences where volunteer_id = 'b0000000-0000-4000-8000-000000000003' and withdrawn_at is null \gset
\if :no_partial \else \echo 'FAIL: a refused replace left an absence behind' \quit \endif
-- Closed day: nobody is expected, nothing can be assigned or reported.
select cc_vol_sched_closure((select tue from t_ctx), (select d from t_ctx) + 7, true, 'חג');
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx) + 7, 'confirmed', null, null)$$, 'closed');
reset role;
select pg_temp.as_service();
set role service_role;
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx) + 7, null, 'volunteer')$$, 'closed');
-- Taking an absence back: only the volunteer's own.
select pg_temp.expect_fail($$select cc_vol_sched_withdraw_absence((select id from t_abs), 'volunteer', 'b0000000-0000-4000-8000-000000000002')$$, 'not found');
select withdrawn_at is not null as withdrawn from cc_vol_sched_withdraw_absence((select id from t_abs), 'volunteer', 'b0000000-0000-4000-8000-000000000001') \gset
\if :withdrawn \else \echo 'FAIL: withdraw' \quit \endif
reset role;

-- ── Someone who is not the location's admin gets nothing ───────────────────
select pg_temp.as_other();
set role authenticated;
select count(*) = 0 as other_sees_nothing from cc_vol_slots \gset
\if :other_sees_nothing \else \echo 'FAIL: non-admin sees slots' \quit \endif
select count(*) = 0 as other_no_volunteers from cc_volunteers \gset
\if :other_no_volunteers \else \echo 'FAIL: non-admin sees volunteers' \quit \endif
select pg_temp.expect_fail($$select cc_vol_sched_assign((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000002', (select d from t_ctx) + 14, 'confirmed', null, null)$$, 'scheduling administrator');
select pg_temp.expect_fail($$select cc_vol_sched_update_slot((select tue from t_ctx), null, '{"required":"9"}')$$, 'scheduling administrator');
reset role;

-- ── Anonymous: no reads, no functions ──────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
select pg_temp.expect_fail($$select * from cc_vol_slots$$, 'permission denied');
select pg_temp.expect_fail($$select cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000001', (select d from t_ctx), null, 'volunteer')$$, 'permission denied');
reset role;

-- ── Ending a regular day keeps the past and clears future absences ─────────
select pg_temp.as_dafna();
set role authenticated;
select count(*) from cc_vol_sched_absence((select tue from t_ctx), 'b0000000-0000-4000-8000-000000000003', (select d from t_ctx) + 14, null, 'admin');
select ends_on = (select d from t_ctx) as ended from cc_vol_sched_end_regular((select id from cc_vol_regulars where volunteer_id = 'b0000000-0000-4000-8000-000000000003' and ends_on is null), (select d from t_ctx)) \gset
\if :ended \else \echo 'FAIL: end regular' \quit \endif
select count(*) = 0 as future_cleared from cc_vol_absences where volunteer_id = 'b0000000-0000-4000-8000-000000000003' and withdrawn_at is null \gset
\if :future_cleared \else \echo 'FAIL: future absence kept after the regular day ended' \quit \endif
-- Cancelling a replacement.
select cancelled_at is not null as cancelled from cc_vol_sched_cancel_assignment((select id from t_asg), 'לא צריך') \gset
\if :cancelled \else \echo 'FAIL: cancel' \quit \endif
reset role;

-- Every change left an event.
select count(*) >= 8 as events from cc_vol_events where kind like 'schedule.%' \gset
\if :events \else \echo 'FAIL: events' \quit \endif
\echo 'schedule.sql: all checks passed'
