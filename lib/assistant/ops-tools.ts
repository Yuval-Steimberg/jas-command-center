import 'server-only'
import { z } from 'zod'
import { getOpsStore, OpsSetupError } from '@/lib/ops'
import { locationLabels } from '@/lib/ops/views'
import { ITEM_STATUSES, DEAL_STAGES, type ItemStatus, type DealStage } from '@/lib/ops/types'
import { daysHeld } from '@/lib/inventory/model'
import { daysWithoutContact, OPEN_STAGES } from '@/lib/crm/model'
import { readOps } from '@/lib/analytics/load'
import { crmSection, inventorySection } from '@/lib/analytics/ops'
import { PRESETS, previousPeriod, rangeFor, type Preset } from '@/lib/time'
import type { AssistantTool } from './tools'

/**
 * Read-only tools over the command center's own operational records. Same
 * rules as tools.ts: no contact names, phones or emails ever leave here (a
 * contact is an id plus roles), free text is cut, and a missing migration is
 * reported as not set up, never as an empty list.
 */
const cut = (s: string | null | undefined, n = 120) => (s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s)
const ils = (minor: number | null) => (minor == null ? null : Math.round(minor) / 100)

async function ops<T>(run: () => Promise<T>) {
  try {
    return { status: 'ok', checkedAt: new Date().toISOString(), data: await run() }
  } catch (e) {
    if (e instanceof OpsSetupError) return { status: 'not_configured', missingSettings: ['migration 0003_crm_inventory.sql'], note: 'Customers and inventory are not set up yet.' }
    return { status: 'error', error: cut(e instanceof Error ? e.message : String(e), 300) }
  }
}

const nullableEnum = <T extends string>(values: readonly T[]) => ({ anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }] })

