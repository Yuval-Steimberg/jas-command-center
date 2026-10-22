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
