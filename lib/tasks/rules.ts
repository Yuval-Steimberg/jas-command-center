/**
 * The built-in automations, listed on /tasks with an on/off switch each
 * (cc_automation_rules). Pure data so pages, the sweep and tests share it.
 * `kind`: task = opens a task; alert = raises an item on the attention list;
 * action = changes a record by itself.
 */
export const AUTOMATION_RULES = [
  { id: 'intake_needs_price', kind: 'task', label: 'Item taken in without price or photo → "prepare for sale" task', detail: 'Due in 3 days, linked to the item.' },
  { id: 'sale_needs_delivery', kind: 'task', label: 'Item sold (website or shop) → "arrange delivery or pickup" task', detail: 'Due in 2 days, linked to the item.' },
  { id: 'website_form_lead', kind: 'task', label: 'Website contact / volunteer / donation form → contact + lead + "reply" task', detail: 'Due next day. One lead per form message.' },
  { id: 'website_order_customer', kind: 'action', label: 'Paid website order → customer record + order on their timeline', detail: 'Matched by email or phone; never overwrites what was typed here.' },
  { id: 'website_product_inventory', kind: 'action', label: 'Product added on the website (phone studio) → inventory item, and website stock changes without an order → "check" task', detail: 'Hourly. New products only; products from before this was switched on are brought in on Inventory → From the website.' },
  { id: 'reservation_expiry', kind: 'action', label: 'Reservation past its date → released (back on sale)', detail: 'Website stock is restored when the item was listed.' },
  { id: 'stale_leads', kind: 'alert', label: 'Lead not contacted for 3 days → attention list', detail: 'New leads only.' },
  { id: 'aging_stock', kind: 'alert', label: 'Item in storage 60+ days and not listed → attention list', detail: 'Info level.' },
  { id: 'overdue_tasks', kind: 'alert', label: 'Open tasks past their due date → attention list', detail: 'Warning level.' },
] as const satisfies readonly { id: string; kind: 'task' | 'alert' | 'action'; label: string; detail: string }[]

export type RuleId = (typeof AUTOMATION_RULES)[number]['id']
