-- 0016: catalog photos and "goes on the website by itself" (owner, 2026-11-06).
--
-- catalog_photo_url    the studio version of the main photo (Photoroom: background
--                      removed, cream backdrop, soft shadow, light corrected). It
--                      never replaces photo_url: the original is always kept, and
--                      the website gallery gets the untouched originals.
-- catalog_photo_from   the photo_url it was made from. When the main photo changes
--                      the catalog photo is stale and is made again.
-- catalog_photo_off    staff chose "use the original photo" for this item.
-- catalog_photo_error  why the last attempt failed (no automatic retry for the same
--                      photo, so a failing photo never costs money every hour).
-- website_wanted       the item should be on the website shop. It goes up by itself
--                      once it is ready (in storage, photo, approved price, not in
--                      the workshop). Existing items stay false: nothing already in
--                      stock is published by this migration.
-- The two flags are nullable (cc_inventory_create inserts the JSON as given, so a
-- missing key is NULL, not the default): NULL means false everywhere.
-- Idempotent: safe to run again.

alter table cc_inventory_items add column if not exists catalog_photo_url text;
alter table cc_inventory_items add column if not exists catalog_photo_from text;
alter table cc_inventory_items add column if not exists catalog_photo_off boolean default false;
alter table cc_inventory_items add column if not exists catalog_photo_error text;
alter table cc_inventory_items add column if not exists website_wanted boolean default false;

-- The automatic step looks for wanted items that are not on the website yet.
create index if not exists cc_inventory_items_website_wanted on cc_inventory_items (status) where website_wanted;

-- cc_inventory_create populates the whole record from JSON, so it picks the new
-- columns up by itself. cc_inventory_apply lists its columns: same function as
-- 0008 plus the five new ones.
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
    renewal_level = n.renewal_level, before_photo_url = n.before_photo_url, origin = n.origin, notes = n.notes,
    catalog_photo_url = n.catalog_photo_url, catalog_photo_from = n.catalog_photo_from, catalog_photo_off = coalesce(n.catalog_photo_off, false),
    catalog_photo_error = n.catalog_photo_error, website_wanted = coalesce(n.website_wanted, false),
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
