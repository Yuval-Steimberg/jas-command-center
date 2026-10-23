import 'server-only'
import { z } from 'zod'
import { getOpsStore } from '@/lib/ops'
import { contactLabel } from '@/lib/ops/views'
import { can, draftProduct } from '@/lib/inventory/model'
import { listOnWebsite, reserveItem } from '@/lib/inventory/service'
import { formatAgorot } from '@/lib/money'
import type { ProposalDef } from './proposals'

/**
 * Inventory and task actions the assistant may propose. Same contract as
 * proposals.ts: prepare looks the item up and describes it from the record
 * (never from model text); execute runs only on the person's Confirm and calls
 * the same service functions as the inventory pages. Stock-affecting actions
 * carry the item's version from prepare, so an item that changed between the
 * card and the click is refused rather than overwritten.
 */
const str = (description: string) => ({ type: 'string' as const, description })
const actorOf = (a: { email: string }) => ({ email: a.email, name: a.email })

const listParams = z.object({ itemId: z.string().uuid() }).strict()
const listExec = listParams.extend({ version: z.number().int().positive() }).strict()
const reserveParams = z.object({ itemId: z.string().uuid(), contactId: z.string().uuid(), days: z.number().int().min(1).max(30), note: z.string().trim().max(300).nullable() }).strict()
const reserveExec = reserveParams.extend({ version: z.number().int().positive() }).strict()
const taskParams = z.object({ title: z.string().trim().min(3).max(200), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), itemId: z.string().uuid().nullable() }).strict()

async function itemFor(id: string) {
  const item = await getOpsStore().getItem(id)
  return item ?? null
}

export const OPS_PROPOSALS: ProposalDef[] = [
  {
    kind: 'inventory_list_on_website',
    label: 'List an inventory item on the website',
    description: 'Propose creating an UNPUBLISHED website product from an inventory item (needs an asking price and a photo); the website then owns its price, stock and visibility. Use find_inventory_items first. Nothing changes until the user confirms; publishing is a separate step on the item page.',
    product: 'inventory',
    permissions: ['inventory:write', 'website:write'],
    params: listParams,
    schema: { type: 'object', properties: { itemId: str('Item id from find_inventory_items') }, required: ['itemId'], additionalProperties: false },
    async prepare(raw) {
      const p = listParams.parse(raw)
      const item = await itemFor(p.itemId)
      if (!item) return { ok: false, reason: 'No inventory item with that id.' }
      if (!can('list', item.status)) return { ok: false, reason: `${item.sku} is ${item.status.replace('_', ' ')}; only items in storage can be listed.` }
      const draft = draftProduct(item)
      if (!draft.ok) return { ok: false, reason: draft.reason }
      return { ok: true, params: { ...p, version: item.version }, summary: `Create an unpublished website product for ${item.sku} "${item.title}" at ${formatAgorot(item.priceMinor!)}, quantity ${item.quantity}. It stays hidden until someone publishes it.` }
    },
    async execute(raw, actor) {
      const p = listExec.parse(raw)
      const r = await listOnWebsite(p.itemId, p.version, {}, actorOf(actor))
      return { ok: r.ok, message: r.ok && 'warning' in r && r.warning ? `${r.message} ${r.warning}` : r.message }
    },
  },
  {
    kind: 'inventory_reserve',
    label: 'Reserve an inventory item for a customer',
    description: 'Propose reserving an item for a contact for 1–30 days. A listed item is taken off sale on the website meanwhile (its stock goes to 0) and comes back when the reservation ends. Get the item id from find_inventory_items and the contact id from find_contacts. Nothing changes until the user confirms.',
    product: 'inventory',
    permissions: ['inventory:operate', 'crm:read_pii', 'website:write'],
    params: reserveParams,
    schema: {
      type: 'object',
      properties: { itemId: str('Item id from find_inventory_items'), contactId: str('Contact id from find_contacts'), days: { type: 'integer', description: 'How many days, 1 to 30' }, note: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional note' } },
      required: ['itemId', 'contactId', 'days', 'note'],
      additionalProperties: false,
    },
    async prepare(raw) {
      const p = reserveParams.parse(raw)
      const store = getOpsStore()
      const [item, contact] = await Promise.all([itemFor(p.itemId), store.getContact(p.contactId)])
      if (!item) return { ok: false, reason: 'No inventory item with that id.' }
      if (!contact) return { ok: false, reason: 'No contact with that id.' }
      if (!can('reserve', item.status)) return { ok: false, reason: `${item.sku} is ${item.status.replace('_', ' ')}; it cannot be reserved.` }
      // The card is also sent back to the model: the contact is named by number and roles, never by name.
      return { ok: true, params: { ...p, version: item.version }, summary: `Reserve ${item.sku} "${item.title}" for ${contactLabel(contact, false)} for ${p.days} day(s).${item.status === 'listed' ? ' It shows as sold out on the website meanwhile.' : ''}` }
    },
    async execute(raw, actor) {
      const p = reserveExec.parse(raw)
      const r = await reserveItem(p.itemId, p.version, p.contactId, p.days, p.note, actorOf(actor))
      return { ok: r.ok, message: r.message }
    },
  },
  {
    kind: 'task_create',
    label: 'Add a task',
    description: 'Propose adding a follow-up task, optionally due on a date and linked to an inventory item. Nothing is created until the user confirms.',
    product: 'inventory',
    permissions: ['inventory:operate'],
    params: taskParams,
    schema: {
      type: 'object',
      properties: { title: str('What needs doing'), dueDate: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD or null' }, itemId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Item id from find_inventory_items, or null' } },
      required: ['title', 'dueDate', 'itemId'],
      additionalProperties: false,
    },
    async prepare(raw) {
      const p = taskParams.parse(raw)
      if (p.dueDate && Number.isNaN(Date.parse(p.dueDate))) return { ok: false, reason: 'That due date is not a date.' }
      const item = p.itemId ? await itemFor(p.itemId) : null
      if (p.itemId && !item) return { ok: false, reason: 'No inventory item with that id.' }
      return { ok: true, params: p, summary: `Add the task "${p.title}"${p.dueDate ? `, due ${p.dueDate}` : ''}${item ? `, about ${item.sku} "${item.title}"` : ''}.` }
    },
    async execute(raw, actor) {
      const p = taskParams.parse(raw)
      await getOpsStore().createTask({ title: p.title, dueAt: p.dueDate ? `${p.dueDate}T18:00:00.000Z` : null, entityKind: p.itemId ? 'item' : null, entityId: p.itemId, source: 'assistant', createdBy: actor.email })
      return { ok: true, message: 'Task added.' }
    },
  },
]

export const OPS_EXEC_PARAMS: Record<string, z.ZodType<Record<string, unknown>>> = {
  inventory_list_on_website: listExec,
  inventory_reserve: reserveExec,
  task_create: taskParams,
}
