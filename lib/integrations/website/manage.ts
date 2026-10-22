import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'
import { fetchJson, SourceError, withHint } from '../http'
import { notConfigured, readOnce } from '../read'
import { invalidate } from '../cache'
import type { SourceResult } from '../types'

/**
 * Orders and products through the website's own analytics function
 * (netlify/functions/_agent-ops.ts there), with its COMMAND_CENTER_API_KEY.
 * The website decides what may change: fulfilment statuses only, and a
 * product's price / strike-through price / quantity / featured flag. Every
 * write is conditional on the row being what was loaded; a 409 comes back as
 * "reload", never as an overwrite. Money is ₪ with agorot decimals.
 */

export const FULFILMENT = ['paid', 'processing', 'shipped', 'delivered'] as const
export const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'] as const

const orderItem = z.object({ product_id: z.number().nullable().optional(), name_he: z.string().nullable().optional(), name_en: z.string().nullable().optional(), price: z.number(), quantity: z.number() }).passthrough()

export const websiteOrder = z.object({
  id: z.number().int(),
  order_number: z.string(),
  customer_name: z.string().nullable(),
  customer_email: z.string().nullable(),
  customer_phone: z.string().nullable(),
  items: z.array(orderItem).nullable().catch(null),
  subtotal: z.number().nullable(),
  shipping: z.number().nullable(),
  discount: z.number().nullable().optional(),
  total: z.number(),
  status: z.string(),
  notes: z.string().nullable(),
  paid_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
})
export type WebsiteOrder = z.infer<typeof websiteOrder>

export const websiteProduct = z.object({
  id: z.number().int(),
  slug: z.string(),
  name_he: z.string(),
  name_en: z.string().nullable(),
  price: z.number().nullable(),
  original_price: z.number().nullable(),
  quantity: z.number().int().nullable(),
  in_stock: z.boolean().nullable(),
  featured: z.boolean().nullable(),
  published: z.boolean().nullable().optional(),
  image_url: z.string().nullable(),
  updated_at: z.string(),
  categories: z.object({ name_he: z.string().nullable(), name_en: z.string().nullable() }).nullable().optional(),
})
export type WebsiteProduct = z.infer<typeof websiteProduct>

const ordersResponse = z.object({ orders: z.array(websiteOrder) })
const productsResponse = z.object({ products: z.array(websiteProduct) })

const SOURCE = 'Website /api/analytics (command center actions)'

function missing() {
  const { url, commandKey } = env().website
  return [!url && 'WEBSITE_URL', !commandKey && 'WEBSITE_COMMAND_CENTER_KEY'].filter(Boolean) as string[]
}
const NOTE = 'WEBSITE_COMMAND_CENTER_KEY must equal COMMAND_CENTER_API_KEY on the website (32+ characters), and the website must be redeployed after setting it.'

async function call(action: string, body: Record<string, unknown>, idempotent: boolean) {
  const { url, commandKey } = env().website
  return fetchJson(`${url}/api/analytics`, {
    method: 'POST',
    idempotent,
    headers: { Authorization: `Bearer ${commandKey}` },
    body: { action, ...body },
    timeoutMs: 20_000,
  }).catch((e) =>
    withHint(e, (x) =>
      x.status === 401 || x.status === 403
        ? `The website refused the key. ${NOTE}`
        : x.status === 404
          ? `Nothing answers at ${url}/api/analytics: check WEBSITE_URL`
          : null,
    ),
  )
}

export async function listWebsiteOrders(q: string, status?: string): Promise<SourceResult<WebsiteOrder[]>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:orders:${status ?? ''}:${q}`, SOURCE, async () => {
    const { data, latencyMs } = await call('orders-list', { q, status, limit: 100 }, true)
    return { data: ordersResponse.parse(data).orders, latencyMs }
  })
}

export async function listWebsiteProducts(q: string): Promise<SourceResult<WebsiteProduct[]>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:products:${q}`, SOURCE, async () => {
    const { data, latencyMs } = await call('products-list', { q, limit: 200 }, true)
    return { data: productsResponse.parse(data).products, latencyMs }
  })
}

export type WriteOutcome<T> = { ok: true; value: T } | { ok: false; conflict: boolean; message: string }

/** A refusal from the website (409 changed, 422 not allowed) is an answer to show, not an outage. */
async function write<T>(action: string, body: Record<string, unknown>, parse: (d: unknown) => T): Promise<WriteOutcome<T>> {
  const m = missing()
  if (m.length) throw new SourceError(`Website actions are not connected (${m.join(', ')})`, null, null)
  try {
    const { data } = await call(action, body, false)
    return { ok: true, value: parse(data) }
  } catch (e) {
    if (e instanceof SourceError && (e.status === 409 || e.status === 422)) {
      return { ok: false, conflict: e.status === 409, message: e.message.replace(/^HTTP \d+: /, '') }
    }
    throw e
  } finally {
    invalidate('website:') // the snapshot's order counts may follow a status change
  }
}

