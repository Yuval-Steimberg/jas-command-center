-- 0010 · SKUs continue the Google Sheets serials.
--
-- The items imported from the jas-inventory sheet kept their 4-digit serials
-- (JAS-0001 … JAS-0136). Items created here got a separate 6-digit series
-- (JAS-000001, JAS-000002 …), so the shop had two numberings side by side.
-- From now on every new item takes the highest JAS-number + 1, in the
-- sheet's 4-digit form (JAS-0137, JAS-0138 …; five digits only past 9999).
--
-- The next number is read from the table, not from a sequence, so an item
-- inserted by hand or by an import can never be handed out twice. An
-- advisory lock held to the end of the transaction makes two items created
-- at the same moment take two different numbers (the unique index on sku
-- backs it up).
--
-- The items that already have a 6-digit code are renumbered into the
-- sequence, oldest first. Their old code is kept in previous_sku, and the
-- scanner looks it up, so a label printed with the old barcode still opens
-- the item. Each renumber writes an 'edit' movement (sku: old → new).
-- Sales, deliveries and movements point at the item's id, not its code, and
-- the QR on a label is the item's link, so none of them change.
-- A renumbered item that is already on the website keeps its old website
-- address (jas-000002): the link between them is the product id, so stock and
-- orders still sync; only that product's URL keeps the old number.
--
-- Idempotent: safe to run twice. Requires 0003 and 0006.

alter table cc_inventory_items add column if not exists previous_sku text;
create unique index if not exists cc_inventory_items_previous_sku on cc_inventory_items (previous_sku) where previous_sku is not null;

create or replace function cc_next_sku() returns text language plpgsql as $$
declare
  n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('cc_next_sku'));
  select coalesce(max(substring(sku from '^JAS-(\d+)$')::bigint), 0) + 1 into n
    from cc_inventory_items where sku ~ '^JAS-\d+$';
  return 'JAS-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
end $$;

alter table cc_inventory_items alter column sku set default cc_next_sku();

-- cc_inventory_create as in 0006, with the SKU from cc_next_sku().
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
  r.sku := cc_next_sku();
  r.previous_sku := null;
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

revoke all on function cc_next_sku() from public, anon, authenticated;
grant execute on function cc_next_sku() to service_role;
revoke all on function cc_inventory_create(jsonb, jsonb) from public, anon, authenticated;
grant execute on function cc_inventory_create(jsonb, jsonb) to service_role;

-- ── Renumber the 6-digit items into the sheet's sequence ─────────────────────
-- ONE DO block: the SQL Editor commits statement by statement, so this either
-- renumbers every one of them or none.
do $$
declare
  it record;
  fresh text;
begin
  for it in select id, sku, website_product_id from cc_inventory_items where sku ~ '^JAS-\d{6}$' order by created_at, sku for update loop
    fresh := cc_next_sku();
    update cc_inventory_items
       set sku = fresh, previous_sku = it.sku, version = version + 1, updated_at = now()
     where id = it.id;
    insert into cc_inventory_movements (item_id, type, ref_kind, ref_id, note, actor_email, detail)
    values (it.id, 'edit', 'renumber', it.sku, 'Renumbered into the Google Sheets sequence', 'system',
            jsonb_build_object('fields', jsonb_build_array('sku'), 'changes', jsonb_build_object('sku', jsonb_build_object('from', it.sku, 'to', fresh))));
    raise notice '% → % %', it.sku, fresh, case when it.website_product_id is not null then format(' (website product #%s keeps its old address)', it.website_product_id) else '' end;
  end loop;
end $$;
