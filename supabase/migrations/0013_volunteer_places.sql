-- 0013 — Volunteer scheduling, part 3: the three places, Sunday to Friday.
--
-- Builds on 0011 + 0012. Idempotent; run it once in the Command Center's Supabase SQL editor.
-- Only DATA: no table or function changes. Who schedules / views each place is
-- granted afterwards in Settings → Staff → Volunteer schedule.
--
--   * בית המלאכה של שרון (was "הסדנה של שרון"): Dafna schedules, ~10 a day.
--   * מתחם כללי: Gil schedules (mostly reservists), ~2–4 a day.
--   * חנות הגלריה: Liat schedules, ~2–3 a day.
--   * Every place is open Sunday (0) to Friday (5). Days already there are kept.
--   * "Required" is filled in ONLY where nobody set it yet (the low end of each
--     range, so a normal day does not read as short); change it on קבועים.

do $$
declare
  sharon uuid; compound uuid; store uuid;
begin
  perform set_config('cc.vol_sched', 'on', true);

  insert into cc_vol_locations (slug, name) values ('sharon_workshop', 'בית המלאכה של שרון') on conflict (slug) do nothing;
  update cc_vol_locations set name = 'בית המלאכה של שרון' where slug = 'sharon_workshop' and name = 'הסדנה של שרון';
  insert into cc_vol_locations (slug, name) values ('general_compound', 'מתחם כללי') on conflict (slug) do nothing;
  insert into cc_vol_locations (slug, name) values ('gallery_store', 'חנות הגלריה') on conflict (slug) do nothing;

  select id into sharon from cc_vol_locations where slug = 'sharon_workshop';
  select id into compound from cc_vol_locations where slug = 'general_compound';
  select id into store from cc_vol_locations where slug = 'gallery_store';

  insert into cc_vol_slots (location_id, activity, weekday)
  select l.id, l.activity, d.weekday
  from (values (sharon, 'workshop'), (compound, 'general'), (store, 'store')) as l(id, activity)
  cross join generate_series(0, 5) as d(weekday)
  on conflict (location_id, activity, weekday) do nothing;

  -- A day switched off earlier comes back: the owner asked for Sunday to Friday everywhere.
  update cc_vol_slots set active = true, version = version + 1, updated_at = now()
  where location_id in (sharon, compound, store) and weekday between 0 and 5 and not active;

  update cc_vol_slots set required = 10, version = version + 1, updated_at = now() where location_id = sharon and required is null;
  update cc_vol_slots set required = 2, version = version + 1, updated_at = now() where location_id = compound and required is null;
  update cc_vol_slots set required = 2, version = version + 1, updated_at = now() where location_id = store and required is null;
end $$;