export const setWebsiteOrderStatus = (id: number, from: string, to: string) =>
  write('order-set-status', { id, from, to }, (d) => z.object({ order: z.object({ id: z.number(), status: z.string() }).passthrough() }).parse(d).order)

export const setWebsiteOrderNotes = (id: number, notes: string) =>
  write('order-set-notes', { id, notes }, (d) => z.object({ order: z.object({ id: z.number() }).passthrough() }).parse(d).order)

export type ProductPatch = { price?: number; original_price?: number | null; quantity?: number; featured?: boolean }

export const updateWebsiteProduct = (id: number, patch: ProductPatch, expectUpdatedAt: string) =>
  write('product-update', { id, patch, expectUpdatedAt }, (d) => z.object({ product: websiteProduct }).parse(d).product)

/**
 * Site content: the keys the website manager's content, shop-hours and
 * partners tabs edit (the website's SITE_CONTENT_SCHEMA, served by
 * content-list). The website validates each key the way its manager UI does,
 * refuses executable markup, and refuses a stale edit with 409.
 * `updatedAt: null` means no stored row: the site shows the default value.
 */
export const websiteContentItem = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'image', 'video']),
  section: z.string(),
  sort_order: z.number(),
  value: z.string(),
  stored: z.boolean(),
  updated_at: z.string().nullable(),
})
export type WebsiteContentItem = z.infer<typeof websiteContentItem>
const contentResponse = z.object({ items: z.array(websiteContentItem), sections: z.array(z.string()) })
export type WebsiteContent = z.infer<typeof contentResponse>

export async function listWebsiteContent(section = ''): Promise<SourceResult<WebsiteContent>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:content:${section}`, SOURCE, async () => {
    const { data, latencyMs } = await call('content-list', section ? { section } : {}, true)
    return { data: contentResponse.parse(data), latencyMs }
  })
}

export const setWebsiteContent = (key: string, value: string, expectUpdatedAt: string | null) =>
  write('content-set', { key, value, expectUpdatedAt }, (d) => z.object({ item: z.object({ key: z.string(), value: z.string(), updated_at: z.string().nullable() }) }).parse(d).item)

/** The shop-hours keys and their meaning (the website's src/lib/shopHours.ts). */
export const SHOP_HOURS_KEYS = ['shop_status_override', 'shop_open_from', 'shop_open_to', 'shop_open_days'] as const
export const PARTNERS_KEY = 'partners_json'

/**
 * Reviews (the website manager's ביקורות tab): approve / hide / delete and a
 * stored reply. `customer_email` is a customer's address: pages show it only
 * to roles with website:read_pii.
 */
export const websiteReview = z.object({
  id: z.number().int(),
  product_id: z.number().int().nullable(),
  customer_name: z.string(),
  customer_email: z.string().nullable().optional(),
  rating: z.number(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  approved: z.boolean(),
  created_at: z.string(),
  product: z.object({ id: z.number(), name_he: z.string().nullable(), slug: z.string().nullable() }).nullable(),
  reply: z.string(),
})
export type WebsiteReview = z.infer<typeof websiteReview>
const reviewsResponse = z.object({ reviews: z.array(websiteReview) })

export type ReviewFilter = 'pending' | 'approved' | ''

export async function listWebsiteReviews(status: ReviewFilter): Promise<SourceResult<WebsiteReview[]>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:reviews:${status}`, SOURCE, async () => {
    const { data, latencyMs } = await call('reviews-list', status ? { status } : {}, true)
    return { data: reviewsResponse.parse(data).reviews, latencyMs }
  })
}

export const setWebsiteReviewsApproved = (ids: number[], approved: boolean) =>
  write('reviews-set-approved', { ids, approved }, (d) => z.object({ updated: z.array(z.number()) }).parse(d).updated)

export const deleteWebsiteReviews = (ids: number[]) =>
  write('reviews-delete', { ids }, (d) => z.object({ deleted: z.array(z.number()) }).parse(d).deleted)

export const setWebsiteReviewReply = (id: number, reply: string) =>
  write('review-reply', { id, reply }, (d) => z.object({ id: z.number(), reply: z.string() }).parse(d))

/**
 * Blog posts (the website manager's בלוג tab). Content is the markdown subset
 * the website's article page parses (## headings, - lists, **bold**, links),
 * never HTML. Edits and deletes are conditional on updated_at.
 */
