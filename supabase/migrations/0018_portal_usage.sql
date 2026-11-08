-- Team portal: which buttons each person uses, so their most used ones come
-- first (/portal, "השימושים שלך") and link management sees what nobody opens.
-- One counter per person and button; no times of day, no history.
--
-- Same access model as 0001: RLS on, no policies; only the server (service
-- role) reads and writes. Additive and idempotent: safe to run twice.

create table if not exists cc_portal_usage (
  profile_id    uuid not null references cc_profiles(id) on delete cascade,
  -- No foreign key to cc_portal_actions: deleting a link must not be blocked by its history.
  action_id     text not null check (action_id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  uses          integer not null default 0 check (uses >= 0),
  last_used_at  timestamptz not null default now(),
  primary key (profile_id, action_id)
);

alter table cc_portal_usage enable row level security;
revoke all on cc_portal_usage from anon, authenticated;

-- One atomic increment, so two taps at the same moment both count.
create or replace function cc_portal_use(p_profile uuid, p_action text) returns void
language sql set search_path = public as $$
  insert into cc_portal_usage (profile_id, action_id, uses, last_used_at)
  values (p_profile, p_action, 1, now())
  on conflict (profile_id, action_id) do update set uses = cc_portal_usage.uses + 1, last_used_at = now();
$$;

revoke all on function cc_portal_use(uuid, text) from public, anon, authenticated;
grant execute on function cc_portal_use(uuid, text) to service_role;
