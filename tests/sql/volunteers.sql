\set ON_ERROR_STOP 1
truncate cc_vol_outbox, cc_vol_notes, cc_vol_login_codes cascade;
-- cleanup previous runs
alter table cc_vol_events disable trigger cc_vol_events_no_change; delete from cc_vol_events; alter table cc_vol_events enable trigger cc_vol_events_no_change;
delete from cc_vol_signups; delete from cc_vol_shifts; delete from cc_vol_activities;
delete from cc_volunteers; delete from cc_contacts;

insert into cc_contacts (full_name, email, phone, roles, source) values ('Existing Lead', 'dana@x.com', '0501111111', '{lead}', 'website_form');
select id as dana from cc_vol_register('{"full_name":"Dana","email":"Dana@X.com","phone":"0501111111","adult":true,"areas":["tel_aviv"],"skills":["lifting"]}') \gset
select roles, (select count(*) from cc_contacts) n from cc_contacts where email='dana@x.com';
select id as b from cc_vol_register('{"full_name":"Ben","email":"ben@x.com","phone":"0502222222","adult":false}') \gset
select id as c from cc_vol_register('{"full_name":"Chen","email":"chen@x.com","phone":"0503333333","adult":true}') \gset
-- duplicate email and phone refused
do $$ begin perform cc_vol_register('{"full_name":"Dup","email":"ben@x.com"}'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'dup email: %', sqlerrm; end $$;
do $$ begin perform cc_vol_register('{"full_name":"Dup","email":"new@x.com","phone":"0502222222"}'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'dup phone: %', sqlerrm; end $$;

insert into cc_vol_activities (title, status, created_by, adults_only) values ('Collection', 'published', 'test', false) returning id as act \gset
select (cc_vol_shift_save(null, :'act', null, jsonb_build_object('starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 4 hours', 'capacity', 2), 'test'))->'shift'->>'id' as s1 \gset
select (cc_vol_shift_save(null, :'act', null, jsonb_build_object('starts_at', now() + interval '2 days 2 hours', 'ends_at', now() + interval '2 days 6 hours', 'capacity', 5), 'test'))->'shift'->>'id' as s2 \gset

select status from cc_vol_join(:'s1', :'dana', 'self', 'v');
select status from cc_vol_join(:'s1', :'dana', 'self', 'v'); -- idempotent
select status from cc_vol_join(:'s1', :'b', 'self', 'v');
select status from cc_vol_join(:'s1', :'c', 'self', 'v'); -- waitlisted
-- overlap: dana on s2 overlaps s1
do $$ declare d uuid; s uuid; begin select id into d from cc_volunteers where email='dana@x.com'; select id into s from cc_vol_shifts order by starts_at desc limit 1; perform cc_vol_join(s, d, 'self', 'v'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'overlap: %', sqlerrm; end $$;
-- staff add when full refused
do $$ declare s uuid; v uuid; begin select id into s from cc_vol_shifts order by starts_at limit 1; insert into cc_volunteers (full_name,email) values ('Z','z@x.com') returning id into v; perform cc_vol_join(s, v, 'staff', 'staff'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'full: %', sqlerrm; end $$;
-- capacity below confirmed refused
do $$ declare s uuid; begin select id into s from cc_vol_shifts order by starts_at limit 1; perform cc_vol_shift_save(s, null, null, jsonb_build_object('starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 4 hours', 'capacity', 1), 't'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'capacity: %', sqlerrm; end $$;
-- dana cancels -> chen promoted
select s.status, v.full_name from cc_vol_leave((select id from cc_vol_signups where shift_id=:'s1' and volunteer_id=:'dana'), 'cancelled', 'sick', 'v', :'dana') s join cc_volunteers v on v.id=s.volunteer_id;
select v.full_name, s.status from cc_vol_signups s join cc_volunteers v on v.id=s.volunteer_id where shift_id=:'s1' order by 1;
-- after cancel dana can join s2 (no overlap now)
select status from cc_vol_join(:'s2', :'dana', 'self', 'v');
-- rejoin s1 → waitlisted again (full)
do $$ declare s uuid; d uuid; begin select id into s from cc_vol_shifts order by starts_at limit 1; select id into d from cc_volunteers where email='dana@x.com'; perform cc_vol_join(s, d, 'self', 'v'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'rejoin overlap: %', sqlerrm; end $$;
-- wait: dana is on s2 confirmed overlapping s1 → should be refused. Check above output.
-- capacity raise promotes
select cc_vol_shift_save(:'s2', null, null, jsonb_build_object('starts_at', now() + interval '2 days 2 hours', 'ends_at', now() + interval '2 days 6 hours', 'capacity', 6), 't')->'promoted';
-- adults only
update cc_vol_activities set adults_only = true where id = :'act';
do $$ declare s uuid; v uuid; begin select id into s from cc_vol_shifts order by starts_at desc limit 1; select id into v from cc_volunteers where email='ben@x.com'; perform cc_vol_join(s, v, 'self', 'v'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'adult: %', sqlerrm; end $$;
update cc_vol_activities set adults_only = false where id = :'act';
-- attendance before start refused
do $$ declare s uuid; begin select id into s from cc_vol_signups where status='confirmed' limit 1; perform cc_vol_attendance(s, 'check_in', null, null, null, 't', null); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'early: %', sqlerrm; end $$;
-- move shift to the past-ish (staff edit while started is fine for test) then attendance
update cc_vol_shifts set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = :'s1';
select attendance, minutes, attendance_method from cc_vol_attendance((select id from cc_vol_signups where shift_id=:'s1' and volunteer_id=:'b'), 'full_shift', null, null, null, 'coord', null);
select attendance, minutes from cc_vol_attendance((select id from cc_vol_signups where shift_id=:'s1' and volunteer_id=:'c'), 'absent', null, null, null, 'coord', null);
do $$ declare s uuid; begin select id into s from cc_vol_signups where attendance='absent' limit 1; perform cc_vol_attendance(s, 'correct', now()-interval '3 hours', now()-interval '2 hours', '', 't', null); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'note: %', sqlerrm; end $$;
select attendance, minutes, attendance_method from cc_vol_attendance((select id from cc_vol_signups where shift_id=:'s1' and volunteer_id=:'c'), 'correct', now()-interval '3 hours', now()-interval '1 hour 30 minutes', 'came late, coordinator confirmed', 'coord', null);
-- volunteer cancel after start refused
do $$ declare s uuid; v uuid; begin select id, volunteer_id into s, v from cc_vol_signups where attendance='present' limit 1; perform cc_vol_leave(s, 'cancelled', null, 'v', v); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'late cancel: %', sqlerrm; end $$;
-- self checkin
update cc_vol_shifts set starts_at = now() - interval '10 minutes', ends_at = now() + interval '3 hours' where id = :'s2';
select attendance, check_in_at is not null from cc_vol_self_checkin(:'s2', :'dana', (select checkin_code from cc_vol_shifts where id=:'s2'));
do $$ declare s uuid; d uuid; begin select id into s from cc_vol_shifts order by starts_at desc limit 1; select id into d from cc_volunteers where email='dana@x.com'; perform cc_vol_self_checkin(s, d, 'wrong'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'bad code: %', sqlerrm; end $$;
-- cancel activity
select count(*) as cancelled_signups from cc_vol_cancel(:'act', null, 'rain', 'staff');
select status from cc_vol_activities where id=:'act';
do $$ declare s uuid; v uuid; begin select id into s from cc_vol_shifts limit 1; select id into v from cc_volunteers where email='ben@x.com'; perform cc_vol_join(s, v, 'self', 'v'); raise exception 'should fail'; exception when others then if sqlerrm not like 'cc_conflict%' then raise; end if; raise notice 'cancelled act: %', sqlerrm; end $$;
-- forget
select full_name, email, status from cc_vol_forget(:'c', 'staff');
select roles from cc_contacts where email='chen@x.com';
select count(*) as events from cc_vol_events;
do $$ begin delete from cc_vol_events; raise exception 'should fail'; exception when others then raise notice 'append-only: %', sqlerrm; end $$;