export const websitePostSummary = z.object({
  id: z.number().int(),
  title_he: z.string(),
  title_en: z.string().nullable(),
  slug: z.string(),
  excerpt_he: z.string().nullable(),
  cover_image: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  author: z.string().nullable(),
  published: z.boolean(),
  published_at: z.string().nullable(),
  featured: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type WebsitePostSummary = z.infer<typeof websitePostSummary>
export const websitePost = websitePostSummary.extend({ content_he: z.string().nullable(), images: z.array(z.string()).nullable() })
export type WebsitePost = z.infer<typeof websitePost>

export type WebsitePostInput = {
  title_he: string
  title_en: string | null
  slug: string
  excerpt_he: string | null
  content_he: string | null
  cover_image: string | null
  images: string[]
  category: string | null
  tags: string[]
  author: string | null
  published: boolean
  featured: boolean
}

export async function listWebsitePosts(): Promise<SourceResult<WebsitePostSummary[]>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce('website:blog', SOURCE, async () => {
    const { data, latencyMs } = await call('blog-list', {}, true)
    return { data: z.object({ posts: z.array(websitePostSummary) }).parse(data).posts, latencyMs }
  })
}

export async function getWebsitePost(id: number): Promise<SourceResult<WebsitePost | null>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:blog:${id}`, SOURCE, async () => {
    try {
      const { data, latencyMs } = await call('blog-get', { id }, true)
      return { data: z.object({ post: websitePost }).parse(data).post, latencyMs }
    } catch (e) {
      if (e instanceof SourceError && e.status === 404) return { data: null, latencyMs: 0 }
      throw e
    }
  })
}

export const saveWebsitePost = (post: WebsitePostInput, id?: number, expectUpdatedAt?: string) =>
  write('blog-save', id ? { id, expectUpdatedAt, post } : { post }, (d) => z.object({ post: websitePostSummary }).parse(d).post)

export const deleteWebsitePost = (id: number, expectUpdatedAt: string) =>
  write('blog-delete', { id, expectUpdatedAt }, (d) => z.object({ deleted: z.object({ id: z.number(), slug: z.string() }) }).parse(d).deleted)

/**
 * Full product management (the manager's product form): every field, create,
 * delete, categories and the low-stock threshold. The website applies the
 * form's rules (Hebrew name, slug, price above 0, main image; stock follows
 * quantity) and refuses a stale edit or a slug already in use with 409.
 * Images are links: uploading stays in the website's storage.
 */
export const PRODUCT_CONDITIONS = ['excellent', 'good', 'fair', 'as-is'] as const

export const websiteProductFull = z.object({
  id: z.number().int(),
  name_he: z.string(),
  name_en: z.string().nullable(),
  slug: z.string(),
  description_he: z.string().nullable(),
  description_en: z.string().nullable(),
  story_he: z.string().nullable(),
  story_en: z.string().nullable(),
  price: z.number().nullable(),
  original_price: z.number().nullable(),
  category_id: z.number().int().nullable(),
  condition: z.string().nullable(),
  style: z.string().nullable(),
  dimensions: z.string().nullable(),
  material: z.string().nullable(),
  origin: z.string().nullable(),
  image_url: z.string().nullable(),
  images: z.array(z.string()).nullable(),
  featured: z.boolean().nullable(),
  in_stock: z.boolean().nullable(),
  quantity: z.number().int().nullable(),
  tags: z.array(z.string()).nullable(),
  published: z.boolean().nullable().optional(),
  created_at: z.string().nullable(),
  updated_at: z.string(),
})
export type WebsiteProductFull = z.infer<typeof websiteProductFull>

export const websiteCategory = z.object({ id: z.number().int(), name_he: z.string(), name_en: z.string().nullable(), slug: z.string() })
export type WebsiteCategory = z.infer<typeof websiteCategory>
const productMetaResponse = z.object({ categories: z.array(websiteCategory), lowStockThreshold: z.number().int() })
export type WebsiteProductMeta = z.infer<typeof productMetaResponse>

export type WebsiteProductInput = {
  name_he: string
  name_en: string | null
  slug: string
  description_he: string | null
  description_en: string | null
  story_he: string | null
  story_en: string | null
  price: number
  original_price: number | null
  category_id: number | null
  condition: (typeof PRODUCT_CONDITIONS)[number]
  style: string | null
  dimensions: string | null
  material: string | null
  origin: string | null
  image_url: string
  images: string[]
  featured: boolean
  quantity: number
  tags: string[]
  published?: boolean
}

export async function getWebsiteProduct(id: number): Promise<SourceResult<WebsiteProductFull | null>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:product:${id}`, SOURCE, async () => {
    try {
      const { data, latencyMs } = await call('product-get', { id }, true)
      return { data: z.object({ product: websiteProductFull }).parse(data).product, latencyMs }
    } catch (e) {
      if (e instanceof SourceError && e.status === 404) return { data: null, latencyMs: 0 }
      throw e
    }
  })
}

