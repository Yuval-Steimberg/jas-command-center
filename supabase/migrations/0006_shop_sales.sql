-- JAS Command Center — the shop counter, photo-first intake and refurbishment.
--
-- Brings the command center level with the separate jas-inventory app:
--   * a shop SALE groups several items (or some units of a lot) for one
--     customer, each line with its own price and its own handover (pickup now,
--     delivery on its own day). cc_sale_create is ONE transaction: every line
--     goes through cc_inventory_apply (row lock + status check + movement), so
--     a basket either sells completely or not at all, and it replays by request
--     id so a double click sells once.
--   * PAYMENTS are recorded by hand per sale (deposit, balance, refund as a
--     negative amount). Nothing here charges a card.
--   * RETURNS of a line, or of some of its units (cc_sale_return), in one
--     transaction with the item going back to stock.
--   * items gain colours, extra photos, a photo hash (duplicate warning), an
--     AI price estimate vs an approved price, and refurbishment fields; a
--     purchase cost can be set on items that did not come from a supplier order.
--
-- Same access model as 0001/0003/0004: RLS on, no policies, service role only.
-- Idempotent: safe to run twice. Requires 0003 and 0004.

-- ── New staff role: shop seller ────────────────────────────────────────────
alter table cc_user_roles drop constraint if exists cc_user_roles_role_check;
alter table cc_user_roles add constraint cc_user_roles_role_check
  check (role in ('owner','admin','operations_manager','project_manager','volunteer_coordinator','seller','viewer'));
alter table cc_role_permissions drop constraint if exists cc_role_permissions_role_check;
alter table cc_role_permissions add constraint cc_role_permissions_role_check
  check (role in ('owner','admin','operations_manager','project_manager','volunteer_coordinator','seller','viewer'));

-- ── Item fields ─────────────────────────────────────────────────────────────
alter table cc_inventory_items add column if not exists colors              text;
alter table cc_inventory_items add column if not exists extra_photos        text[] not null default '{}';
alter table cc_inventory_items add column if not exists photo_hash          text;      -- 64-bit difference hash, 16 hex chars
alter table cc_inventory_items add column if not exists price_approved      boolean not null default true;
alter table cc_inventory_items add column if not exists ai_price_minor      integer;   -- the AI's estimate, kept for comparison
alter table cc_inventory_items add column if not exists refurb_status       text;
alter table cc_inventory_items add column if not exists refurb_level        text;
alter table cc_inventory_items add column if not exists refurb_contact_id   uuid references cc_contacts(id) on delete set null;
alter table cc_inventory_items add column if not exists refurb_instructions text;
alter table cc_inventory_items drop constraint if exists cc_inventory_items_refurb_status_check;
alter table cc_inventory_items add constraint cc_inventory_items_refurb_status_check check (refurb_status is null or refurb_status in ('needed','in_progress','done'));
alter table cc_inventory_items drop constraint if exists cc_inventory_items_refurb_level_check;
alter table cc_inventory_items add constraint cc_inventory_items_refurb_level_check check (refurb_level is null or refurb_level in ('light','medium','full'));
create index if not exists cc_inventory_items_photo_hash on cc_inventory_items (photo_hash) where photo_hash is not null;
create index if not exists cc_inventory_items_refurb on cc_inventory_items (refurb_status) where refurb_status in ('needed','in_progress');

-- ── Shop sales ──────────────────────────────────────────────────────────────
create sequence if not exists cc_sale_seq;

