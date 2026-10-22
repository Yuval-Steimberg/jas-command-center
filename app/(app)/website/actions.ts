'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSession, requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { audit } from '@/lib/audit/audit'
import { FULFILMENT, PARTNERS_KEY, PRODUCT_CONDITIONS, deleteWebsiteDiscount, deleteWebsiteSubscriber, saveWebsiteDiscount, type WebsiteDiscountInput, createWebsiteCategory, deleteWebsiteProduct, saveWebsiteProduct, setWebsiteLowStockThreshold, type WebsiteProductInput, deleteWebsitePost, deleteWebsiteReviews, saveWebsitePost, type WebsitePostInput, setWebsiteContent, setWebsiteReviewReply, setWebsiteReviewsApproved, setWebsiteOrderNotes, setWebsiteOrderStatus, updateWebsiteProduct, type ProductPatch } from '@/lib/integrations/website/manage'

export type ActionState = { ok?: boolean; message?: string }

const rowId = z.coerce.number().int().positive()
const fulfilment = z.enum(FULFILMENT)
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Website writes go through the website's own endpoint, which allows only
 * fulfilment statuses and four product fields and refuses a stale edit. The
 * website keeps no audit log of its own, so the record here (requested, then
 * the outcome the website confirmed, with before/after values) is the only one.
 */
