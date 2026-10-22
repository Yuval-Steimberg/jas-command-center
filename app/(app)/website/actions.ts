'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSession, requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { audit } from '@/lib/audit/audit'
import { FULFILMENT, setWebsiteOrderNotes, setWebsiteOrderStatus, updateWebsiteProduct, type ProductPatch } from '@/lib/integrations/website/manage'

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