create table if not exists cc_sales (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique default ('S-' || lpad(nextval('cc_sale_seq')::text, 5, '0')),
  contact_id   uuid references cc_contacts(id) on delete set null,
  total_minor  integer not null default 0,     -- Σ quantity × unit price at the time of sale; returns do not change it
  note         text,
  request_id   text not null unique,           -- one checkout form = one sale
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cc_sales_created on cc_sales (created_at desc);
create index if not exists cc_sales_contact on cc_sales (contact_id, created_at desc);

create table if not exists cc_sale_lines (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references cc_sales(id) on delete restrict,
  item_id           uuid not null references cc_inventory_items(id) on delete restrict,
  position          integer not null,
  quantity          integer not null check (quantity > 0),
  unit_price_minor  integer not null check (unit_price_minor >= 0),
  fulfilment        text not null check (fulfilment in ('pickup','delivery')),
  address           text,
  scheduled_for     date,
  time_window       text,
  status            text not null default 'open' check (status in ('open','done','returned')),
  done_at           timestamptz,
  returned_qty      integer not null default 0 check (returned_qty >= 0),
  updated_at        timestamptz not null default now(),
  check (returned_qty <= quantity)
);
create index if not exists cc_sale_lines_sale on cc_sale_lines (sale_id, position);
create index if not exists cc_sale_lines_item on cc_sale_lines (item_id);
create index if not exists cc_sale_lines_open on cc_sale_lines (status) where status = 'open';

create table if not exists cc_sale_payments (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references cc_sales(id) on delete restrict,
  amount_minor  integer not null check (amount_minor <> 0),   -- a refund is negative
  method        text not null check (method in ('cash','card','bit','transfer','grow_link','other')),
  at            timestamptz not null default now(),
  note          text,
  request_id    text not null unique,
  actor_email   text not null
);
create index if not exists cc_sale_payments_sale on cc_sale_payments (sale_id, at);

-- A delivery planned for one sale line (closing the delivery closes the line).
alter table cc_deliveries add column if not exists sale_line_id uuid references cc_sale_lines(id) on delete set null;
create index if not exists cc_deliveries_sale_line on cc_deliveries (sale_line_id) where sale_line_id is not null;

-- ── Item writes: the new columns, and a purchase cost on non-purchase items ──
-- Same contract as 0003: one transaction, row lock, expected status/version,
-- one movement, idempotent replay by movement ref. Supplier provenance
-- (purchase_order_id, supplier_id) and the cost of a RECEIVED item never change.
create or replace function cc_inventory_apply(p_item uuid, p_expect_version integer, p_from text[], p_set jsonb, p_movement jsonb)
returns setof cc_inventory_items language plpgsql as $$
declare
  r  cc_inventory_items;
  n  cc_inventory_items;
  safe jsonb := coalesce(p_set, '{}'::jsonb) - array['id','sku','version','created_at','created_by','source','furniture_item_id','purchase_order_id','supplier_id'];
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
  if r.source = 'purchase' then safe := safe - 'unit_cost_minor'; end if;
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
    unit_cost_minor = n.unit_cost_minor, colors = n.colors, extra_photos = coalesce(n.extra_photos, '{}'), photo_hash = n.photo_hash,
    price_approved = coalesce(n.price_approved, true), ai_price_minor = n.ai_price_minor,
    refurb_status = n.refurb_status, refurb_level = n.refurb_level, refurb_contact_id = n.refurb_contact_id, refurb_instructions = n.refurb_instructions,
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

-- cc_inventory_create inserts the whole populated record, so the new NOT NULL
-- columns need their defaults filled in here (a JSON without them would insert NULL).
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
  r.extra_photos := coalesce(r.extra_photos, '{}');
  r.price_approved := coalesce(r.price_approved, true);
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

-- ── Create a sale: every line or none ───────────────────────────────────────
-- p_header: {contact_id, note, payment: {amount_minor, method, note}?}
-- p_lines:  [{item_id, version?, quantity, unit_price_minor, fulfilment, address?, scheduled_for?, time_window?}]
-- A whole unique item, or the last units of a lot, becomes `sold`; fewer units
-- of a lot only lower its quantity. A delivery line plans its delivery.
create or replace function cc_sale_create(p_header jsonb, p_lines jsonb, p_request text, p_actor text)
returns setof cc_sales language plpgsql as $$
declare
  s     cc_sales;
  l     jsonb;
  it    cc_inventory_items;
  q     integer;
  unit  integer;
  pos   integer := 0;
  lid   uuid;
  did   uuid;
  total bigint := 0;
  setv  jsonb;
  whole boolean;
  seen  uuid[] := '{}';
  sellable constant text[] := array['in_storage','listed','reserved'];
begin
  select * into s from cc_sales where request_id = p_request;
  if found then return next s; return; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'cc_conflict: a sale needs at least one item';
  end if;

  insert into cc_sales (contact_id, note, request_id, created_by)
  values (nullif(p_header->>'contact_id', '')::uuid, nullif(p_header->>'note', ''), p_request, coalesce(p_actor, 'system'))
  returning * into s;

  for l in select * from jsonb_array_elements(p_lines) loop
    pos := pos + 1;
    q := (l->>'quantity')::integer;
    unit := (l->>'unit_price_minor')::integer;
    if q is null or q < 1 then raise exception 'cc_conflict: line % needs a quantity of at least 1', pos; end if;
    if unit is null or unit < 0 then raise exception 'cc_conflict: line % needs a price', pos; end if;
    if (l->>'item_id')::uuid = any(seen) then raise exception 'cc_conflict: the same item is in the basket twice; sell more units on one line'; end if;
    seen := seen || (l->>'item_id')::uuid;

    select * into it from cc_inventory_items where id = (l->>'item_id')::uuid for update;
    if not found then raise exception 'cc_conflict: an item in the basket no longer exists'; end if;
    if not (it.status = any(sellable)) then raise exception 'cc_conflict: % is %', it.sku, replace(it.status, '_', ' '); end if;
    if l->>'version' is not null and it.version <> (l->>'version')::integer then
      raise exception 'cc_conflict: % changed since the basket was loaded', it.sku;
    end if;
    if it.kind = 'unique' and q <> 1 then raise exception 'cc_conflict: % is a single piece', it.sku; end if;
    if q > it.quantity then raise exception 'cc_conflict: only % of % left', it.quantity, it.sku; end if;
    if l->>'fulfilment' not in ('pickup','delivery') then raise exception 'cc_conflict: line % needs pickup or delivery', pos; end if;
    if l->>'fulfilment' = 'delivery' and coalesce(l->>'address', '') = '' then raise exception 'cc_conflict: the delivery of % needs an address', it.sku; end if;

    insert into cc_sale_lines (sale_id, item_id, position, quantity, unit_price_minor, fulfilment, address, scheduled_for, time_window)
    values (s.id, it.id, pos, q, unit, l->>'fulfilment', nullif(l->>'address', ''), nullif(l->>'scheduled_for', '')::date, nullif(l->>'time_window', ''))
    returning id into lid;
    total := total + q::bigint * unit;

    whole := it.kind = 'unique' or q = it.quantity;
    if whole then
      setv := jsonb_build_object('status', 'sold', 'sold_channel', 'in_store', 'sold_at', now(), 'sold_price_minor', q * unit,
                                 'buyer_contact_id', s.contact_id, 'reserved_for', null, 'reserved_until', null,
                                 'reserved_prev_status', null, 'reserved_website_qty', null);
      if it.kind = 'batch' then setv := setv || jsonb_build_object('quantity', 0); end if;
    else
      setv := jsonb_build_object('quantity', it.quantity - q);
    end if;
    perform cc_inventory_apply(it.id, null, sellable, setv, jsonb_build_object(
      'type', 'sell', 'ref_kind', 'sale_line', 'ref_id', lid::text, 'actor_email', coalesce(p_actor, 'system'),
      'quantity_delta', -q, 'note', s.number,
      'detail', jsonb_build_object('channel', 'in_store', 'priceMinor', q * unit, 'units', q, 'saleId', s.id, 'saleNumber', s.number)));

    if l->>'fulfilment' = 'delivery' then
      insert into cc_deliveries (item_id, contact_id, address, scheduled_for, time_window, note, created_by, sale_line_id)
      values (it.id, s.contact_id, l->>'address', nullif(l->>'scheduled_for', '')::date, nullif(l->>'time_window', ''), s.number, coalesce(p_actor, 'system'), lid)
      returning id into did;
    end if;
  end loop;

  if total > 2147483647 then raise exception 'cc_conflict: the sale total is too large'; end if;
  update cc_sales set total_minor = total, updated_at = now() where id = s.id returning * into s;

  if p_header ? 'payment' and jsonb_typeof(p_header->'payment') = 'object' and coalesce((p_header->'payment'->>'amount_minor')::integer, 0) <> 0 then
    insert into cc_sale_payments (sale_id, amount_minor, method, note, request_id, actor_email)
    values (s.id, (p_header->'payment'->>'amount_minor')::integer, coalesce(p_header->'payment'->>'method', 'cash'),
            nullif(p_header->'payment'->>'note', ''), p_request || ':payment', coalesce(p_actor, 'system'));
  end if;
  return next s;
end $$;

-- ── Return a line, or some units of it ──────────────────────────────────────
-- Locks the line and the item. Refuses more than is still out with the
-- customer, and a line whose returned count moved since it was loaded. The item
-- goes back to storage (a lot gets its units back); a fully returned line
-- cancels its planned delivery. The sale record is kept.
create or replace function cc_sale_return(p_line uuid, p_units integer, p_expect_returned integer, p_location uuid, p_reason text, p_actor text)
returns setof cc_sale_lines language plpgsql as $$
declare
  ln   cc_sale_lines;
  s    cc_sales;
  it   cc_inventory_items;
  setv jsonb;
begin
  select * into ln from cc_sale_lines where id = p_line for update;
  if not found then raise exception 'cc_conflict: sale line not found'; end if;
  select * into s from cc_sales where id = ln.sale_id;
  if p_units is null or p_units < 1 then raise exception 'cc_conflict: return at least one unit'; end if;
  if p_expect_returned is not null and ln.returned_qty <> p_expect_returned then raise exception 'cc_conflict: this line changed since it was loaded'; end if;
  if ln.returned_qty + p_units > ln.quantity then raise exception 'cc_conflict: only % still with the customer', ln.quantity - ln.returned_qty; end if;

  select * into it from cc_inventory_items where id = ln.item_id for update;
  if it.kind = 'unique' or it.status in ('sold','delivered') then
    if not (it.status in ('sold','delivered')) then raise exception 'cc_conflict: % is %', it.sku, replace(it.status, '_', ' '); end if;
    setv := jsonb_build_object('status', 'in_storage', 'location_id', coalesce(p_location, it.location_id),
                               'sold_channel', null, 'sold_at', null, 'sold_price_minor', null, 'buyer_contact_id', null,
                               'website_order_id', null, 'website_order_number', null);
    if it.kind = 'batch' then setv := setv || jsonb_build_object('quantity', p_units); end if;
  else
    setv := jsonb_build_object('quantity', it.quantity + p_units);
  end if;
  perform cc_inventory_apply(it.id, null, null, setv, jsonb_build_object(
    'type', 'return', 'ref_kind', 'sale_line_return', 'ref_id', ln.id::text || ':' || (ln.returned_qty + p_units)::text,
    'actor_email', coalesce(p_actor, 'system'), 'quantity_delta', p_units, 'note', p_reason,
    'detail', jsonb_build_object('channel', 'in_store', 'priceMinor', p_units * ln.unit_price_minor, 'units', p_units, 'saleId', s.id, 'saleNumber', s.number)));

  update cc_sale_lines set
    returned_qty = ln.returned_qty + p_units,
    status = case when ln.returned_qty + p_units = ln.quantity then 'returned' else ln.status end,
    updated_at = now()
  where id = ln.id returning * into ln;
  if ln.status = 'returned' then
    update cc_deliveries set status = 'cancelled', note = coalesce(note || ' · ', '') || 'returned', updated_at = now()
     where sale_line_id = ln.id and status in ('planned','failed');
  end if;
  return next ln;
end $$;

-- ── Photos ──────────────────────────────────────────────────────────────────
-- Item photos live in this project's own storage (public read, so a website
-- listing can show them). Uploads go through the server with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-photos', 'inventory-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ── Lock it down ────────────────────────────────────────────────────────────
alter table cc_sales          enable row level security;
alter table cc_sale_lines     enable row level security;
alter table cc_sale_payments  enable row level security;
revoke all on cc_sales, cc_sale_lines, cc_sale_payments from anon, authenticated;
revoke all on function cc_inventory_apply(uuid, integer, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function cc_inventory_create(jsonb, jsonb) from public, anon, authenticated;
grant execute on function cc_inventory_create(jsonb, jsonb) to service_role;
revoke all on function cc_sale_create(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function cc_sale_return(uuid, integer, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function cc_inventory_apply(uuid, integer, text[], jsonb, jsonb) to service_role;
grant execute on function cc_sale_create(jsonb, jsonb, text, text) to service_role;
grant execute on function cc_sale_return(uuid, integer, integer, uuid, text, text) to service_role;
