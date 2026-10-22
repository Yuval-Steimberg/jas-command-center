import 'server-only'
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { Permission, Product } from '@/lib/auth/rbac'
import { getGiftCard, resendAllUndelivered, resendGiftCard } from '@/lib/integrations/gift-cards/adapter'
import { FULFILMENT, listWebsiteOrders, listWebsiteProducts, setWebsiteOrderStatus, updateWebsiteProduct, type ProductPatch } from '@/lib/integrations/website/manage'
import { getFurnitureProject, setProjectArchived } from '@/lib/integrations/furniture/manage'
import { getDesignAgentStatus, retryDeadJob } from '@/lib/integrations/design-agent/adapter'
import { formatAgorot, shekelsToAgorot } from '@/lib/money'

/**
 * Actions the assistant may PROPOSE. Proposing does nothing: the tool looks the
 * target up in its source (so the confirmation card describes what really
 * exists, not what the model claims), and hands back a proposal. The person
 * then sees a confirmation card; only their click runs `execute`, through
 * confirmProposalAction, which re-checks their permission, re-validates the
 * parameters, and audits requested → outcome (via = assistant).
 *
 * `execute` calls the same adapter functions as the pages, and nothing else.
 */
export interface Proposal {
  kind: string
  params: Record<string, unknown>
  /** Built here from source data, shown on the confirmation card. */
  summary: string
}

export interface ActionActor {
  email: string
  role: string
}

export interface ProposalDef {
  kind: string
  label: string
  description: string
  product: Product
  /** Every permission the action needs; all are checked when proposing and again on confirm. */
  permissions: Permission[]
  params: z.ZodType<Record<string, unknown>>
  schema: Anthropic.Beta.BetaTool['input_schema']
  /** Look the target up and describe it, or explain why it cannot be proposed. */
  prepare: (params: Record<string, unknown>) => Promise<{ ok: true; params: Record<string, unknown>; summary: string } | { ok: false; reason: string }>
  execute: (params: Record<string, unknown>, actor: ActionActor) => Promise<{ ok: boolean; message: string; detail?: Record<string, unknown> }>
}

const reason = z.string().trim().min(3).max(500)
const ils = (v: number | null | undefined) => (v == null ? '—' : formatAgorot(shekelsToAgorot(v)))
const str = (description: string) => ({ type: 'string' as const, description })

const giftResend = z.object({ cardId: z.string().uuid(), reason }).strict()
const orderStatus = z.object({ orderId: z.number().int().positive(), orderNumber: z.string().min(1).max(40), to: z.enum(FULFILMENT) }).strict()
const orderStatusExec = orderStatus.extend({ from: z.enum(FULFILMENT) }).strict()
const money = z.number().positive().max(1_000_000).refine((v) => Math.round(v * 100) === v * 100, 'at most 2 decimals')
const productUpdate = z
  .object({
    productId: z.number().int().positive(),
    slug: z.string().min(1).max(200),
    price: money.nullable(),
    originalPrice: money.nullable(),
    removeOriginalPrice: z.boolean(),
    quantity: z.number().int().min(0).max(100_000).nullable(),
    featured: z.boolean().nullable(),
  })
  .strict()
const productUpdateExec = productUpdate.extend({ expectUpdatedAt: z.string().min(1) }).strict()
const furnitureArchive = z.object({ projectId: z.string().uuid(), archived: z.boolean() }).strict()
const designRetry = z.object({ jobId: z.number().int().positive() }).strict()

function productPatch(p: z.infer<typeof productUpdate>): ProductPatch {
  const patch: ProductPatch = {}
  if (p.price != null) patch.price = p.price
  if (p.removeOriginalPrice) patch.original_price = null
  else if (p.originalPrice != null) patch.original_price = p.originalPrice
  if (p.quantity != null) patch.quantity = p.quantity
  if (p.featured != null) patch.featured = p.featured
  return patch
}

