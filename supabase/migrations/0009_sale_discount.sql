-- 0009 · A discount and a coupon code on a shop sale.
--
-- The discount is given on the whole sale. The app spreads it over the lines
-- in proportion to their value (lib/sales/model.ts spreadDiscount) and sends
-- each line's share; this function checks the shares and keeps their sum on
-- the sale. So the line, the item's sold price, the analytics movement and a
-- later return all carry what the customer actually paid.
--
-- The coupon code is recorded as typed. It is NOT checked against the
-- website's discount codes or the gift cards.
--
-- Idempotent: safe to run twice. Requires 0006.

alter table cc_sales add column if not exists discount_minor integer not null default 0;
alter table cc_sales add column if not exists coupon_code text;
alter table cc_sales drop constraint if exists cc_sales_discount_check;
alter table cc_sales add constraint cc_sales_discount_check check (discount_minor >= 0);
alter table cc_sales drop constraint if exists cc_sales_coupon_check;
alter table cc_sales add constraint cc_sales_coupon_check check (coupon_code is null or char_length(coupon_code) between 1 and 60);
comment on column cc_sales.total_minor is 'Σ line values after the discount at the time of sale; returns do not change it';

alter table cc_sale_lines add column if not exists discount_minor integer not null default 0;
alter table cc_sale_lines drop constraint if exists cc_sale_lines_discount_check;
alter table cc_sale_lines add constraint cc_sale_lines_discount_check check (discount_minor >= 0 and discount_minor <= quantity::bigint * unit_price_minor);

-- ── Create a sale: every line or none (0006 + the discount) ─────────────────
-- p_header: {contact_id, note, coupon_code?, payment: {amount_minor, method, note}?}
-- p_lines:  [{item_id, version?, quantity, unit_price_minor, discount_minor?, fulfilment, address?, scheduled_for?, time_window?}]
create or replace function cc_sale_create(p_header jsonb, p_lines jsonb, p_request text, p_actor text)
returns setof cc_sales language plpgsql as $$
declare
  s     cc_sales;
  l     jsonb;
  it    cc_inventory_items;
  q     integer;
  unit  integer;
  disc  integer;
  paid  integer;
  pos   integer := 0;
  lid   uuid;
  did   uuid;
  total bigint := 0;
  dsum  bigint := 0;
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

  insert into cc_sales (contact_id, note, coupon_code, request_id, created_by)
  values (nullif(p_header->>'contact_id', '')::uuid, nullif(p_header->>'note', ''), nullif(btrim(coalesce(p_header->>'coupon_code', '')), ''), p_request, coalesce(p_actor, 'system'))
  returning * into s;

  for l in select * from jsonb_array_elements(p_lines) loop
    pos := pos + 1;
    q := (l->>'quantity')::integer;
    unit := (l->>'unit_price_minor')::integer;
    disc := coalesce((l->>'discount_minor')::integer, 0);
    if q is null or q < 1 then raise exception 'cc_conflict: line % needs a quantity of at least 1', pos; end if;
    if unit is null or unit < 0 then raise exception 'cc_conflict: line % needs a price', pos; end if;
    if disc < 0 or disc::bigint > q::bigint * unit then raise exception 'cc_conflict: the discount on line % is larger than the line', pos; end if;
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

    insert into cc_sale_lines (sale_id, item_id, position, quantity, unit_price_minor, discount_minor, fulfilment, address, scheduled_for, time_window)
    values (s.id, it.id, pos, q, unit, disc, l->>'fulfilment', nullif(l->>'address', ''), nullif(l->>'scheduled_for', '')::date, nullif(l->>'time_window', ''))
    returning id into lid;
    paid := q * unit - disc;
    total := total + paid;
    dsum := dsum + disc;

    whole := it.kind = 'unique' or q = it.quantity;
    if whole then
      setv := jsonb_build_object('status', 'sold', 'sold_channel', 'in_store', 'sold_at', now(), 'sold_price_minor', paid,
                                 'buyer_contact_id', s.contact_id, 'reserved_for', null, 'reserved_until', null,
                                 'reserved_prev_status', null, 'reserved_website_qty', null);
      if it.kind = 'batch' then setv := setv || jsonb_build_object('quantity', 0); end if;
    else
      setv := jsonb_build_object('quantity', it.quantity - q);
    end if;
    perform cc_inventory_apply(it.id, null, sellable, setv, jsonb_build_object(
      'type', 'sell', 'ref_kind', 'sale_line', 'ref_id', lid::text, 'actor_email', coalesce(p_actor, 'system'),
      'quantity_delta', -q, 'note', s.number,
      'detail', jsonb_build_object('channel', 'in_store', 'priceMinor', paid, 'units', q, 'saleId', s.id, 'saleNumber', s.number)));

    if l->>'fulfilment' = 'delivery' then
      insert into cc_deliveries (item_id, contact_id, address, scheduled_for, time_window, note, created_by, sale_line_id)
      values (it.id, s.contact_id, l->>'address', nullif(l->>'scheduled_for', '')::date, nullif(l->>'time_window', ''), s.number, coalesce(p_actor, 'system'), lid)
      returning id into did;
    end if;
  end loop;

  if total > 2147483647 or dsum > 2147483647 then raise exception 'cc_conflict: the sale total is too large'; end if;
  update cc_sales set total_minor = total, discount_minor = dsum, updated_at = now() where id = s.id returning * into s;

  if p_header ? 'payment' and jsonb_typeof(p_header->'payment') = 'object' and coalesce((p_header->'payment'->>'amount_minor')::integer, 0) <> 0 then
    insert into cc_sale_payments (sale_id, amount_minor, method, note, request_id, actor_email)
    values (s.id, (p_header->'payment'->>'amount_minor')::integer, coalesce(p_header->'payment'->>'method', 'cash'),
            nullif(p_header->'payment'->>'note', ''), p_request || ':payment', coalesce(p_actor, 'system'));
  end if;
  return next s;
