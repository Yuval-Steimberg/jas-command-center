import 'server-only'
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { Permission } from '@/lib/auth/rbac'
import { allHealth } from '@/lib/integrations/registry'
import { getWebsiteSnapshot } from '@/lib/integrations/website/adapter'
import { getGiftCardSummary } from '@/lib/integrations/gift-cards/adapter'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getDesignAgentHealthz, getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { getMapData } from '@/lib/integrations/map/adapter'
import { deriveAlerts } from '@/lib/alerts'
import { PRESETS, previousPeriod, rangeFor, type Preset } from '@/lib/time'
import type { SourceResult } from '@/lib/integrations/types'
import { searchGiftCards } from '@/lib/integrations/gift-cards/adapter'
import { listWebsiteOrders, listWebsiteProducts, ORDER_STATUSES } from '@/lib/integrations/website/manage'
import { PROPOSALS, PROPOSAL_TOOL_PREFIX, type ProposalDef } from './proposals'

/**
 * The assistant's whole reach: typed READ-ONLY functions over the same
 * adapters the pages use, plus `propose_*` tools that only describe an action
 * for the person to confirm on screen (lib/assistant/proposals.ts). There is
 * no SQL, no URL and no write here — a tool the model asks for that is not in
 * this list does not exist. Each tool names
 * the permission it needs; the user's own role decides which tools are even
 * offered, and run() re-checks before executing.
 *
 * Results are trimmed to what an answer needs: no gift card codes, no customer
 * contact data, no WhatsApp message ids, and long free-text error strings are
 * cut, because everything returned here is sent to the model provider.
 */
export interface ToolContext {
  can: (permission: Permission) => boolean
}

export interface AssistantTool {
  name: string
  /** What the person sees ("Checked: website, gift cards"). */
  label: string
  description: string
  permission: Permission
  input: z.ZodType<Record<string, unknown>>
  schema: Anthropic.Beta.BetaTool['input_schema']
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
  /** Set on propose_* tools: running one prepares a proposal and changes nothing. */
  proposal?: ProposalDef
}

const noInput = z.object({}).strict()
const NO_INPUT_SCHEMA = { type: 'object' as const, properties: {}, additionalProperties: false, required: [] }

const cut = (s: string | null | undefined, n = 200) => (s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s)
const ils = (minor: number) => Math.round(minor) / 100

/** A missing or failing source is reported as such — the model must never see it as zeros. */
function shape<T>(r: SourceResult<T>, view: (data: T) => unknown) {
  if (r.state === 'not_configured') return { status: 'not_configured', missingSettings: r.missing, note: r.note ?? null }
  if (r.state === 'error') return { status: 'error', error: cut(r.error, 300), checkedAt: r.checkedAt }
  return { status: 'ok', checkedAt: r.checkedAt, data: view(r.data) }
}

const presetInput = z.object({ period: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]) }).strict()