export const PROPOSALS: readonly ProposalDef[] = [
  {
    kind: 'gift_card_resend',
    label: 'Resend a gift card email',
    description: 'Propose resending one gift card\'s email to its current recipient. Use find_gift_cards first to get the card id. Nothing is sent until the user confirms on screen.',
    product: 'gift_cards',
    permissions: ['gift_cards:operate'],
    params: giftResend,
    schema: { type: 'object', properties: { cardId: str('Card id from find_gift_cards'), reason: str('Why it is resent, in the user\'s words (stored in both audit logs)') }, required: ['cardId', 'reason'], additionalProperties: false },
    async prepare(raw) {
      const p = giftResend.parse(raw)
      const r = await getGiftCard(p.cardId)
      if (!r) return { ok: false, reason: 'No gift card with that id.' }
      if (r.state !== 'ok') return { ok: false, reason: r.state === 'error' ? r.error : 'Gift cards are not connected.' }
      return { ok: true, params: p, summary: `Resend gift card ${r.data.card.maskedCode} (${formatAgorot(r.data.card.balanceMinor)} left, ${r.data.card.status.replace(/_/g, ' ')}) to its recipient. Reason: ${p.reason}` }
    },
    async execute(raw, actor) {
      const p = giftResend.parse(raw)
      const res = await resendGiftCard(p.cardId, actor, p.reason)
      return res.ok ? { ok: true, message: 'Sent. The gift card system handed the email to its provider.' } : { ok: false, message: `Not sent: ${res.message ?? 'no email was processed'}` }
    },
  },
  {
    kind: 'gift_card_resend_all',
    label: 'Resend all undelivered gift cards',
    description: 'Propose resending every paid gift card whose email did not go out (the gift card system skips cards the recipient\'s server rejected). Nothing is sent until the user confirms.',
    product: 'gift_cards',
    permissions: ['gift_cards:operate'],
    params: z.object({}).strict(),
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    async prepare() {
      return { ok: true, params: {}, summary: 'Resend every paid gift card whose email did not go out. Cards rejected by the recipient\'s mail server are skipped.' }
    },
    async execute(_raw, actor) {
      const res = await resendAllUndelivered(actor)
      if ('ok' in res) return { ok: false, message: res.message }
      const rejected = res.rejected.length ? ` ${res.rejected.length} rejected by the recipient's server need a new recipient (${res.rejected.map((r) => r.maskedCode).join(', ')}).` : ''
      return { ok: res.delivered >= res.queued, message: res.queued ? `Sent ${res.delivered} of ${res.queued}.${rejected}` : `Nothing to resend.${rejected}`, detail: { queued: res.queued, delivered: res.delivered, rejected: res.rejected.length } }
    },
  },
  {
    kind: 'website_order_status',
    label: 'Change a website order\'s fulfilment status',
    description: 'Propose moving a PAID website order between fulfilment statuses: paid, processing, shipped, delivered. Payment states and cancellations cannot be changed. Use find_website_orders first. Nothing changes until the user confirms.',
    product: 'website',
    permissions: ['website:operate'],
    params: orderStatus,
    schema: { type: 'object', properties: { orderId: { type: 'integer', description: 'Order id from find_website_orders' }, orderNumber: str('Its order number, to find it'), to: { type: 'string', enum: [...FULFILMENT] } }, required: ['orderId', 'orderNumber', 'to'], additionalProperties: false },
    async prepare(raw) {
      const p = orderStatus.parse(raw)
      const r = await listWebsiteOrders(p.orderNumber.replace(/[^A-Za-z0-9-]/g, ''))
      if (r.state !== 'ok') return { ok: false, reason: r.state === 'error' ? r.error : 'Website orders are not connected.' }
      const o = r.data.find((x) => x.id === p.orderId)
      if (!o) return { ok: false, reason: 'No order with that id and number.' }
      const from = FULFILMENT.find((s) => s === o.status)
      if (!from) return { ok: false, reason: `Order ${o.order_number} is ${o.status}; only paid orders can move through fulfilment here.` }
      if (from === p.to) return { ok: false, reason: `Order ${o.order_number} is already ${from}.` }
      return { ok: true, params: { ...p, orderNumber: o.order_number, from }, summary: `Change website order ${o.order_number} (${ils(o.total)}) from ${from} to ${p.to}.` }
    },
    async execute(raw) {
      const p = orderStatusExec.parse(raw)
      const res = await setWebsiteOrderStatus(p.orderId, p.from, p.to)
      return res.ok ? { ok: true, message: `Order ${p.orderNumber} is now ${res.value.status}.` } : { ok: false, message: res.message }
    },
  },
  {
    kind: 'website_product_update',
    label: 'Change a product\'s price, stock or featured flag',
    description: 'Propose changing a shop product\'s price (₪), strike-through price, stock quantity (0 = out of stock) or featured flag. Use find_website_products first. Pass null for anything that should stay as it is. Nothing changes until the user confirms.',
    product: 'website',
    permissions: ['website:write'],
    params: productUpdate,
    schema: {
      type: 'object',
      properties: {
        productId: { type: 'integer', description: 'Product id from find_website_products' },
        slug: str('Its slug, to find it'),
        price: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'New price in ₪, or null to keep' },
        originalPrice: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'New strike-through price in ₪ (must be above the price), or null to keep' },
        removeOriginalPrice: { type: 'boolean', description: 'true to remove the strike-through price' },
        quantity: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'New stock quantity, or null to keep' },
        featured: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description: 'New featured flag, or null to keep' },
      },
      required: ['productId', 'slug', 'price', 'originalPrice', 'removeOriginalPrice', 'quantity', 'featured'],
      additionalProperties: false,
    },
    async prepare(raw) {
      const p = productUpdate.parse(raw)
      const patch = productPatch(p)
      if (!Object.keys(patch).length) return { ok: false, reason: 'Nothing to change.' }
      const r = await listWebsiteProducts(p.slug.slice(0, 100))
      if (r.state !== 'ok') return { ok: false, reason: r.state === 'error' ? r.error : 'Website products are not connected.' }
      const cur = r.data.find((x) => x.id === p.productId)
      if (!cur) return { ok: false, reason: 'No product with that id and slug.' }
      const price = patch.price ?? cur.price
      const original = 'original_price' in patch ? patch.original_price : cur.original_price
      if (original != null && price != null && original <= price) return { ok: false, reason: 'The strike-through price must be higher than the price.' }
      const changes = [
        patch.price !== undefined && `price ${ils(cur.price)} → ${ils(patch.price)}`,
        'original_price' in patch && `strike-through ${ils(cur.original_price)} → ${patch.original_price == null ? 'none' : ils(patch.original_price)}`,
        patch.quantity !== undefined && `quantity ${cur.quantity ?? '—'} → ${patch.quantity}${patch.quantity === 0 ? ' (out of stock)' : ''}`,
        patch.featured !== undefined && `featured ${cur.featured ? 'yes' : 'no'} → ${patch.featured ? 'yes' : 'no'}`,
      ].filter(Boolean)
      return { ok: true, params: { ...p, slug: cur.slug, expectUpdatedAt: cur.updated_at }, summary: `Change "${cur.name_he}" on the live shop: ${changes.join(', ')}.` }
    },
    async execute(raw) {
      const p = productUpdateExec.parse(raw)
      const res = await updateWebsiteProduct(p.productId, productPatch(p), p.expectUpdatedAt)
      return res.ok ? { ok: true, message: 'Saved. The search-engine copy of the product page updates on the next website deploy.' } : { ok: false, message: res.message }
    },
  },
  {
    kind: 'furniture_archive',
    label: 'Archive or unarchive a furniture project',
    description: 'Propose archiving a furniture project (it disappears from the field app\'s lists) or taking it out of the archive. Project ids come from list_furniture_projects. Nothing changes until the user confirms.',
    product: 'furniture',
    permissions: ['furniture:operate'],
    params: furnitureArchive,
    schema: { type: 'object', properties: { projectId: str('Project id from list_furniture_projects'), archived: { type: 'boolean', description: 'true to archive, false to unarchive' } }, required: ['projectId', 'archived'], additionalProperties: false },
    async prepare(raw) {
      const p = furnitureArchive.parse(raw)
      const r = await getFurnitureProject(p.projectId)
      if (!r) return { ok: false, reason: 'No project with that id.' }
      if (r.state !== 'ok') return { ok: false, reason: r.state === 'error' ? r.error : 'Furniture is not connected.' }
      if (Boolean(r.data.project.archived) === p.archived) return { ok: false, reason: `"${r.data.project.name}" is already ${p.archived ? 'archived' : 'active'}.` }
      return { ok: true, params: p, summary: `${p.archived ? 'Archive' : 'Unarchive'} the furniture project "${r.data.project.name}" (${r.data.apartments.length} apartments).` }
    },
    async execute(raw) {
      const p = furnitureArchive.parse(raw)
      const res = await setProjectArchived(p.projectId, p.archived)
      return res.ok ? { ok: true, message: p.archived ? 'Archived.' : 'Taken out of the archive.' } : { ok: false, message: res.message }
    },
  },
  {
    kind: 'design_agent_retry',
    label: 'Retry a dead design-agent job',
    description: 'Propose re-queuing one dead (permanently failed) design-agent job. Job ids come from get_design_agent_status. Nothing changes until the user confirms.',
    product: 'design_agent',
    permissions: ['design_agent:operate'],
    params: designRetry,
    schema: { type: 'object', properties: { jobId: { type: 'integer', description: 'Dead job id from get_design_agent_status' } }, required: ['jobId'], additionalProperties: false },
    async prepare(raw) {
      const p = designRetry.parse(raw)
      const r = await getDesignAgentStatus()
      if (r.state !== 'ok') return { ok: false, reason: r.state === 'error' ? r.error : 'The design agent is not connected.' }
      const job = r.data.dead.find((d) => d.id === p.jobId)
      if (!job) return { ok: false, reason: `Job ${p.jobId} is not in the dead-job list.` }
      return { ok: true, params: p, summary: `Re-queue dead design-agent job ${job.id} (${job.type}, ${job.attempts} attempts).` }
    },
    async execute(raw) {
      const p = designRetry.parse(raw)
      const { retried } = await retryDeadJob(p.jobId)
      return retried ? { ok: true, message: `Job ${p.jobId} is queued again.` } : { ok: false, message: `Job ${p.jobId} is no longer dead. Nothing changed.` }
    },
  },
]

/** The exec-time schema for each kind: what prepare() added (from, expectUpdatedAt) is required on confirm. */
export const EXEC_PARAMS: Record<string, z.ZodType<Record<string, unknown>>> = {
  gift_card_resend: giftResend,
  gift_card_resend_all: z.object({}).strict(),
  website_order_status: orderStatusExec,
  website_product_update: productUpdateExec,
  furniture_archive: furnitureArchive,
  design_agent_retry: designRetry,
}

export const proposalDef = (kind: string) => PROPOSALS.find((p) => p.kind === kind)
export const PROPOSAL_TOOL_PREFIX = 'propose_'
