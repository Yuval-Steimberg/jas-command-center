-- JAS Command Center — suppliers: purchase orders and receiving.
--
-- Suppliers are contacts with the `supplier` role (0003). This adds what a
-- supplier relationship needs on top: purchase orders with lines, and a receipt
-- log. Receiving is ONE transaction (cc_po_receive): it locks the order and its
-- lines, refuses more than was ordered, creates the inventory items through
-- cc_inventory_create (so every received unit has an intake movement), and is
-- idempotent per request id, so a double click receives once.
--
-- Same access model as 0001/0003: RLS on, no policies, service role only.
-- Idempotent: safe to run twice. Requires 0003.

-- ── Purchase orders ─────────────────────────────────────────────────────────
create sequence if not exists cc_po_seq;

create table if not exists cc_purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique default ('PO-' || lpad(nextval('cc_po_seq')::text, 5, '0')),
  supplier_id  uuid not null references cc_contacts(id) on delete restrict,
  status       text not null default 'draft' check (status in ('draft','ordered','partial','received','cancelled')),
  expected_at  date,
  note         text,
  ordered_at   timestamptz,
  closed_at    timestamptz,
  version      integer not null default 1,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists cc_purchase_orders_supplier on cc_purchase_orders (supplier_id, created_at desc);
create index if not exists cc_purchase_orders_open on cc_purchase_orders (status, expected_at);

create table if not exists cc_purchase_order_lines (
  id               uuid primary key default gen_random_uuid(),
  po_id            uuid not null references cc_purchase_orders(id) on delete cascade,
  position         integer not null default 0,
  description      text not null,
  category         text,
  quantity         integer not null check (quantity > 0),
  unit_cost_minor  integer check (unit_cost_minor is null or unit_cost_minor >= 0),  -- agorot per unit
  received_qty     integer not null default 0,
  check (received_qty >= 0 and received_qty <= quantity)
);
create index if not exists cc_purchase_order_lines_po on cc_purchase_order_lines (po_id, position);

create table if not exists cc_po_receipts (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references cc_purchase_orders(id) on delete restrict,
  line_id      uuid not null references cc_purchase_order_lines(id) on delete restrict,
  supplier_id  uuid not null references cc_contacts(id) on delete restrict,
  quantity     integer not null check (quantity > 0),
  item_id      uuid not null references cc_inventory_items(id) on delete restrict,
  location_id  uuid references cc_locations(id) on delete set null,
  condition    text,
  request_id   text not null,
  actor_email  text not null,
  at           timestamptz not null default now(),
  unique (request_id, line_id)
);
create index if not exists cc_po_receipts_supplier on cc_po_receipts (supplier_id, at desc);
create index if not exists cc_po_receipts_po on cc_po_receipts (po_id);

-- Items remember where they were bought (immutable provenance: cc_inventory_apply never updates these).
alter table cc_inventory_items add column if not exists purchase_order_id uuid references cc_purchase_orders(id) on delete set null;
alter table cc_inventory_items add column if not exists supplier_id uuid references cc_contacts(id) on delete set null;
alter table cc_inventory_items add column if not exists unit_cost_minor integer;
alter table cc_inventory_items drop constraint if exists cc_inventory_items_source_check;
alter table cc_inventory_items add constraint cc_inventory_items_source_check check (source in ('furniture','manual','purchase'));

-- Create (p_id null) or replace an order's header and lines. Lines can change
-- only while the order is a draft or ordered AND nothing has been received.
create or replace function cc_po_save(p_id uuid, p_expect_version integer, p_header jsonb, p_lines jsonb, p_actor text)
returns setof cc_purchase_orders language plpgsql as $$
declare
  r cc_purchase_orders;
  l jsonb;
  i integer := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'cc_conflict: an order needs at least one line';
  end if;
  if p_id is null then
    insert into cc_purchase_orders (supplier_id, expected_at, note, created_by)
    values ((p_header->>'supplier_id')::uuid, (p_header->>'expected_at')::date, p_header->>'note', coalesce(p_actor, 'system'))
    returning * into r;
  else
    select * into r from cc_purchase_orders where id = p_id for update;
    if not found then raise exception 'cc_conflict: order not found'; end if;
    if p_expect_version is not null and r.version <> p_expect_version then raise exception 'cc_conflict: the order changed since it was loaded'; end if;
    if r.status not in ('draft','ordered') then raise exception 'cc_conflict: the order is %', r.status; end if;
    if exists (select 1 from cc_purchase_order_lines where po_id = p_id and received_qty > 0) then
      raise exception 'cc_conflict: part of this order was already received';
    end if;
    update cc_purchase_orders set
      supplier_id = (p_header->>'supplier_id')::uuid, expected_at = (p_header->>'expected_at')::date, note = p_header->>'note',
      version = r.version + 1, updated_at = now()
    where id = p_id returning * into r;
    delete from cc_purchase_order_lines where po_id = p_id;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into cc_purchase_order_lines (po_id, position, description, category, quantity, unit_cost_minor)
    values (r.id, i, l->>'description', nullif(l->>'category', ''), (l->>'quantity')::integer, (l->>'unit_cost_minor')::integer);
    i := i + 1;
  end loop;
  return next r;