export async function getWebsiteProductMeta(): Promise<SourceResult<WebsiteProductMeta>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce('website:product-meta', SOURCE, async () => {
    const { data, latencyMs } = await call('product-meta', {}, true)
    return { data: productMetaResponse.parse(data), latencyMs }
  })
}

export const saveWebsiteProduct = (product: WebsiteProductInput, id?: number, expectUpdatedAt?: string) =>
  write('product-save', id ? { id, expectUpdatedAt, product } : { product }, (d) => z.object({ product: websiteProductFull }).parse(d).product)

export const deleteWebsiteProduct = (id: number, expectUpdatedAt: string) =>
  write('product-delete', { id, expectUpdatedAt }, (d) => z.object({ deleted: z.object({ id: z.number(), slug: z.string() }).passthrough() }).parse(d).deleted)

export const createWebsiteCategory = (name_he: string, name_en: string | null) =>
  write('category-create', { name_he, name_en }, (d) => z.object({ category: websiteCategory }).parse(d).category)

export const setWebsiteLowStockThreshold = (threshold: number) =>
  write('low-stock-set', { threshold }, (d) => z.object({ lowStockThreshold: z.number() }).parse(d).lowStockThreshold)

/**
 * Marketing (the website manager's שיווק tab): discount codes, newsletter
 * subscribers (customer emails: website:read_pii only) and the campaign
 * history. The website changes one code at a time on the freshest list and
 * keeps the usage count the payment webhook maintains.
 */
export const websiteDiscount = z.object({
  code: z.string(),
  type: z.enum(['percent', 'amount']),
  value: z.number(),
  expiresAt: z.string().optional(),
  usageLimit: z.number().optional(),
  usedCount: z.number().optional(),
  minOrder: z.number().optional(),
  notes: z.string().optional(),
  active: z.boolean(),
  createdAt: z.string().optional(),
})
export type WebsiteDiscount = z.infer<typeof websiteDiscount>
export type WebsiteDiscountInput = Omit<WebsiteDiscount, 'usedCount' | 'createdAt'>

export const websiteSubscriber = z.object({ id: z.number().int(), email: z.string(), created_at: z.string() })
export type WebsiteSubscriber = z.infer<typeof websiteSubscriber>

export const websiteCampaign = z.object({ id: z.string(), subject: z.string(), sentAt: z.string(), recipients: z.number(), segment: z.string().optional() }).passthrough()
export type WebsiteCampaign = z.infer<typeof websiteCampaign>

export async function listWebsiteDiscounts(): Promise<SourceResult<WebsiteDiscount[]>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce('website:discounts', SOURCE, async () => {
    const { data, latencyMs } = await call('discounts-list', {}, true)
    return { data: z.object({ codes: z.array(websiteDiscount) }).parse(data).codes, latencyMs }
  })
}

export const saveWebsiteDiscount = (code: WebsiteDiscountInput, mode: 'create' | 'update') =>
  write('discount-save', { mode, code }, (d) => z.object({ code: websiteDiscount }).parse(d).code)

export const deleteWebsiteDiscount = (code: string) =>
  write('discount-delete', { code }, (d) => z.object({ deleted: z.string() }).parse(d).deleted)

export async function listWebsiteSubscribers(q: string): Promise<SourceResult<{ subscribers: WebsiteSubscriber[]; total: number }>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce(`website:subscribers:${q}`, SOURCE, async () => {
    const { data, latencyMs } = await call('subscribers-list', { q, limit: 500 }, true)
    return { data: z.object({ subscribers: z.array(websiteSubscriber), total: z.number() }).parse(data), latencyMs }
  })
}

export const deleteWebsiteSubscriber = (id: number) =>
  write('subscriber-delete', { id }, (d) => z.object({ deleted: z.number() }).parse(d).deleted)

export async function listWebsiteCampaigns(): Promise<SourceResult<WebsiteCampaign[]>> {
  const m = missing()
  if (m.length) return notConfigured(m, NOTE)
  return readOnce('website:campaigns', SOURCE, async () => {
    const { data, latencyMs } = await call('campaigns-list', {}, true)
    // A malformed history entry is dropped, not allowed to fail the page.
    const rows = z.object({ campaigns: z.array(z.unknown()) }).parse(data).campaigns
    return { data: rows.flatMap((r) => { const p = websiteCampaign.safeParse(r); return p.success ? [p.data] : [] }), latencyMs }
  })
}
