-- JAS Command Center — its OWN Supabase project. It never shares a database
-- with the source systems; it stores only who may do what, and what was done.
--
-- Access model: RLS is enabled on every table with NO policies, so the anon and
-- authenticated roles can read nothing. The Next.js server reads and writes with
-- the service role, after checking the signed-in user's permission in code.
-- Idempotent: safe to run twice.

create extension if not exists pgcrypto;

-- ── Staff ───────────────────────────────────────────────────────────────────
create table if not exists cc_profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  email         text not null unique,
  full_name     text not null default '',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists cc_user_roles (
  profile_id  uuid not null references cc_profiles(id) on delete cascade,
  role        text not null check (role in ('owner','admin','operations_manager','project_manager','viewer')),
  granted_at  timestamptz not null default now(),
  granted_by  uuid references cc_profiles(id) on delete set null,
  primary key (profile_id, role)
);

-- Per-deployment changes to the defaults in lib/auth/rbac.ts. allowed=false revokes.
create table if not exists cc_role_permissions (
  role        text not null check (role in ('owner','admin','operations_manager','project_manager','viewer')),
  permission  text not null,
  allowed     boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (role, permission)
);

-- ── Audit (append-only) ─────────────────────────────────────────────────────
create table if not exists cc_audit_log (
  id                uuid primary key default gen_random_uuid(),
  at                timestamptz not null default now(),
  actor_profile_id  text not null,         -- text: also holds 'dev-owner' / 'system'
  actor_email       text not null,
  actor_role        text not null,
  via               text not null check (via in ('user','assistant','system')),
  action            text not null,
  product           text,
  target            text,
  outcome           text not null check (outcome in ('requested','succeeded','failed','denied')),
  detail            jsonb not null default '{}'::jsonb
);
create index if not exists cc_audit_log_at on cc_audit_log (at desc);
create index if not exists cc_audit_log_target on cc_audit_log (product, target);

create or replace function cc_audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'cc_audit_log is append-only';
end $$;
drop trigger if exists cc_audit_log_no_update on cc_audit_log;
create trigger cc_audit_log_no_update before update or delete on cc_audit_log
  for each row execute function cc_audit_log_immutable();

-- ── Event store (next iteration: activity feed) ─────────────────────────────
-- One row per source event. (source, source_event_id) is unique, so a webhook
-- redelivery or an overlapping poll can never create a duplicate.
create table if not exists cc_events (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,          -- website | gift_cards | furniture | design_agent | map
  source_event_id  text not null,
  type             text not null,
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  severity         text not null default 'info' check (severity in ('info','warning','critical')),
  summary          text not null,
  data             jsonb not null default '{}'::jsonb,   -- never raw PII; ids and aggregates only
  unique (source, source_event_id)
);
create index if not exists cc_events_occurred on cc_events (occurred_at desc);

-- Per-source cursor for polling + last successful sync, shown in the UI.
create table if not exists cc_sync_state (
  source           text primary key,
  cursor           text,
  last_success_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz,
  updated_at       timestamptz not null default now()
);

-- ── Notifications (next iteration: read/unread, assignment) ─────────────────
create table if not exists cc_notifications (
  id            uuid primary key default gen_random_uuid(),
  alert_key     text not null,              -- e.g. gift:undelivered; one open row per key
  product       text not null,
  severity      text not null check (severity in ('info','warning','critical')),
  title         text not null,
  detail        text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  assigned_to   uuid references cc_profiles(id) on delete set null
);
create unique index if not exists cc_notifications_open on cc_notifications (alert_key) where resolved_at is null;

create table if not exists cc_notification_reads (
  notification_id uuid not null references cc_notifications(id) on delete cascade,
  profile_id      uuid not null references cc_profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  dismissed       boolean not null default false,
  primary key (notification_id, profile_id)
);

-- ── Lock it down ────────────────────────────────────────────────────────────
alter table cc_profiles            enable row level security;
alter table cc_user_roles          enable row level security;
alter table cc_role_permissions    enable row level security;
alter table cc_audit_log           enable row level security;
alter table cc_events              enable row level security;
alter table cc_sync_state          enable row level security;
alter table cc_notifications       enable row level security;
alter table cc_notification_reads  enable row level security;
revoke all on cc_profiles, cc_user_roles, cc_role_permissions, cc_audit_log, cc_events, cc_sync_state, cc_notifications, cc_notification_reads from anon, authenticated;
