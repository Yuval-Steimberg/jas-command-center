-- Team portal (/portal): the link registry. Six work categories, each a short
-- list of actions that open the page or app that does the job. Edited from
-- /portal/manage (permission portal:manage), every change in cc_audit_log.
--
-- Same access model as 0001: RLS on, no policies; only the server (service
-- role) reads and writes, after checking the session and the permission.
-- Additive and idempotent: safe to run twice, never overwrites an edited row.

create table if not exists cc_portal_categories (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  title       text not null check (length(title) between 2 and 40),
  subtitle    text not null default '' check (length(subtitle) <= 80),
  icon        text not null check (icon in ('volunteers','mapping','inventory','design','map','admin','link')),
  sort        integer not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references cc_profiles(id) on delete set null
);

create table if not exists cc_portal_actions (
  id           text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  category_id  text not null references cc_portal_categories(id) on delete restrict,
  title        text not null check (length(title) between 2 and 60),
  description  text not null default '' check (length(description) <= 140),
  -- '/path' on the command center, 'https://…', or 'app:<key>[/path]' (an app whose address the deployment knows). '' = not set.
  destination  text not null default '' check (length(destination) <= 500),
  -- Who the link is FOR: customer = public, safe to send outside; team; manager.
  audience     text not null default 'team' check (audience in ('customer','team','manager')),
  -- Who is SHOWN it (null = everyone signed in). Every destination checks its own permission again.
  permission   text check (permission is null or permission ~ '^[a-z_]+:[a-z_]+$'),
  sort         integer not null default 0,
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references cc_profiles(id) on delete set null
);

create index if not exists cc_portal_actions_category on cc_portal_actions (category_id, sort);

alter table cc_portal_categories enable row level security;
alter table cc_portal_actions enable row level security;
revoke all on cc_portal_categories, cc_portal_actions from anon, authenticated;

-- The first set (lib/portal/seed.ts; tests/unit/portal.test.ts keeps the two in step).
insert into cc_portal_categories (id, title, subtitle, icon, sort, active) values
  ('volunteers', 'מתנדבים ושיבוצים', 'מי מגיע, מי חסר ומי מחליף', 'volunteers', 1, true),
  ('mapping', 'מיפוי ופינוי דירות', 'הבניינים שאנחנו מפנים', 'mapping', 2, true),
  ('inventory', 'מלאי ומכירה', 'חיפוש, מכירה ופריטים חדשים', 'inventory', 3, true),
  ('design', 'עיצוב ותקשורת', 'הודעות, תזכורות וחומרי עבודה', 'design', 4, true),
  ('map', 'מפה אזורית', 'המקומות בשכונה', 'map', 5, true),
  ('admin', 'ניהול', 'קישורים, צוות ומצב המערכות', 'admin', 6, true)
on conflict (id) do nothing;

