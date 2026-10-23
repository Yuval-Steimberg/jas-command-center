-- JAS Command Center — CRM + inventory (the console's OWN data).
--
-- What lives here, and why (docs/CRM_INVENTORY.md has the full ownership table):
--  * Physical items AFTER intake (from a furniture collection or by hand): where
--    they are, their condition and lifecycle, reservations, in-store sales,
--    donations / recycling. No source system tracks an item between the truck
--    and the shop page. Once an item is listed, the WEBSITE owns its price,
--    published state and stock; this row keeps only the link.
--  * Contacts, companies, leads (deals), interactions, tasks, deliveries: no
--    source system has a customer table.
-- Website orders, gift cards and field records are NEVER copied here; rows
-- point at them by id.
--
-- Same access model as 0001: RLS on, no policies; the server uses the service
-- role after checking permissions in code. Idempotent: safe to run twice.

-- ── Locations (warehouse → zone → shelf; the shop; external) ────────────────
create table if not exists cc_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'warehouse' check (kind in ('warehouse','zone','shelf','shop','external')),
  parent_id   uuid references cc_locations(id) on delete restrict,
  address     text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Contacts (people and companies) ─────────────────────────────────────────
create table if not exists cc_contacts (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'person' check (kind in ('person','company')),
  full_name         text not null,
  email             text,          -- stored lower-case
  phone             text,          -- stored as digits, Israeli mobiles as 05XXXXXXXX
  company_id        uuid references cc_contacts(id) on delete set null,
  roles             text[] not null default '{}',   -- customer, lead, supplier, partner, donor, volunteer
  source            text not null default 'manual', -- manual, website_order, website_form, gift_card, whatsapp, in_store
  notes             text,
  owner_profile_id  uuid references cc_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists cc_contacts_email on cc_contacts (email) where email is not null;
create unique index if not exists cc_contacts_phone on cc_contacts (phone) where phone is not null;
create index if not exists cc_contacts_name on cc_contacts (full_name);

-- ── Inventory items ─────────────────────────────────────────────────────────
create sequence if not exists cc_sku_seq;

create table if not exists cc_inventory_items (
  id                     uuid primary key default gen_random_uuid(),
  sku                    text not null unique default ('JAS-' || lpad(nextval('cc_sku_seq')::text, 6, '0')),
  title                  text not null,
  description            text,
  category               text,
  kind                   text not null default 'unique' check (kind in ('unique','batch')),
  quantity               integer not null default 1 check (quantity >= 0),
  condition              text check (condition in ('as_new','good','needs_repair','scrap_only')),
  status                 text not null default 'in_storage'
                           check (status in ('in_storage','listed','reserved','sold','delivered','donated','recycled','disposed')),
  location_id            uuid references cc_locations(id) on delete set null,
  price_minor            integer check (price_minor is null or price_minor > 0),   -- asking price, agorot; the website owns the price once listed
  photo_url              text,
  dimensions             text,
  material               text,
  weight_kg              numeric,
  source                 text not null default 'manual' check (source in ('furniture','manual')),
  furniture_item_id      text unique,      -- Furniture-Collect items.id: one field item enters inventory once
  furniture_project_id   text,
  furniture_project_name text,
  furniture_apartment    text,
  website_product_id     integer unique,   -- the website product created from this item
  reserved_for           uuid references cc_contacts(id) on delete set null,
  reserved_until         timestamptz,
  reserved_prev_status   text,
  reserved_website_qty   integer,          -- website quantity before the reservation zeroed it
  sold_channel           text check (sold_channel in ('website','in_store')),
  sold_at                timestamptz,
  sold_price_minor       integer,
  buyer_contact_id       uuid references cc_contacts(id) on delete set null,
  website_order_id       integer,
  website_order_number   text,
  disposition_note       text,             -- donation recipient / recycling destination / disposal reason
  version                integer not null default 1,
  created_by             text not null default 'system',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists cc_inventory_items_status on cc_inventory_items (status);
create index if not exists cc_inventory_items_location on cc_inventory_items (location_id);
create index if not exists cc_inventory_items_buyer on cc_inventory_items (buyer_contact_id);

-- Append-only ledger. (item, type, ref_kind, ref_id) is unique when a ref is
-- given, so a sync that sees the same website order twice records it once.
create table if not exists cc_inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references cc_inventory_items(id) on delete restrict,
  at              timestamptz not null default now(),
  type            text not null check (type in ('intake','move','edit','list','publish','unpublish','reserve','release','sell','deliver','return','donate','recycle','dispose','adjust','conflict')),
  from_status     text,
  to_status       text,
  from_location   uuid,
  to_location     uuid,
  quantity_delta  integer not null default 0,
  ref_kind        text,          -- furniture_item, website_product, website_order, contact, delivery
  ref_id          text,
  note            text,
  actor_email     text not null,
  detail          jsonb not null default '{}'::jsonb
);
create index if not exists cc_inventory_movements_item on cc_inventory_movements (item_id, at desc);
create index if not exists cc_inventory_movements_at on cc_inventory_movements (at desc);
create unique index if not exists cc_inventory_movements_ref on cc_inventory_movements (item_id, type, ref_kind, ref_id) where ref_id is not null;

create or replace function cc_movements_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'cc_inventory_movements is append-only';
end $$;
drop trigger if exists cc_movements_no_update on cc_inventory_movements;
create trigger cc_movements_no_update before update or delete on cc_inventory_movements
  for each row execute function cc_movements_immutable();

-- ── Atomic item writes ──────────────────────────────────────────────────────
-- Every item change is ONE transaction: lock the row, check the status the
-- caller expects (and its version when given), write, append the movement.
-- A conflict raises 'cc_conflict: …' and changes nothing. A movement whose
-- ref was already recorded returns the item unchanged (idempotent replay).

create or replace function cc_inventory_create(p_item jsonb, p_movement jsonb)
returns setof cc_inventory_items language plpgsql as $$
declare
  r cc_inventory_items;
  existing text;
begin
  if p_item ? 'furniture_item_id' and p_item->>'furniture_item_id' is not null then
    select sku into existing from cc_inventory_items where furniture_item_id = p_item->>'furniture_item_id';
    if found then raise exception 'cc_conflict: already taken into inventory as %', existing; end if;
  end if;
  r := jsonb_populate_record(null::cc_inventory_items, p_item);
  r.id := coalesce(r.id, gen_random_uuid());
  r.sku := 'JAS-' || lpad(nextval('cc_sku_seq')::text, 6, '0');
  r.kind := coalesce(r.kind, 'unique');
  r.quantity := coalesce(r.quantity, 1);
  r.status := coalesce(r.status, 'in_storage');
  r.source := coalesce(r.source, 'manual');
  r.version := 1;
  r.created_by := coalesce(r.created_by, 'system');
  r.created_at := now();
  r.updated_at := now();
  insert into cc_inventory_items select r.*;
  insert into cc_inventory_movements (item_id, type, to_status, to_location, quantity_delta, ref_kind, ref_id, note, actor_email, detail)
  values (r.id, 'intake', r.status, r.location_id, r.quantity, p_movement->>'ref_kind', p_movement->>'ref_id', p_movement->>'note',
          coalesce(p_movement->>'actor_email', 'system'), coalesce(p_movement->'detail', '{}'::jsonb));
  return next r;
exception when unique_violation then
  raise exception 'cc_conflict: already taken into inventory';
end $$;

create or replace function cc_inventory_apply(p_item uuid, p_expect_version integer, p_from text[], p_set jsonb, p_movement jsonb)
returns setof cc_inventory_items language plpgsql as $$
declare
  r  cc_inventory_items;
  n  cc_inventory_items;
  safe jsonb := coalesce(p_set, '{}'::jsonb) - array['id','sku','version','created_at','created_by','source','furniture_item_id'];
begin
  select * into r from cc_inventory_items where id = p_item for update;
  if not found then raise exception 'cc_conflict: item not found'; end if;
  if p_movement->>'ref_id' is not null and exists (
    select 1 from cc_inventory_movements m
     where m.item_id = p_item and m.type = p_movement->>'type' and m.ref_kind is not distinct from p_movement->>'ref_kind' and m.ref_id = p_movement->>'ref_id') then
    return next r;  -- already applied
    return;
  end if;
  if p_expect_version is not null and r.version <> p_expect_version then
    raise exception 'cc_conflict: the item changed since it was loaded';
  end if;
  if p_from is not null and not (r.status = any(p_from)) then
    raise exception 'cc_conflict: the item is %', replace(r.status, '_', ' ');
  end if;
  n := jsonb_populate_record(r, safe);
  update cc_inventory_items set
    title = n.title, description = n.description, category = n.category, kind = n.kind, quantity = n.quantity,
    condition = n.condition, status = n.status, location_id = n.location_id, price_minor = n.price_minor,
    photo_url = n.photo_url, dimensions = n.dimensions, material = n.material, weight_kg = n.weight_kg,
    furniture_project_id = n.furniture_project_id, furniture_project_name = n.furniture_project_name, furniture_apartment = n.furniture_apartment,
    website_product_id = n.website_product_id, reserved_for = n.reserved_for, reserved_until = n.reserved_until,
    reserved_prev_status = n.reserved_prev_status, reserved_website_qty = n.reserved_website_qty,
    sold_channel = n.sold_channel, sold_at = n.sold_at, sold_price_minor = n.sold_price_minor, buyer_contact_id = n.buyer_contact_id,
    website_order_id = n.website_order_id, website_order_number = n.website_order_number, disposition_note = n.disposition_note,
    version = r.version + 1, updated_at = now()
  where id = p_item
  returning * into n;
  insert into cc_inventory_movements (item_id, type, from_status, to_status, from_location, to_location, quantity_delta, ref_kind, ref_id, note, actor_email, detail)
  values (p_item, p_movement->>'type', r.status, n.status, r.location_id, n.location_id, coalesce((p_movement->>'quantity_delta')::integer, n.quantity - r.quantity),
          p_movement->>'ref_kind', p_movement->>'ref_id', p_movement->>'note', coalesce(p_movement->>'actor_email', 'system'), coalesce(p_movement->'detail', '{}'::jsonb));
  return next n;
exception when unique_violation then
  raise exception 'cc_conflict: that website product is already linked to another item';
end $$;

-- ── Leads / pipeline ────────────────────────────────────────────────────────
create table if not exists cc_deals (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid not null references cc_contacts(id) on delete cascade,
  title              text not null,
  stage              text not null default 'new' check (stage in ('new','contacted','qualified','proposal','won','lost')),
  value_minor        integer,
  item_id            uuid references cc_inventory_items(id) on delete set null,
  source             text not null default 'manual',   -- manual, website_form, whatsapp, in_store
  source_ref         text unique,                       -- e.g. website_inquiry:42 — one lead per form message
  next_step          text,
  next_step_at       timestamptz,
  owner_profile_id   uuid references cc_profiles(id) on delete set null,
  last_contacted_at  timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists cc_deals_stage on cc_deals (stage, updated_at desc);
create index if not exists cc_deals_contact on cc_deals (contact_id);

-- ── Interactions (the contact's timeline entries owned here) ────────────────
create table if not exists cc_interactions (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references cc_contacts(id) on delete cascade,
  at           timestamptz not null default now(),
  channel      text not null check (channel in ('whatsapp','phone','email','in_person','website_form','website_order','gift_card','note')),
  direction    text not null default 'none' check (direction in ('in','out','none')),
  summary      text not null,
  ref_kind     text,
  ref_id       text,
  actor_email  text not null
);
create index if not exists cc_interactions_contact on cc_interactions (contact_id, at desc);
create index if not exists cc_interactions_at on cc_interactions (at desc);
create unique index if not exists cc_interactions_ref on cc_interactions (contact_id, ref_kind, ref_id) where ref_id is not null;

-- ── Tasks + automation switches ─────────────────────────────────────────────
create table if not exists cc_tasks (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  detail               text,
  status               text not null default 'open' check (status in ('open','done','cancelled')),
  due_at               timestamptz,
  assignee_profile_id  uuid references cc_profiles(id) on delete set null,
  entity_kind          text check (entity_kind in ('item','contact','deal','delivery','website_order')),
  entity_id            text,
  source               text not null default 'manual',  -- manual | automation:<rule id>
  dedupe_key           text unique,                     -- an automation creates a given task once
  created_by           text not null,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  completed_by         text
);
create index if not exists cc_tasks_open on cc_tasks (status, due_at);

create table if not exists cc_automation_rules (
  id          text primary key,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- ── Deliveries (the logistics schedule; a website order's STATUS stays on the website) ──
create table if not exists cc_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid references cc_inventory_items(id) on delete set null,
  website_order_id      integer,
  website_order_number  text,
  contact_id            uuid references cc_contacts(id) on delete set null,
  address               text,
  scheduled_for         date,
  time_window           text,
  assignee_profile_id   uuid references cc_profiles(id) on delete set null,
  status                text not null default 'planned' check (status in ('planned','out','done','failed','cancelled')),
  note                  text,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists cc_deliveries_open on cc_deliveries (status, scheduled_for);

-- ── Lock it down ────────────────────────────────────────────────────────────
alter table cc_locations            enable row level security;
alter table cc_contacts             enable row level security;
alter table cc_inventory_items      enable row level security;
alter table cc_inventory_movements  enable row level security;
alter table cc_deals                enable row level security;
alter table cc_interactions         enable row level security;
alter table cc_tasks                enable row level security;
alter table cc_automation_rules     enable row level security;
alter table cc_deliveries           enable row level security;
revoke all on cc_locations, cc_contacts, cc_inventory_items, cc_inventory_movements, cc_deals, cc_interactions, cc_tasks, cc_automation_rules, cc_deliveries from anon, authenticated;
revoke all on function cc_inventory_create(jsonb, jsonb) from public, anon, authenticated;
revoke all on function cc_inventory_apply(uuid, integer, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function cc_inventory_create(jsonb, jsonb) to service_role;
grant execute on function cc_inventory_apply(uuid, integer, text[], jsonb, jsonb) to service_role;
