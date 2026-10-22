'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getSession } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { editGiftCardRecipient, resendAllUndelivered, resendGiftCard } from '@/lib/integrations/gift-cards/adapter'

export type ActionState = { ok?: boolean; message?: string }

const id = z.string().uuid()
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters). It is stored in both audit logs.').max(500)
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Every write here calls the gift card system's OWN action through its
 * integration API — the same code /admin runs — and is audited twice: here
 * (requested, then the confirmed outcome) and in the gift card system's
 * audit_logs, which names the person. The result shown is what the gift card
 * system confirmed, never an optimistic "done".
 */
export async function resendCardAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('gift_cards:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to resend gift cards.' }
  }
  const cardId = id.safeParse(form.get('id'))
  const why = reason.safeParse(form.get('reason'))
  if (!cardId.success) return { ok: false, message: 'Invalid card.' }
  if (!why.success) return { ok: false, message: why.error.issues[0]!.message }
  const target = `card:${cardId.data}`
  await audit(user, { action: 'gift_cards.card.resend', product: 'gift_cards', target, outcome: 'requested', detail: { reason: why.data } })
  try {
    const res = await resendGiftCard(cardId.data, { email: user.email, role: user.role }, why.data)
    await audit(user, { action: 'gift_cards.card.resend', product: 'gift_cards', target, outcome: res.ok ? 'succeeded' : 'failed', detail: { message: res.message ?? null } })
    revalidatePath(`/gift-cards/${cardId.data}`)
    return res.ok ? { ok: true, message: 'Sent. The gift card system handed the email to its provider.' } : { ok: false, message: `Not sent: ${res.message ?? 'the gift card system processed no email'}` }
  } catch (e) {
    await audit(user, { action: 'gift_cards.card.resend', product: 'gift_cards', target, outcome: 'failed', detail: { error: fail(e) } })
    return { ok: false, message: `Resend failed: ${fail(e)}` }
  }
}

export async function editRecipientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('gift_cards:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to change gift cards.' }
  }
  const s = await getSession()
  // Changing a recipient means seeing and writing their contact details.
  if (!s || !can(s.user.role, 'gift_cards:read_pii', s.overrides)) return { ok: false, message: 'Your role cannot see or change customer contact details.' }
  const cardId = id.safeParse(form.get('id'))
  const why = reason.safeParse(form.get('reason'))
  if (!cardId.success) return { ok: false, message: 'Invalid card.' }
  if (!why.success) return { ok: false, message: why.error.issues[0]!.message }
  const text = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined
  }
  const fields = { recipientName: text('recipientName'), recipientEmail: text('recipientEmail'), recipientPhone: text('recipientPhone') }
  const changed = Object.entries(fields).filter(([, v]) => v).map(([k]) => k)
  if (!changed.length) return { ok: false, message: 'Nothing to change: fill in at least one field.' }
  const resend = form.get('resend') === 'on'
  const target = `card:${cardId.data}`
  await audit(user, { action: 'gift_cards.card.edit_recipient', product: 'gift_cards', target, outcome: 'requested', detail: { fields: changed, resend, reason: why.data } })
  try {
    const res = await editGiftCardRecipient(cardId.data, fields, resend, { email: user.email, role: user.role }, why.data)
    await audit(user, { action: 'gift_cards.card.edit_recipient', product: 'gift_cards', target, outcome: res.ok ? 'succeeded' : 'failed', detail: { resent: 'resent' in res ? (res.resent ?? false) : false, message: res.message ?? null } })
    revalidatePath(`/gift-cards/${cardId.data}`)
    if (!res.ok) return { ok: false, message: `Not changed: ${res.message}` }
    const resent = 'resent' in res && res.resent
    return { ok: true, message: resend ? (resent ? 'Recipient updated and the card was sent to the new details.' : `Recipient updated, but the resend did not go out: ${res.message ?? 'unknown reason'}`) : 'Recipient updated.' }
  } catch (e) {
    await audit(user, { action: 'gift_cards.card.edit_recipient', product: 'gift_cards', target, outcome: 'failed', detail: { error: fail(e) } })
    return { ok: false, message: `Update failed: ${fail(e)}` }
  }
}

export async function resendAllAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('gift_cards:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to resend gift cards.' }
  }
  await audit(user, { action: 'gift_cards.delivery.resend_all', product: 'gift_cards', target: 'delivery', outcome: 'requested', detail: {} })
  try {
    const res = await resendAllUndelivered({ email: user.email, role: user.role })
    if ('ok' in res) {
      await audit(user, { action: 'gift_cards.delivery.resend_all', product: 'gift_cards', target: 'delivery', outcome: 'failed', detail: { message: res.message } })
      return { ok: false, message: res.message }
    }
    const complete = res.delivered >= res.queued
    await audit(user, { action: 'gift_cards.delivery.resend_all', product: 'gift_cards', target: 'delivery', outcome: complete ? 'succeeded' : 'failed', detail: { queued: res.queued, delivered: res.delivered, rejected: res.rejected.length } })
    revalidatePath('/gift-cards')
    const rejected = res.rejected.length ? ` ${res.rejected.length} card(s) were rejected by the recipient's mail server and were not resent: fix their recipient first (${res.rejected.map((r) => r.maskedCode).join(', ')}).` : ''
    if (!res.queued) return { ok: true, message: `Nothing to resend.${rejected}` }
    return { ok: complete, message: `Sent ${res.delivered} of ${res.queued}.${complete ? '' : ' The email provider is still refusing some; check SendGrid.'}${rejected}` }
  } catch (e) {
    await audit(user, { action: 'gift_cards.delivery.resend_all', product: 'gift_cards', target: 'delivery', outcome: 'failed', detail: { error: fail(e) } })
    return { ok: false, message: `Resend failed: ${fail(e)}` }
  }
}