insert into cc_portal_actions (id, category_id, title, description, destination, audience, permission, sort, active) values
  ('schedule', 'volunteers', 'לוח שיבוצים', 'מי מגיע בכל יום, מי חסר ומי יכול להחליף', '/schedule', 'team', 'volunteers:read_pii', 1, true),
  ('volunteers-weekly', 'volunteers', 'מי מגיע כל שבוע', 'הצוות הקבוע של כל יום וכמה צריך', '/schedule/team', 'team', 'volunteers:read_pii', 2, true),
  ('attendance', 'volunteers', 'עדכון נוכחות', 'סימון מי הגיע למשמרת', '/volunteers/calendar', 'team', 'volunteers:operate', 3, true),
  ('volunteers-manage', 'volunteers', 'ניהול מתנדבים', 'רשימת המתנדבים, פעילויות ודוחות', '/volunteers', 'manager', 'volunteers:read', 4, true),
  ('volunteer-absence', 'volunteers', 'קישור לדיווח היעדרות', 'למתנדבים: נכנסים מהטלפון ומדווחים שלא יגיעו', 'app:volunteers/my', 'customer', 'volunteers:read', 5, true),
  ('map-apartment', 'mapping', 'מיפוי דירה', 'אפליקציית השטח: צילום ותיעוד בתוך הדירה', 'app:furniture', 'team', 'furniture:read', 1, true),
  ('projects', 'mapping', 'פרויקטים והתקדמות', 'כמה נאסף בכל בניין ומה נשאר', '/furniture', 'team', 'furniture:read', 2, true),
  ('project-new', 'mapping', 'פרויקט חדש', 'פתיחת בניין לפינוי עם כל הדירות', '/furniture/new', 'manager', 'furniture:write', 3, true),
  ('intake', 'mapping', 'קליטת איסוף למלאי', 'פריטים שהגיעו מבניין נכנסים למחסן', '/inventory/intake', 'team', 'inventory:operate', 4, true),
  ('item-search', 'inventory', 'חיפוש פריט במלאי', 'לפי שם או קוד, או סריקת מדבקה', '/shop/items', 'team', 'inventory:read', 1, true),
  ('sale', 'inventory', 'רישום מכירה', 'מכירה בקופה, מזומן או אשראי', '/shop/sell', 'team', 'inventory:financial', 2, true),
  ('item-new', 'inventory', 'הוספת פריט', 'צילום, פרטים ומחיר', '/shop/new', 'team', 'inventory:write', 3, true),
  ('customer-new', 'inventory', 'לקוח חדש', 'שם, טלפון ומה מחפשים', '/crm/new', 'team', 'crm:write', 4, true),
  ('shop-link', 'inventory', 'קישור מלאי ללקוח', 'החנות באתר: שולחים ללקוח כדי שיראה מה יש', 'app:website/shop', 'customer', 'inventory:read', 5, true),
  ('inventory-manage', 'inventory', 'ניהול מלאי', 'כל הפריטים, מחירים, מיקומים ודוחות', '/inventory', 'manager', 'inventory:reports', 6, true),
  ('inquiries', 'design', 'הודעות מהאתר', 'פניות מטופס יצירת קשר, התנדבות ותרומה', '/website/inquiries', 'team', 'website:read_pii', 1, true),
  ('volunteer-reminder', 'design', 'תזכורת למתנדבים', 'מייל שבועי למי שמשובץ, והודעה לקבוצה', '/schedule/remind', 'team', 'volunteers:read_pii', 2, true),
  ('designers-group', 'design', 'קבוצת המעצבים', 'הקבוצה בטלגרם', '', 'team', null, 3, false),
  ('materials', 'design', 'תיקיית חומרים', 'תמונות, לוגו ותבניות', '', 'team', null, 4, false),
  ('publishing', 'design', 'קישורי פרסום', 'כלים וערוצי פרסום', '', 'team', null, 5, false),
  ('map-open', 'map', 'פתיחת המפה', 'המפה השכונתית, כמו שהציבור רואה אותה', 'app:map', 'customer', null, 1, true),
  ('map-edit', 'map', 'עריכת מקומות במפה', 'הוספה ותיקון של מקומות', '/map', 'manager', 'map:write', 2, true),
  ('links', 'admin', 'ניהול קישורים', 'הוספה, שינוי וסדר של הכפתורים בפורטל', '/portal/manage', 'manager', 'portal:manage', 1, true),
  ('staff', 'admin', 'צוות והרשאות', 'הזמנת אנשים ושינוי תפקיד', '/settings/staff', 'manager', 'users:manage', 2, true),
  ('systems', 'admin', 'מצב המערכות', 'האם כל מערכת עובדת עכשיו', '/integrations', 'manager', 'integrations:read', 3, true),
  ('console', 'admin', 'מערכת הניהול המלאה', 'כל המסכים המפורטים (באנגלית)', '/console', 'manager', 'integrations:read', 4, true)
on conflict (id) do nothing;