export async function setOrderStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to change orders.' }
  }
  const id = rowId.safeParse(form.get('id'))
  const from = fulfilment.safeParse(form.get('from'))
  const to = fulfilment.safeParse(form.get('to'))
  if (!id.success) return { ok: false, message: 'Invalid order.' }
  if (!from.success || !to.success) return { ok: false, message: 'Only paid → processing → shipped → delivered can be set here. Payment states and cancellations stay in the website manager.' }
  if (from.data === to.data) return { ok: false, message: 'The order already has that status.' }
  const target = `order:${id.data}`
  const detail = { from: from.data, to: to.data, orderNumber: String(form.get('orderNumber') ?? '').slice(0, 40) }
  await audit(user, { action: 'website.order.set_status', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await setWebsiteOrderStatus(id.data, from.data, to.data)
    await audit(user, { action: 'website.order.set_status', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/orders')
    return res.ok ? { ok: true, message: `Order is now ${res.value.status}.` } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.order.set_status', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

export async function setOrderNotesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to change orders.' }
  }
  const s = await getSession()
  // Order notes sit beside the customer's details and often contain them.
  if (!s || !can(s.user.role, 'website:read_pii', s.overrides)) return { ok: false, message: 'Your role cannot see or change customer details.' }
  const id = rowId.safeParse(form.get('id'))
  const notes = z.string().max(4000, 'Notes are limited to 4000 characters.').safeParse(String(form.get('notes') ?? ''))
  if (!id.success) return { ok: false, message: 'Invalid order.' }
  if (!notes.success) return { ok: false, message: notes.error.issues[0]!.message }
  const target = `order:${id.data}`
  // The note text is the customer's business; the log records that it changed and its length.
  const detail = { length: notes.data.length }
  await audit(user, { action: 'website.order.set_notes', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await setWebsiteOrderNotes(id.data, notes.data)
    await audit(user, { action: 'website.order.set_notes', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/orders')
    return res.ok ? { ok: true, message: 'Notes saved.' } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.order.set_notes', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
}

/** "" = leave unchanged; otherwise a positive ₪ amount with at most 2 decimals. */
const shekels = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{1,7}(\.\d{1,2})?$/.test(v), `${label} must be an amount in ₪ like 450 or 399.90`)
    .transform((v) => (v === '' ? undefined : Number(v)))
    .refine((v) => v === undefined || v > 0, `${label} must be more than 0`)

const productForm = z.object({
  id: rowId,
  expectUpdatedAt: z.string().min(1),
  price: shekels('Price'),
  original_price: shekels('Original price'),
  clearOriginal: z.boolean(),
  quantity: z.string().trim().refine((v) => v === '' || /^\d{1,6}$/.test(v), 'Quantity must be a whole number from 0').transform((v) => (v === '' ? undefined : Number(v))),
  featured: z.enum(['keep', 'yes', 'no']),
})

export async function updateProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to edit products.' }
  }
  const parsed = productForm.safeParse({
    id: form.get('id'),
    expectUpdatedAt: form.get('expectUpdatedAt'),
    price: String(form.get('price') ?? ''),
    original_price: String(form.get('original_price') ?? ''),
    clearOriginal: form.get('clearOriginal') === 'on',
    quantity: String(form.get('quantity') ?? ''),
    featured: form.get('featured') ?? 'keep',
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message }
  const p = parsed.data
  const patch: ProductPatch = {}
  if (p.price !== undefined) patch.price = p.price
  if (p.clearOriginal) patch.original_price = null
  else if (p.original_price !== undefined) patch.original_price = p.original_price
  if (p.quantity !== undefined) patch.quantity = p.quantity
  if (p.featured !== 'keep') patch.featured = p.featured === 'yes'
  if (!Object.keys(patch).length) return { ok: false, message: 'Nothing to change: fill in at least one field.' }
  if (patch.price !== undefined && patch.original_price != null && patch.original_price <= patch.price) {
    return { ok: false, message: 'The strike-through price must be higher than the price.' }
  }

  const target = `product:${p.id}`
  const before = { price: form.get('was_price'), original_price: form.get('was_original_price'), quantity: form.get('was_quantity'), featured: form.get('was_featured') }
  const detail = { slug: String(form.get('slug') ?? '').slice(0, 120), patch, asLoaded: before }
  await audit(user, { action: 'website.product.update', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await updateWebsiteProduct(p.id, patch, p.expectUpdatedAt)
    await audit(user, { action: 'website.product.update', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/products')
    if (!res.ok) return { ok: false, message: res.conflict ? `${res.message}` : `Not saved: ${res.message}` }
    return { ok: true, message: 'Saved. The shop shows it now; the pre-rendered product page for search engines updates on the next website deploy.' }
  } catch (e) {
    await audit(user, { action: 'website.product.update', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
}

// ── Site content ──────────────────────────────────────────────────────────────

const contentKey = z.string().regex(/^[a-z0-9_]{1,80}$/)
/** "" from a hidden input = the key had no stored row when the page loaded. */
const expectAt = (v: FormDataEntryValue | null) => (typeof v === 'string' && v ? v : null)
/** Public site text, so the audit keeps it — trimmed, so one log row stays small. */
const clip = (v: string) => (v.length > 600 ? `${v.slice(0, 600)}…` : v)

type ContentWrite = { ok: true } | { ok: false; message: string }

async function writeContent(user: Awaited<ReturnType<typeof requirePermission>>, key: string, value: string, expectUpdatedAt: string | null, before: string): Promise<ContentWrite> {
  const target = `content:${key}`
  const detail = { before: clip(before), after: clip(value) }
  await audit(user, { action: 'website.content.set', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await setWebsiteContent(key, value, expectUpdatedAt)
    await audit(user, { action: 'website.content.set', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    return res.ok ? { ok: true } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.content.set', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: fail(e) }
  }
}

async function contentWriter() {
  try {
    return await requirePermission('website:write')
  } catch {
    return null
  }
}

export async function setContentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await contentWriter()
  if (!user) return { ok: false, message: 'You do not have permission to edit site content.' }
  const key = contentKey.safeParse(form.get('key'))
  if (!key.success) return { ok: false, message: 'Invalid content key.' }
  const value = String(form.get('value') ?? '')
  const before = String(form.get('was') ?? '')
  if (value === before) return { ok: false, message: 'Nothing changed.' }
  const res = await writeContent(user, key.data, value, expectAt(form.get('expectUpdatedAt')), before)
  revalidatePath('/website/content')
  return res.ok ? { ok: true, message: 'Saved. The live site shows it now.' } : { ok: false, message: `Not saved: ${res.message}` }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** The manager's שעות החנות tab: mode, hours and days, each key written only if it changed. */
export async function saveShopHoursAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await contentWriter()
  if (!user) return { ok: false, message: 'You do not have permission to change shop hours.' }
  const mode = String(form.get('shop_status_override') ?? '')
  const from = String(form.get('shop_open_from') ?? '')
  const to = String(form.get('shop_open_to') ?? '')
  const days = form.getAll('day').map(String).filter((d) => /^[0-6]$/.test(d))
  if (!['auto', 'open', 'closed'].includes(mode)) return { ok: false, message: 'Choose automatic, open or closed.' }
  if (!HHMM.test(from) || !HHMM.test(to)) return { ok: false, message: 'Hours must be times like 17:00.' }
  const next: Record<string, string> = {
    shop_status_override: mode,
    shop_open_from: from,
    shop_open_to: to,
    shop_open_days: [...new Set(days)].sort().join(','),
  }
  const changed = Object.entries(next).filter(([k, v]) => v !== String(form.get(`was_${k}`) ?? ''))
  if (!changed.length) return { ok: false, message: 'Nothing changed.' }
  const failed: string[] = []
  for (const [k, v] of changed) {
    const res = await writeContent(user, k, v, expectAt(form.get(`at_${k}`)), String(form.get(`was_${k}`) ?? ''))
    if (!res.ok) failed.push(`${k}: ${res.message}`)
  }
  revalidatePath('/website/content')
  if (failed.length === changed.length) return { ok: false, message: `Not saved. ${failed.join(' · ')}` }
  if (failed.length) return { ok: false, message: `Partly saved. Not saved: ${failed.join(' · ')}. Reload to see what the site has now.` }
  return { ok: true, message: 'Saved. Online payment follows the new hours now.' }
}

const partnerName = z.string().trim().min(1).max(100)
const partnerLogo = z.string().trim().max(2000)

/** The manager's שותפים tab: the partner logos on the home page (one JSON key). */
export async function savePartnersAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await contentWriter()
  if (!user) return { ok: false, message: 'You do not have permission to edit partners.' }
  const names = form.getAll('name').map(String)
  const logos = form.getAll('logo').map(String)
  const removed = new Set(form.getAll('remove').map(String))
  const list: { name: string; logo: string }[] = []
  for (let i = 0; i < names.length; i++) {
    if (removed.has(String(i))) continue
    const n = partnerName.safeParse(names[i])
    const l = partnerLogo.safeParse(logos[i])
    if (!n.success || !l.success) return { ok: false, message: `Partner ${i + 1} needs a name.` }
    list.push({ name: n.data, logo: l.data })
  }
  const newName = String(form.get('new_name') ?? '').trim()
  const newLogo = String(form.get('new_logo') ?? '').trim()
  if (newName || newLogo) {
    if (!partnerName.safeParse(newName).success || !newLogo || !partnerLogo.safeParse(newLogo).success) return { ok: false, message: 'A new partner needs both a name and a logo link.' }
    list.push({ name: newName, logo: newLogo })
  }
  const value = JSON.stringify(list)
  const before = String(form.get('was') ?? '')
  if (value === before) return { ok: false, message: 'Nothing changed.' }
  const res = await writeContent(user, PARTNERS_KEY, value, expectAt(form.get('expectUpdatedAt')), before)
  revalidatePath('/website/content')
  return res.ok ? { ok: true, message: `Saved. ${list.length} partner${list.length === 1 ? '' : 's'} on the home page.` } : { ok: false, message: `Not saved: ${res.message}` }
}

// ── Reviews ──────────────────────────────────────────────────────────────────

const reviewIds = z.array(z.coerce.number().int().positive()).min(1, 'Select at least one review.').max(100, 'At most 100 reviews at once.')

/** approve | hide | delete, for one review or the ticked ones. Delete cannot be undone; hide can. */
export async function moderateReviewsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to moderate reviews.' }
  }
  const op = z.enum(['approve', 'hide', 'delete']).safeParse(form.get('op'))
  const ids = reviewIds.safeParse(form.getAll('id'))
  if (!op.success) return { ok: false, message: 'Unknown action.' }
  if (!ids.success) return { ok: false, message: ids.error.issues[0]!.message }
  const action = op.data === 'delete' ? 'website.review.delete' : 'website.review.set_approved'
  const target = ids.data.length === 1 ? `review:${ids.data[0]}` : `reviews:${ids.data.length}`
  const detail = { op: op.data, ids: ids.data }
  await audit(user, { action, product: 'website', target, outcome: 'requested', detail })
  try {
    const res = op.data === 'delete' ? await deleteWebsiteReviews(ids.data) : await setWebsiteReviewsApproved(ids.data, op.data === 'approve')
    await audit(user, { action, product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? { ...detail, affected: res.value } : { ...detail, message: res.message } })
    revalidatePath('/website/reviews')
    if (!res.ok) return { ok: false, message: `Not changed: ${res.message}` }
    const n = res.value.length
    const verb = op.data === 'delete' ? 'Deleted' : op.data === 'approve' ? 'Approved (now on the site)' : 'Hidden from the site'
    return { ok: true, message: `${verb}: ${n} review${n === 1 ? '' : 's'}.${n < ids.data.length ? ' Some were already gone.' : ''}` }
  } catch (e) {
    await audit(user, { action, product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

export async function replyReviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to reply to reviews.' }
  }
  const id = rowId.safeParse(form.get('id'))
  const reply = z.string().max(2000, 'A reply is limited to 2000 characters.').safeParse(String(form.get('reply') ?? '').trim())
  if (!id.success) return { ok: false, message: 'Invalid review.' }
  if (!reply.success) return { ok: false, message: reply.error.issues[0]!.message }
  const target = `review:${id.data}`
  const detail = { before: clip(String(form.get('was') ?? '')), after: clip(reply.data) }
  await audit(user, { action: 'website.review.reply', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await setWebsiteReviewReply(id.data, reply.data)
    await audit(user, { action: 'website.review.reply', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/reviews')
    return res.ok ? { ok: true, message: 'Reply saved.' } : { ok: false, message: `Not saved: ${res.message}` }
  } catch (e) {
    await audit(user, { action: 'website.review.reply', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
}

// ── Blog ─────────────────────────────────────────────────────────────────────

const opt = (max: number, label: string) => z.string().trim().max(max, `${label} is limited to ${max} characters.`).transform((v) => v || null)
const postForm = z.object({
  title_he: z.string().trim().min(1, 'The Hebrew title is required.').max(200, 'The title is limited to 200 characters.'),
  title_en: opt(200, 'The English title'),
  slug: z.string().trim().regex(/^[a-z0-9_]+(?:-[a-z0-9_]+)*$/, 'The address may use lowercase English letters, digits and dashes only, like how-to-restore-wood.').max(80),
  excerpt_he: opt(1000, 'The excerpt'),
  content_he: opt(60000, 'The article'),
  cover_image: opt(2000, 'The cover image link'),
  images: z.string().transform((v) => v.split('\n').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.string().max(2000)).max(30, 'Up to 30 gallery images.')),
  category: opt(60, 'The category'),
  tags: z.string().transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.string().max(40, 'A tag is limited to 40 characters.')).max(20, 'Up to 20 tags.')),
  author: opt(80, 'The author'),
  published: z.boolean(),
  featured: z.boolean(),
})

export async function saveBlogPostAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to edit blog posts.' }
  }
  const str = (k: string) => String(form.get(k) ?? '')
  const parsed = postForm.safeParse({
    title_he: str('title_he'), title_en: str('title_en'), slug: str('slug'), excerpt_he: str('excerpt_he'), content_he: str('content_he'),
    cover_image: str('cover_image'), images: str('images'), category: str('category'), tags: str('tags'), author: str('author'),
    published: form.get('published') === 'on', featured: form.get('featured') === 'on',
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message }
  const post: WebsitePostInput = parsed.data
  const existing = form.get('id') ? rowId.safeParse(form.get('id')) : null
  if (existing && !existing.success) return { ok: false, message: 'Invalid post.' }
  const id = existing?.data
  const expect = str('expectUpdatedAt')
  if (id && !expect) return { ok: false, message: 'Reload the post and try again.' }

  const action = id ? 'website.blog.update' : 'website.blog.create'
  const target = id ? `post:${id}` : `post:${post.slug}`
  // Published text is public; the log keeps what changed in the listing, not the whole article.
  const detail = { slug: post.slug, title: post.title_he, published: post.published, featured: post.featured, contentLength: post.content_he?.length ?? 0, wasPublished: form.get('wasPublished') === 'true' }
  await audit(user, { action, product: 'website', target, outcome: 'requested', detail })
  let saved
  try {
    const res = await saveWebsitePost(post, id, id ? expect : undefined)
    await audit(user, { action, product: 'website', target: `post:${res.ok ? res.value.id : (id ?? post.slug)}`, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    if (!res.ok) return { ok: false, message: res.conflict ? res.message : `Not saved: ${res.message}` }
    saved = res.value
  } catch (e) {
    await audit(user, { action, product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
  revalidatePath('/website/blog')
  if (!id) redirect(`/website/blog/${saved.id}?created=1`)
  revalidatePath(`/website/blog/${id}`)
  return { ok: true, message: post.published ? 'Saved. It is live on the blog now; the pre-rendered page for search engines updates on the next website deploy.' : 'Saved as a draft (not shown on the site).' }
}

export async function deleteBlogPostAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to delete blog posts.' }
  }
  const id = rowId.safeParse(form.get('id'))
  const expect = String(form.get('expectUpdatedAt') ?? '')
  if (!id.success || !expect) return { ok: false, message: 'Invalid post.' }
  const target = `post:${id.data}`
  const detail = { slug: String(form.get('slug') ?? '').slice(0, 80), title: String(form.get('title') ?? '').slice(0, 200) }
  await audit(user, { action: 'website.blog.delete', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await deleteWebsitePost(id.data, expect)
    await audit(user, { action: 'website.blog.delete', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    if (!res.ok) return { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.blog.delete', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not deleted: ${fail(e)}` }
  }
  revalidatePath('/website/blog')
  redirect('/website/blog?deleted=1')
}

// ── Products (full form) ─────────────────────────────────────────────────────

const shekelField = (label: string) =>
  z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, `${label} must be an amount in shekels, like 120 or 89.90.`).transform(Number)
const lines = (max: number, label: string) =>
  z.string().transform((v) => v.split('\n').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.string().max(2000)).max(max, `Up to ${max} ${label}.`))
const fullProductForm = z
  .object({
    name_he: z.string().trim().min(1, 'The Hebrew name is required.').max(200, 'The name is limited to 200 characters.'),
    name_en: opt(200, 'The English name'),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'The address may use lowercase English letters, digits and dashes only, like teak-armchair.').max(80),
    description_he: opt(10000, 'The Hebrew description'),
    description_en: opt(10000, 'The English description'),
    story_he: opt(10000, 'The Hebrew story'),
    story_en: opt(10000, 'The English story'),
    price: shekelField('The price').refine((n) => n > 0, 'The price must be above ₪0.'),
    original_price: z.union([z.literal('').transform(() => null), shekelField('The strike-through price')]),
    category_id: z.union([z.literal('').transform(() => null), z.coerce.number().int().positive()]),
    condition: z.enum(PRODUCT_CONDITIONS),
    style: opt(100, 'Style'),
    dimensions: opt(200, 'Dimensions'),
    material: opt(200, 'Material'),
    origin: opt(200, 'Origin'),
    image_url: z.string().trim().min(1, 'A main image is required.').max(2000),
    images: lines(30, 'gallery images'),
    featured: z.boolean(),
    quantity: z.string().trim().regex(/^\d{1,6}$/, 'Quantity must be a whole number from 0.').transform(Number),
    tags: z.string().transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.string().max(40, 'A tag is limited to 40 characters.')).max(20, 'Up to 20 tags.')),
    published: z.boolean().optional(),
  })
  .refine((p) => p.original_price == null || p.original_price > p.price, { message: 'The strike-through price must be higher than the price.' })

export async function saveProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to edit products.' }
  }
  const str = (k: string) => String(form.get(k) ?? '')
  const parsed = fullProductForm.safeParse({
    name_he: str('name_he'), name_en: str('name_en'), slug: str('slug'), description_he: str('description_he'), description_en: str('description_en'),
    story_he: str('story_he'), story_en: str('story_en'), price: str('price'), original_price: str('original_price'), category_id: str('category_id'),
    condition: str('condition'), style: str('style'), dimensions: str('dimensions'), material: str('material'), origin: str('origin'),
    image_url: str('image_url'), images: str('images'), featured: form.get('featured') === 'on', quantity: str('quantity'), tags: str('tags'),
    // Only sent when the website has the published column (the form shows the box only then).
    published: form.get('hasPublished') === '1' ? form.get('published') === 'on' : undefined,
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message }
  const product: WebsiteProductInput = parsed.data
  const existing = form.get('id') ? rowId.safeParse(form.get('id')) : null
  if (existing && !existing.success) return { ok: false, message: 'Invalid product.' }
  const id = existing?.data
  const expect = str('expectUpdatedAt')
  if (id && !expect) return { ok: false, message: 'Reload the product and try again.' }

  const action = id ? 'website.product.edit' : 'website.product.create'
  const target = id ? `product:${id}` : `product:${product.slug}`
  const detail = {
    slug: product.slug, name: product.name_he, price: product.price, originalPrice: product.original_price, quantity: product.quantity,
    featured: product.featured, published: product.published ?? null, categoryId: product.category_id,
    before: id ? { slug: str('was_slug'), price: str('was_price'), quantity: str('was_quantity'), published: str('was_published') } : null,
  }
  await audit(user, { action, product: 'website', target, outcome: 'requested', detail })
  let saved
  try {
    const res = await saveWebsiteProduct(product, id, id ? expect : undefined)
    await audit(user, { action, product: 'website', target: `product:${res.ok ? res.value.id : (id ?? product.slug)}`, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    if (!res.ok) return { ok: false, message: res.conflict ? res.message : `Not saved: ${res.message}` }
    saved = res.value
  } catch (e) {
    await audit(user, { action, product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
  revalidatePath('/website/products')
  if (!id) redirect(`/website/products/${saved.id}?created=1`)
  revalidatePath(`/website/products/${id}`)
  return { ok: true, message: saved.published === false ? 'Saved as a draft (not shown in the shop).' : 'Saved. The shop shows it now; the pre-rendered product page updates on the next website deploy.' }
}

export async function deleteProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to delete products.' }
  }
  const id = rowId.safeParse(form.get('id'))
  const expect = String(form.get('expectUpdatedAt') ?? '')
  if (!id.success || !expect) return { ok: false, message: 'Invalid product.' }
  const target = `product:${id.data}`
  const detail = { slug: String(form.get('slug') ?? '').slice(0, 80), name: String(form.get('name') ?? '').slice(0, 200) }
  await audit(user, { action: 'website.product.delete', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await deleteWebsiteProduct(id.data, expect)
    await audit(user, { action: 'website.product.delete', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    if (!res.ok) return { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.product.delete', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not deleted: ${fail(e)}` }
  }
  revalidatePath('/website/products')
  redirect('/website/products?deleted=1')
}

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to add categories.' }
  }
  const nameHe = String(form.get('name_he') ?? '').trim()
  const nameEn = String(form.get('name_en') ?? '').trim()
  if (!nameHe || nameHe.length > 100 || nameEn.length > 100) return { ok: false, message: 'A Hebrew name (up to 100 characters) is required.' }
  const detail = { nameHe, nameEn: nameEn || null }
  await audit(user, { action: 'website.category.create', product: 'website', target: `category:${nameEn || nameHe}`, outcome: 'requested', detail })
  try {
    const res = await createWebsiteCategory(nameHe, nameEn || null)
    await audit(user, { action: 'website.category.create', product: 'website', target: `category:${res.ok ? res.value.id : nameEn || nameHe}`, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/products', 'layout')
    return res.ok ? { ok: true, message: `Category "${res.value.name_he}" added. Pick it in the list above.` } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.category.create', product: 'website', target: `category:${nameEn || nameHe}`, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not added: ${fail(e)}` }
  }
}

export async function setLowStockAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to change this.' }
  }
  const n = z.coerce.number().int().min(0).max(1000).safeParse(String(form.get('threshold') ?? '').trim() || 'x')
  if (!n.success) return { ok: false, message: 'Enter a whole number from 0 to 1000.' }
  const detail = { to: n.data, from: String(form.get('was') ?? '') }
  await audit(user, { action: 'website.products.low_stock', product: 'website', target: 'site_content:low_stock_threshold', outcome: 'requested', detail })
  try {
    const res = await setWebsiteLowStockThreshold(n.data)
    await audit(user, { action: 'website.products.low_stock', product: 'website', target: 'site_content:low_stock_threshold', outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/products')
    return res.ok ? { ok: true, message: `Low-stock alert is now ${res.value} or fewer.` } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.products.low_stock', product: 'website', target: 'site_content:low_stock_threshold', outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
}

// ── Marketing ────────────────────────────────────────────────────────────────

const discountForm = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, 'A code is 2–30 English letters, digits, dashes or underscores.'),
    type: z.enum(['percent', 'amount']),
    value: z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/, 'Enter the discount as a number, like 10 or 49.90.').transform(Number),
    expiresAt: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be a date.')]),
    usageLimit: z.union([z.literal(''), z.string().regex(/^\d{1,7}$/, 'The usage limit is a whole number.')]),
    minOrder: z.union([z.literal(''), z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'The minimum order is an amount in shekels.')]),
    notes: z.string().trim().max(500, 'Notes are limited to 500 characters.'),
    active: z.boolean(),
  })
  .refine((d) => d.value > 0, { message: 'The discount must be above 0.' })
  .refine((d) => d.type === 'amount' || (Number.isInteger(d.value) && d.value <= 100), { message: 'A percent discount is a whole number from 1 to 100.' })
  .refine((d) => d.usageLimit === '' || Number(d.usageLimit) >= 1, { message: 'The usage limit is at least 1.' })

export async function saveDiscountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to change discount codes.' }
  }
  const str = (k: string) => String(form.get(k) ?? '')
  const mode = str('mode') === 'update' ? 'update' : 'create'
  const parsed = discountForm.safeParse({
    code: str('code'), type: str('type'), value: str('value'), expiresAt: str('expiresAt'), usageLimit: str('usageLimit'),
    minOrder: str('minOrder'), notes: str('notes'), active: form.get('active') === 'on',
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message }
  const d = parsed.data
  const code: WebsiteDiscountInput = {
    code: d.code, type: d.type, value: d.value, active: d.active,
    ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
    ...(d.usageLimit ? { usageLimit: Number(d.usageLimit) } : {}),
    ...(d.minOrder ? { minOrder: Number(d.minOrder) } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
  }
  const action = mode === 'create' ? 'website.discount.create' : 'website.discount.update'
  const target = `discount:${code.code}`
  const detail = { ...code, before: mode === 'update' ? str('was').slice(0, 500) : null }
  await audit(user, { action, product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await saveWebsiteDiscount(code, mode)
    await audit(user, { action, product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/marketing')
    if (!res.ok) return { ok: false, message: res.message }
    return { ok: true, message: `${res.value.code} saved${res.value.active ? ' and usable at checkout now' : ' (inactive)'}.` }
  } catch (e) {
    await audit(user, { action, product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not saved: ${fail(e)}` }
  }
}

export async function deleteDiscountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to delete discount codes.' }
  }
  const code = String(form.get('code') ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return { ok: false, message: 'Invalid code.' }
  const target = `discount:${code}`
  const detail = { code, before: String(form.get('was') ?? '').slice(0, 500) }
  await audit(user, { action: 'website.discount.delete', product: 'website', target, outcome: 'requested', detail })
  try {
    const res = await deleteWebsiteDiscount(code)
    await audit(user, { action: 'website.discount.delete', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/website/marketing')
    return res.ok ? { ok: true, message: `${code} deleted.` } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.discount.delete', product: 'website', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not deleted: ${fail(e)}` }
  }
}

export async function deleteSubscriberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to remove subscribers.' }
  }
  const s = await getSession()
  if (!s || !can(s.user.role, 'website:read_pii', s.overrides)) return { ok: false, message: 'Your role cannot see or change customer details.' }
  const id = rowId.safeParse(form.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid subscriber.' }
  const target = `subscriber:${id.data}`
  // The address itself stays out of the audit log; the id is enough to trace it on the website.
  await audit(user, { action: 'website.subscriber.delete', product: 'website', target, outcome: 'requested', detail: {} })
  try {
    const res = await deleteWebsiteSubscriber(id.data)
    await audit(user, { action: 'website.subscriber.delete', product: 'website', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? {} : { message: res.message } })
    revalidatePath('/website/marketing')
    return res.ok ? { ok: true, message: 'Unsubscribed.' } : { ok: false, message: res.message }
  } catch (e) {
    await audit(user, { action: 'website.subscriber.delete', product: 'website', target, outcome: 'failed', detail: { error: fail(e) } })
    return { ok: false, message: `Not removed: ${fail(e)}` }
  }
}