end $$;

-- Receive goods: p_lines = [{line_id, quantity, location_id, condition}].
create or replace function cc_po_receive(p_po uuid, p_lines jsonb, p_request text, p_actor text)
returns setof cc_po_receipts language plpgsql as $$
declare
  po cc_purchase_orders;
  ln cc_purchase_order_lines;
  l jsonb;
  q integer;
  item cc_inventory_items;
  rc cc_po_receipts;
begin
  if exists (select 1 from cc_po_receipts where request_id = p_request and po_id = p_po) then
    return query select * from cc_po_receipts where request_id = p_request and po_id = p_po;  -- already applied
    return;
  end if;
  select * into po from cc_purchase_orders where id = p_po for update;
  if not found then raise exception 'cc_conflict: order not found'; end if;
  if po.status not in ('draft','ordered','partial') then raise exception 'cc_conflict: the order is %', po.status; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'cc_conflict: nothing to receive'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'quantity')::integer;
    select * into ln from cc_purchase_order_lines where id = (l->>'line_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'cc_conflict: that line is not on this order'; end if;
    if q is null or q <= 0 then raise exception 'cc_conflict: quantity must be at least 1'; end if;
    if q > ln.quantity - ln.received_qty then
      raise exception 'cc_conflict: only % of "%" still to come', ln.quantity - ln.received_qty, ln.description;
    end if;
    select * into item from cc_inventory_create(
      jsonb_build_object(
        'title', ln.description, 'category', ln.category, 'kind', case when q > 1 then 'batch' else 'unique' end, 'quantity', q,
        'condition', nullif(l->>'condition', ''), 'location_id', nullif(l->>'location_id', ''), 'source', 'purchase', 'created_by', p_actor,
        'purchase_order_id', p_po, 'supplier_id', po.supplier_id, 'unit_cost_minor', ln.unit_cost_minor),
      jsonb_build_object('ref_kind', 'po_line', 'ref_id', ln.id::text || ':' || p_request, 'note', po.number, 'actor_email', p_actor));
    update cc_purchase_order_lines set received_qty = received_qty + q where id = ln.id;
    insert into cc_po_receipts (po_id, line_id, supplier_id, quantity, item_id, location_id, condition, request_id, actor_email)
    values (p_po, ln.id, po.supplier_id, q, item.id, item.location_id, item.condition, p_request, p_actor)
    returning * into rc;
    return next rc;
  end loop;
  update cc_purchase_orders set
    status = case when exists (select 1 from cc_purchase_order_lines where po_id = p_po and received_qty < quantity) then 'partial' else 'received' end,
    ordered_at = coalesce(ordered_at, now()),
    closed_at = case when exists (select 1 from cc_purchase_order_lines where po_id = p_po and received_qty < quantity) then null else now() end,
    version = version + 1, updated_at = now()
  where id = p_po;
end $$;

-- ── Lock it down ────────────────────────────────────────────────────────────
alter table cc_purchase_orders       enable row level security;
alter table cc_purchase_order_lines  enable row level security;
alter table cc_po_receipts           enable row level security;
revoke all on cc_purchase_orders, cc_purchase_order_lines, cc_po_receipts from anon, authenticated;
revoke all on function cc_po_save(uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function cc_po_receive(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function cc_po_save(uuid, integer, jsonb, jsonb, text) to service_role;
grant execute on function cc_po_receive(uuid, jsonb, text, text) to service_role;
