-- Team portal: a "שוברי מתנה" (gift cards) category (owner, 2026-11-06).
-- Redeeming and the gift card admin live in the gift card system itself,
-- behind its own sign-in; finding a card is the command center's /gift-cards;
-- the buy link is the public shop, safe to send to a customer.
--
-- Additive and idempotent: safe to run twice, never overwrites an edited row.
-- Same rows as lib/portal/seed.ts (tests/unit/portal.test.ts keeps them in step).

-- The category needs its own icon.
alter table cc_portal_categories drop constraint if exists cc_portal_categories_icon_check;
alter table cc_portal_categories add constraint cc_portal_categories_icon_check
  check (icon in ('volunteers','mapping','inventory','design','map','admin','gift','link'));

-- Same sort as inventory (3): the id puts it just before it, next to the other selling work.
insert into cc_portal_categories (id, title, subtitle, icon, sort, active) values
  ('gift-cards', 'שוברי מתנה', 'בדיקה, מימוש ומכירה של שוברים', 'gift', 3, true)
on conflict (id) do nothing;

insert into cc_portal_actions (id, category_id, title, description, destination, audience, permission, sort, active) values
  ('gift-redeem', 'gift-cards', 'מימוש שובר', 'בקופה, במערכת השוברים (כניסה עם המשתמש שלך שם)', 'app:gift_cards/employee', 'team', 'gift_cards:operate', 1, true),
  ('gift-find', 'gift-cards', 'חיפוש שובר', 'יתרה, מצב ומשלוח של שובר לפי קוד', '/gift-cards', 'team', 'gift_cards:read', 2, true),
  ('gift-buy-link', 'gift-cards', 'קישור לקניית שובר', 'שולחים ללקוח שרוצה לקנות שובר מתנה', 'https://gift.justasecond.co.il/gift-cards', 'customer', null, 3, true),
  ('gift-admin', 'gift-cards', 'ניהול מערכת השוברים', 'מכירות, החזרים, הגדרות וצוות', 'app:gift_cards/admin', 'manager', 'gift_cards:write', 4, true)
on conflict (id) do nothing;