export const TOOLS: readonly AssistantTool[] = [
  {
    name: 'get_system_health',
    label: 'System health',
    description:
      'Live health of every connected Just A Second product (website, gift cards, furniture collection, design agent, map): overall status and each individual check with its detail, time and latency. "unknown" means the product is not configured in the command center, not that it is down.',
    permission: 'integrations:read',
    input: noInput,
    schema: NO_INPUT_SCHEMA,
    run: async () => ({ status: 'ok', checkedAt: new Date().toISOString(), data: await allHealth() }),
  },
  {
    name: 'get_alerts',
    label: 'Alerts',
    description:
      'The current attention list: problems a person should look at (a product down, paid gift cards not delivered, failed design-agent jobs, website payment failures). Only alerts for products the signed-in user may read are returned.',
    permission: 'integrations:read',
    input: noInput,
    schema: NO_INPUT_SCHEMA,
    run: async (_input, ctx) => {
      const [health, giftSummary, agentStatus, website] = await Promise.all([
        allHealth(),
        ctx.can('gift_cards:read') ? getGiftCardSummary() : undefined,
        ctx.can('design_agent:read') ? getDesignAgentStatus() : undefined,
        ctx.can('website:read') ? getWebsiteSnapshot(rangeFor('7d')) : undefined,
      ])
      const alerts = deriveAlerts({ health, giftSummary, agentStatus, website }).filter((a) => ctx.can(`${a.product}:read`))
      return { status: 'ok', checkedAt: new Date().toISOString(), data: alerts.map(({ severity, product, title, detail }) => ({ severity, product, title, detail })) }
    },
  },
  {
    name: 'get_website_metrics',
    label: 'Website & shop analytics',
    description:
      'Website and online shop analytics for a period, compared with the equally long period before it: visitors, sessions, orders, revenue (₪), conversion, funnel, channels, devices, payment and technical errors. Each KPI carries an availability status: "unavailable" or "partial" means the data does not exist for that period and must not be read as zero. Revenue here is the website shop only; it is a different system from the gift card platform and the two must never be added together.',
    permission: 'website:read',
    input: presetInput,
    schema: {
      type: 'object',
      properties: { period: { type: 'string', enum: Object.keys(PRESETS), description: 'today, 7d, 30d, mtd (month to date) or 90d. Israel time.' } },
      required: ['period'],
      additionalProperties: false,
    },
    run: async (input) => {
      const period = input.period as Preset
      const range = rangeFor(period)
      return shape(await getWebsiteSnapshot(range), (s) => ({
        currency: 'ILS',
        range: s.range,
        comparedWith: s.compare ?? previousPeriod(range),
        coverage: s.coverage,
        kpis: s.kpis,
        sales: s.sales,
        funnel: s.funnel,
        channels: s.channels.slice(0, 8),
        devices: s.devices,
        technical: {
          jsErrors: s.technical.jsErrors.slice(0, 5).map((e) => ({ ...e, message: cut(e.message, 160) })),
          apiErrors: s.technical.apiErrors.slice(0, 5),
          checkoutErrors: s.technical.checkoutErrors.slice(0, 5).map((e) => ({ ...e, reason: cut(e.reason, 160) })),
        },
      }))
    },
  },
  {
    name: 'get_gift_card_summary',
    label: 'Gift card sales and delivery',
    description:
      'Gift card platform (gift.justasecond.co.il) totals: cards sold (all time, last 24 h, 7 d, 30 d rolling), total sales, outstanding balance (liability), redeemed value, card states, and delivery health over the reconciliation window — payments that matched no card, paid cards never activated, and active cards never delivered. Amounts are in ₪. Counts only: no codes, names or emails.',
    permission: 'gift_cards:read',
    input: noInput,
    schema: NO_INPUT_SCHEMA,
    run: async () =>
      shape(await getGiftCardSummary(), (g) => {
        const { totalSalesMinor, outstandingMinor, redeemedMinor, ...counts } = g.stats
        return {
          currency: 'ILS',
          generatedAt: g.generatedAt,
          stats: { ...counts, totalSales: ils(totalSalesMinor), outstandingBalance: ils(outstandingMinor), redeemedValue: ils(redeemedMinor) },
          deliveryHealth: {
            windowDays: g.deliveryHealth.windowDays,
            unmatchedPayments: g.deliveryHealth.unmatchedPayments,
            unmatchedPaymentsAmount: ils(g.deliveryHealth.unmatchedPaymentsMinor),
            paidNotActivated: g.deliveryHealth.paidNotActivated,
            undelivered: g.deliveryHealth.undelivered,
            undeliveredByStatus: g.deliveryHealth.undeliveredByStatus,
          },
        }
      }),
  },
  {
    name: 'list_furniture_projects',
    label: 'Furniture projects',
    description:
      'Furniture-collection projects (buildings cleared before demolition): name, city, developer, start date, archived flag, apartments and how many are completed, items documented, items marked for collection and items collected. Mass, diversion and CO₂ figures are NOT available here — they are defined only in the field app\'s own reports.',
    permission: 'furniture:read',
    input: noInput,
    schema: NO_INPUT_SCHEMA,
    run: async () =>
      shape(await getFurnitureProjects(), (projects) => ({
        total: projects.length,
        projects: projects.slice(0, 50).map((p) => ({
          id: p.id,
          name: p.name,
          city: p.city,
          developer: p.developer_name,
          startDate: p.start_date,
          archived: p.archived,
          apartments: p.apartments,
          apartmentsCompleted: p.apartmentsCompleted,
          items: p.items,
          itemsToCollect: p.itemsToCollect,
          itemsCollected: p.itemsCollected,
        })),
      })),
  },
  {
    name: 'get_design_agent_status',
    label: 'Design agent queue',
    description:
      'The JAS design agent (the owner\'s WhatsApp/Telegram designer bot, not a customer inbox): job queue counts by type and status, stuck jobs, dead (permanently failed) jobs with their error, recent design projects and failed outbound messages.',
    permission: 'design_agent:read',
    input: noInput,
    schema: NO_INPUT_SCHEMA,
    run: async () => {
      const [healthz, status] = await Promise.all([getDesignAgentHealthz(), getDesignAgentStatus()])
      return {
        health: shape(healthz, (h) => ({ ok: h.ok, jobs: h.jobs, stuck: h.stuck, version: h.version?.commit ?? null })),
        status: shape(status, (s) => ({
          jobs: s.jobs,
          deadJobs: s.dead.length,
          dead: s.dead.slice(0, 10).map((d) => ({ id: d.id, type: d.type, attempts: d.attempts, error: cut(d.err), updatedAt: new Date(d.updated_at).toISOString() })),
          projects: s.projects.length,
          recentProjects: s.projects.slice(0, 10).map((p) => ({ title: p.title, kind: p.kind, status: p.status, version: p.current_version })),
          failedOutbound: s.outbound_failed.length,
          recentFailedOutbound: s.outbound_failed.slice(0, 5).map((o) => ({ kind: o.kind, error: cut(o.error), createdAt: new Date(o.created_at).toISOString() })),
        })),
      }
    },
  },
  {
    name: 'get_map_places',
    label: 'Map places',
    description:
      'The interactive neighbourhood map (map.justasecond.co.il): its categories and partner places with category, address, opening hours and a short description, as currently published in the map repository.',
    permission: 'map:read',
    input: noInput,
    schema: NO_INPUT_SCHEMA,
    run: async () =>
      shape(await getMapData(), (m) => ({
        categories: m.categories.map((c) => ({ key: c.key, label: c.label })),
        total: m.places.length,
        places: m.places.map((p) => ({ name: p.name, sub: p.sub, category: p.cat, address: p.address, hours: p.hours, description: cut(p.desc, 160) })),
      })),
  },
  {
    name: 'find_gift_cards',
    label: 'Gift card search',
    description:
      'Find gift cards by the last characters of their code, or (for roles allowed to see customer details) a recipient or buyer name, email or phone. Returns card id, masked code, status, value, balance and dates — never full codes or customer details. Use the id with propose_gift_card_resend.',
    permission: 'gift_cards:read',
    input: z.object({ query: z.string().trim().min(1).max(100), status: z.string().max(30).nullable() }).strict(),
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Code digits, or a name/email/phone' }, status: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional card status filter, e.g. active, partially_redeemed' } },
      required: ['query', 'status'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const q = ctx.can('gift_cards:read_pii') ? String(input.query) : String(input.query).replace(/[^A-Za-z0-9-]/g, '')
      if (!q) return { status: 'error', error: 'This user may only search by card code.' }
      return shape(await searchGiftCards(q, (input.status as string | null) ?? undefined), (r) => ({
        total: r.total,
        cards: r.items.slice(0, 20).map((c) => ({ id: c.id, maskedCode: c.maskedCode, status: c.status, value: ils(c.initialAmountMinor), balance: ils(c.balanceMinor) })),
      }))
    },
  },
  {
    name: 'find_website_orders',
    label: 'Website orders',
    description:
      'List recent website shop orders, optionally filtered by status or searched by order number (or customer, for roles allowed to see customer details). Returns id, order number, status, total (₪), date and item names — never customer contact details. Use the id with propose_website_order_status.',
    permission: 'website:read',
    input: z.object({ query: z.string().trim().max(100), status: z.enum(ORDER_STATUSES).nullable() }).strict(),
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Order number or customer; empty string for the newest orders' }, status: { anyOf: [{ type: 'string', enum: [...ORDER_STATUSES] }, { type: 'null' }], description: 'Optional status filter' } },
      required: ['query', 'status'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const q = ctx.can('website:read_pii') ? String(input.query) : String(input.query).replace(/[^A-Za-z0-9-]/g, '')
      return shape(await listWebsiteOrders(q, (input.status as string | null) ?? undefined), (orders) => ({
        currency: 'ILS',
        orders: orders.slice(0, 30).map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, total: o.total, createdAt: o.created_at, items: (o.items ?? []).map((i) => `${i.name_he || i.name_en || '?'} ×${i.quantity}`) })),
      }))
    },
  },
  {
    name: 'find_website_products',
    label: 'Website products',
    description:
      'Find shop products by name or slug: id, slug, names, price and strike-through price (₪), stock quantity, in stock, featured, published. Use id and slug with propose_website_product_update.',
    permission: 'website:read',
    input: z.object({ query: z.string().trim().max(100) }).strict(),
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Product name or slug; empty string for the most recently updated' } }, required: ['query'], additionalProperties: false },
    run: async (input) =>
      shape(await listWebsiteProducts(String(input.query)), (products) => ({
        currency: 'ILS',
        products: products.slice(0, 30).map((p) => ({ id: p.id, slug: p.slug, name: p.name_he, nameEn: p.name_en, price: p.price, originalPrice: p.original_price, quantity: p.quantity, inStock: p.in_stock, featured: p.featured, published: p.published ?? null })),
      })),
  },
  ...PROPOSALS.map(
    (d): AssistantTool => ({
      name: `${PROPOSAL_TOOL_PREFIX}${d.kind}`,
      label: `Proposed: ${d.label}`,
      description: d.description,
      permission: d.permissions[0]!,
      input: d.params,
      schema: d.schema,
      proposal: d,
      // Never called for proposals: run.ts prepares them (lookup only) and returns the proposal.
      run: async () => {
        throw new Error('proposal tools are prepared, not run')
      },
    }),
  ),
]

/** The tools this user may use, in a fixed order (a stable tool list keeps the prompt cache warm). */
export function toolsFor(ctx: ToolContext): AssistantTool[] {
  return TOOLS.filter((t) => ctx.can(t.permission) && (t.proposal?.permissions ?? []).every((p) => ctx.can(p)))
}

export function toolDefinitions(tools: readonly AssistantTool[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, strict: true }))
}
