# Customers, inventory and fulfilment

The command center's own operational modules (migration `0003_crm_inventory.sql`).
Everything else in the console reads a source system; these keep records that no
source owns. Gap map with what is live, built, blocked and conflicting:
https://claude.ai/artifact/Fb4yBjgibHstr2oM8z6SZX

## Who owns what

| Record | Owner | Here |
| --- | --- | --- |
| Physical item after intake (SKU, location, condition, reservation, in-store sale, donation, recycling) | **Command center** `cc_inventory_items` | read + write |
| Item movements (every change, append-only, idempotent by ref) | **Command center** `cc_inventory_movements` | append only |
| Contacts, roles, leads, timeline, tasks, deliveries, automation switches | **Command center** `cc_contacts`, `cc_deals`, `cc_interactions`, `cc_tasks`, `cc_deliveries`, `cc_automation_rules` | read + write |
| Listed item's price, publish state, stock; every website order and its payment | **Website** | read live; stock via the guarded `stock-set` (website PR #37) |
| Field item before intake (description, photo, collected) | **Furniture-Collect** | read; never written |
| Gift card balances, codes, sales | **gift_card_system** | read live, masked codes |
| Regular shop products that never came through intake | **Website** | listed read-only on `/inventory` |

No stock, order or money figure is copied: an item linked to a website product
reads the website's quantity and price live, and in-store sales (the one money
figure kept here) are never added to website revenue or gift card figures.

## Flows

- **Furniture → Inventory.** `/inventory/intake` lists collected `jas_collection`
  items. Confirming creates one item per field item (unique `furniture_item_id`, so a
  second intake is refused); a field item with quantity > 1 becomes one record
  carrying that quantity (`kind = batch`).
- **Inventory → Website.** "List on website" creates an UNPUBLISHED product
  (slug `jas-000123`, needs a price and an https photo) and links it; publishing is a
  separate click. From then on the website owns price, visibility and stock.
- **Sold in exactly one place.** Reserving, selling in the shop, donating or
  recycling a listed item first sets the website stock to 0 with a compare-and-set
  (`expectQuantity`, refused while a checkout holds the unit), then changes the item
  atomically (`cc_inventory_apply`: row lock + expected status/version). If the
  second step fails, the website stock is put back. Releasing a reservation restores
  it. The website's own payment webhook now decrements atomically (PR #37).
- **Website → Orders → CRM → Inventory.** `lib/sync/run.ts`, hourly from
  `/api/cron/sweep` and on "Sync now" (`/sales`): paid orders become customer contacts
  (matched by normalised email/phone; never overwrites typed data) with the order on
  their timeline; an order line for a linked product sells that item (or reduces a
  batch); a delivered order marks it delivered; anything that does not add up (an
  item already sold, reserved, or a cancelled order) becomes an
  `automation:double_sale` task and a critical alert, never a second sale.
- **Website forms → leads.** Contact / volunteer / donation messages become a
  contact, one lead (`source_ref website_inquiry:<id>`) and a reply task.
- **Gift cards → CRM.** Read live on the contact page by exact email (bought or
  received), masked codes. Not copied.
- **WhatsApp → CRM.** There is no customer WhatsApp inbox: the connected number is
  the owner's design agent. Staff log WhatsApp conversations on the contact
  (`wa.me` link from the phone). Logging an outgoing contact moves a new lead to
  "contacted".
- **Fulfilment.** `/deliveries`: plan for a sold item or a website order number;
  "Delivered" closes the delivery (conditional on its status), marks the item
  delivered and the website order delivered (website's guarded fulfilment write).
- **Everything → Dashboard.** Overview cards, alerts (`ops:*`), activity feed
  (movements, logged contacts), search (items; contacts with `crm:read_pii`),
  analytics sections `Inventory` and `Customers & leads` (catalog ids `inv.*`,
  `crm.*`), assistant tools, production check probes.

## Permissions

New products in `PRODUCTS`: `crm`, `inventory`.
- owner: everything. admin: everything except gift card money (`inventory:financial` included).
- operations_manager: read/operate both, `crm:read_pii`, `crm:write`, `inventory:write`.
- project_manager: `inventory:read`, `inventory:operate` (intake is the end of their flow).
- viewer: read, no personal data.

In-store sale and return need `inventory:financial`; anything that changes a listed
item also needs `website:write`; automation switches need `crm:write` + `inventory:write`.
Every write goes through `runAct` (`lib/ops/act.ts`): permission check, audit
`requested`, run, audit outcome.

## Assistant

Read: `find_inventory_items`, `get_item_history`, `get_fulfilment_queue`,
`find_leads`, `find_contacts` (ids only), `get_open_tasks`,
`get_inventory_performance` (in-store ₪ only with `inventory:financial`).
Confirm-only: `propose_inventory_list_on_website`, `propose_inventory_reserve`,
`propose_task_create`. Proposals carry the item's version, so an item that changed
between the card and the click is refused.

## Owner steps

1. Run `supabase/migrations/0003_crm_inventory.sql` in the command center Supabase SQL editor. Until then every page says so (never zeros).
2. Merge and deploy website PR #37 (atomic decrement + `stock-set`); without it listing and reservations of listed items are refused by the website.
3. Name the storage locations on `/inventory/locations`.
4. Decide: a customer WhatsApp Business number (would replace hand logging), whether map places should link to projects, and whether suppliers/procurement need more than contacts with the supplier role.

## Deliberately minimal

Warehouses are a location tree (warehouse › zone › shelf). Barcode = the SKU in a
QR label (`/inventory/labels`, scanned by `/inventory/scan` with a USB scanner or
the phone camera). Suppliers are contacts with the supplier role; no purchase
orders. Returns put the item back in stock and say that the money goes back through
Grow or the till: nothing here moves money.