export const OPS_TOOLS: AssistantTool[] = [
  {
    name: 'find_inventory_items',
    label: 'Inventory',
    description:
      'Search the physical inventory (items taken in from furniture collections or added by hand): id, SKU, title, status (in_storage, listed, reserved, sold, delivered, donated, recycled, disposed), condition, location, asking price (₪), category, source project, days since intake, whether it is linked to a website product, reservation end. Empty query + null status = everything on hand. Use the id with get_item_history and the propose_ inventory tools.',
    permission: 'inventory:read',
    input: z.object({ query: z.string().trim().max(100), status: z.enum(ITEM_STATUSES).nullable() }).strict(),
    schema: { type: 'object', properties: { query: { type: 'string', description: 'SKU, words of the title, category or project; empty for all' }, status: { ...nullableEnum(ITEM_STATUSES), description: 'Optional status filter; null = on hand (in storage, listed, reserved, sold)' } }, required: ['query', 'status'], additionalProperties: false },
    run: (input) =>
      ops(async () => {
        const store = getOpsStore()
        const status = input.status as ItemStatus | null
        const [items, locations] = await Promise.all([store.listItems({ q: String(input.query) || undefined, statuses: status ? [status] : ['in_storage', 'listed', 'reserved', 'sold'], limit: 200 }), store.listLocations()])
        const where = locationLabels(locations)
        return {
          currency: 'ILS',
          total: items.length,
          items: items.slice(0, 40).map((i) => ({
            id: i.id, sku: i.sku, title: cut(i.title, 80), status: i.status, condition: i.condition, location: i.locationId ? where.get(i.locationId) ?? null : null,
            askingPrice: ils(i.priceMinor), category: i.category, quantity: i.quantity, project: i.furnitureProjectName, daysSinceIntake: daysHeld(i),
            onWebsite: i.websiteProductId != null, reservedUntil: i.reservedUntil, soldChannel: i.soldChannel,
          })),
        }
      }),
  },
  {
    name: 'get_item_history',
    label: 'Item history',
    description: 'The full movement history of one inventory item (intake, moves, listing, reservations, sale, delivery, return, donation…), oldest first, with who did it. Item ids come from find_inventory_items.',
    permission: 'inventory:read',
    input: z.object({ itemId: z.string().uuid() }).strict(),
    schema: { type: 'object', properties: { itemId: { type: 'string', description: 'Item id from find_inventory_items' } }, required: ['itemId'], additionalProperties: false },
    run: (input) =>
      ops(async () => {
        const store = getOpsStore()
        const item = await store.getItem(String(input.itemId))
        if (!item) return { found: false }
        const ms = await store.movements(item.id)
        return {
          found: true,
          item: { sku: item.sku, title: cut(item.title, 80), status: item.status, source: item.source, project: item.furnitureProjectName, apartment: item.furnitureApartment },
          movements: ms.map((m) => ({ at: m.at, type: m.type, from: m.fromStatus, to: m.toStatus, quantityDelta: m.quantityDelta || undefined, by: m.actorEmail, note: cut(m.note), ref: m.refKind ? `${m.refKind}:${m.refId}` : null })),
        }
      }),
  },
  {
    name: 'get_fulfilment_queue',
    label: 'Fulfilment',
    description: 'What still has to reach a buyer: inventory items sold and not delivered (with how many days since the sale and whether a delivery is planned), open deliveries and their dates, reservations ending soon, and open possible-double-sale checks.',
    permission: 'inventory:read',
    input: z.object({}).strict(),
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run: () =>
      ops(async () => {
        const store = getOpsStore()
        const [sold, reserved, deliveries, tasks] = await Promise.all([
          store.listItems({ statuses: ['sold'], limit: 300 }),
          store.listItems({ statuses: ['reserved'], limit: 300 }),
          store.listDeliveries({ statuses: ['planned', 'out', 'failed'] }),
          store.listTasks({ status: 'open', limit: 500 }),
        ])
        const planned = new Set(deliveries.map((d) => d.itemId))
        return {
          soldNotDelivered: sold.map((i) => ({ id: i.id, sku: i.sku, title: cut(i.title, 60), channel: i.soldChannel, websiteOrder: i.websiteOrderNumber, daysSinceSale: i.soldAt ? Math.floor((Date.now() - Date.parse(i.soldAt)) / 86_400_000) : null, deliveryPlanned: planned.has(i.id) })),
          openDeliveries: deliveries.map((d) => ({ id: d.id, status: d.status, date: d.scheduledFor, window: d.timeWindow, itemId: d.itemId, websiteOrder: d.websiteOrderNumber })),
          reservations: reserved.map((i) => ({ id: i.id, sku: i.sku, title: cut(i.title, 60), until: i.reservedUntil })),
          doubleSaleChecks: tasks.filter((t) => t.source === 'automation:double_sale').map((t) => ({ title: cut(t.title), detail: cut(t.detail, 200), itemId: t.entityId })),
        }
      }),
  },
  {
    name: 'find_leads',
    label: 'Leads',
    description: `Open (or filtered) leads in the pipeline: lead id, contact id, stage (${DEAL_STAGES.join(', ')}), where it came from, value (₪), days since last contact, next step. staleOnly = new leads nobody has contacted for 3+ days. Never returns names, phones or emails.`,
    permission: 'crm:read',
    input: z.object({ stage: z.enum(DEAL_STAGES).nullable(), staleOnly: z.boolean() }).strict(),
    schema: { type: 'object', properties: { stage: { ...nullableEnum(DEAL_STAGES), description: 'null = every open stage' }, staleOnly: { type: 'boolean' } }, required: ['stage', 'staleOnly'], additionalProperties: false },
    run: (input, ctx) =>
      ops(async () => {
        const stage = input.stage as DealStage | null
        let deals = await getOpsStore().listDeals({ stages: stage ? [stage] : OPEN_STAGES, limit: 500 })
        if (input.staleOnly) deals = deals.filter((d) => d.stage === 'new' && daysWithoutContact(d) >= 3)
        // Lead titles can carry what a person wrote; only roles that may see personal data get them.
        const pii = ctx.can('crm:read_pii')
        return {
          currency: 'ILS',
          total: deals.length,
          leads: deals.slice(0, 50).map((d) => ({ id: d.id, contactId: d.contactId, stage: d.stage, source: d.source, title: pii ? cut(d.title, 80) : null, value: ils(d.valueMinor), daysSinceContact: daysWithoutContact(d), nextStep: pii ? cut(d.nextStep, 80) : null })),
        }
      }),
  },
  {
    name: 'find_contacts',
    label: 'Contacts',
    description: 'Find a contact by the name, phone or email the user gave, to get their contact id (for propose_inventory_reserve). Returns only id, roles, where they came from and when they were added: never names, phones or emails.',
    permission: 'crm:read_pii',
    input: z.object({ query: z.string().trim().min(2).max(100) }).strict(),
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Name, phone or email exactly as the user said it' } }, required: ['query'], additionalProperties: false },
    run: (input) =>
      ops(async () => {
        const cs = await getOpsStore().listContacts({ q: String(input.query), limit: 20 })
        return { total: cs.length, contacts: cs.map((c) => ({ id: c.id, roles: c.roles, source: c.source, addedAt: c.createdAt })) }
      }),
  },
  {
    name: 'get_open_tasks',
    label: 'Tasks',
    description: 'Open tasks, soonest due first: title, due date, overdue flag, what it is about (item / contact / lead / delivery / website order) and whether an automation opened it.',
    permission: 'inventory:read',
    input: z.object({ overdueOnly: z.boolean() }).strict(),
    schema: { type: 'object', properties: { overdueOnly: { type: 'boolean' } }, required: ['overdueOnly'], additionalProperties: false },
    run: (input, ctx) =>
      ops(async () => {
        const now = Date.now()
        let tasks = await getOpsStore().listTasks({ status: 'open', limit: 500 })
        if (input.overdueOnly) tasks = tasks.filter((t) => t.dueAt && Date.parse(t.dueAt) < now)
        const pii = ctx.can('crm:read_pii')
        return {
          total: tasks.length,
          tasks: tasks.slice(0, 50).map((t) => {
            const personal = (t.entityKind === 'contact' || t.entityKind === 'deal') && !pii
            return { id: t.id, title: personal ? 'Follow-up with a contact' : cut(t.title, 100), due: t.dueAt, overdue: !!t.dueAt && Date.parse(t.dueAt) < now, about: t.entityKind, aboutId: t.entityId, source: t.source }
          }),
        }
      }),
  },
  {
    name: 'get_inventory_performance',
    label: 'Inventory & customer performance',
    description:
      'Inventory and customer KPIs for a period, each compared with the period before: items taken in, sold in the shop (count and ₪), inventory items sold online (count only: their money is website revenue), donated/recycled, days from intake to sale; and now: available, unlisted, unlisted 60+ days, sold not delivered. With customer access also new contacts, new and won leads, open and waiting leads. Never add in-store value to website revenue.',
    permission: 'inventory:read',
    input: z.object({ period: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]) }).strict(),
    schema: { type: 'object', properties: { period: { type: 'string', enum: Object.keys(PRESETS) } }, required: ['period'], additionalProperties: false },
    run: async (input, ctx) => {
      const range = rangeFor(input.period as Preset)
      const previous = previousPeriod(range)
      const r = await readOps(previous.from)
      if (r.state !== 'ok') return r.state === 'not_configured' ? { status: 'not_configured', missingSettings: ['migration 0003_crm_inventory.sql'] } : { status: 'error', error: cut(r.detail, 300) }
      const sections = [inventorySection(r, range, previous), ...(ctx.can('crm:read') ? [crmSection(r, range, previous)] : [])]
      return {
        status: 'ok',
        checkedAt: r.checkedAt,
        data: {
          range, previous, currency: 'ILS',
          // In-store takings only for roles that record sales (inventory:financial); the counts are for everyone.
          metrics: sections.flatMap((s) => s.metrics.filter((m) => m.unit !== 'agorot' || ctx.can('inventory:financial')).map((m) => ({ id: m.id, label: m.label, basis: m.basis, quality: m.quality, value: m.unit === 'agorot' ? ils(m.value) : m.value, previous: m.unit === 'agorot' ? ils(m.previous) : m.previous, note: m.note ?? null }))),
          notes: sections.flatMap((s) => s.notes),
        },
      }
    },
  },
]

