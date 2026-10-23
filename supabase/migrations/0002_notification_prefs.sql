-- Per-person notification settings: what shows in their inbox, and what is
-- emailed to them. Same access model as 0001: RLS on, no policies; only the
-- server (service role) reads and writes, after checking the session.
-- Idempotent: safe to run twice.

create table if not exists cc_notification_prefs (
  profile_id      uuid primary key references cc_profiles(id) on delete cascade,
  muted_products  text[] not null default '{}',
  min_severity    text not null default 'info' check (min_severity in ('info','warning','critical')),
  -- Email when an alert at or above this severity first opens; 'off' = never.
  email_alerts    text not null default 'off' check (email_alerts in ('off','warning','critical')),
  -- The business report by email.
  email_report    text not null default 'off' check (email_report in ('off','daily','weekly','monthly')),
  updated_at      timestamptz not null default now()
);

-- When an alert was emailed, so a re-raised or touched alert is not emailed twice.
alter table cc_notifications add column if not exists emailed_at timestamptz;

alter table cc_notification_prefs enable row level security;
revoke all on cc_notification_prefs from anon, authenticated;
