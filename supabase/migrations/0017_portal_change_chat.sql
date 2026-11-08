-- Team portal: a "שינוי בפורטל בשיחה" button in ניהול (owner, 2026-11-08).
-- The page (/portal/change) needs portal:manage, the same as link management.
--
-- Additive and idempotent: safe to run twice, never overwrites an edited row.
-- Same row as lib/portal/seed.ts (tests/unit/portal.test.ts keeps them in step).

insert into cc_portal_actions (id, category_id, title, description, destination, audience, permission, sort, active) values
  ('change-chat', 'admin', 'שינוי בפורטל בשיחה', 'אומרים מה לשנות, בכתב, בקול או בצילום מסך', '/portal/change', 'manager', 'portal:manage', 5, true)
on conflict (id) do nothing;