end $$;

-- ── Return a line, or some units of it (0006 + the discount) ────────────────
-- The returned units are valued at what was paid for them: the line's discount
-- share in proportion to the units, all of it when the whole line comes back
-- (same rounding as lib/sales/model.ts discountFor).
create or replace function cc_sale_return(p_line uuid, p_units integer, p_expect_returned integer, p_location uuid, p_reason text, p_actor text)
returns setof cc_sale_lines language plpgsql as $$
declare
  ln   cc_sale_lines;
  s    cc_sales;
  it   cc_inventory_items;
  setv jsonb;
  val  bigint;
begin
  select * into ln from cc_sale_lines where id = p_line for update;
  if not found then raise exception 'cc_conflict: sale line not found'; end if;
  select * into s from cc_sales where id = ln.sale_id;
  if p_units is null or p_units < 1 then raise exception 'cc_conflict: return at least one unit'; end if;
  if p_expect_returned is not null and ln.returned_qty <> p_expect_returned then raise exception 'cc_conflict: this line changed since it was loaded'; end if;
  if ln.returned_qty + p_units > ln.quantity then raise exception 'cc_conflict: only % still with the customer', ln.quantity - ln.returned_qty; end if;
  val := p_units::bigint * ln.unit_price_minor
         - (floor(ln.discount_minor::numeric * (ln.returned_qty + p_units) / ln.quantity) - floor(ln.discount_minor::numeric * ln.returned_qty / ln.quantity))::bigint;

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
    'detail', jsonb_build_object('channel', 'in_store', 'priceMinor', val, 'units', p_units, 'saleId', s.id, 'saleNumber', s.number)));

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

revoke all on function cc_sale_create(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function cc_sale_return(uuid, integer, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function cc_sale_create(jsonb, jsonb, text, text) to service_role;
grant execute on function cc_sale_return(uuid, integer, integer, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
