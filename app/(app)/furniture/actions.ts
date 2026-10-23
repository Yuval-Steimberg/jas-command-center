'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { DESTINATIONS, setItemDestination, setProjectArchived } from '@/lib/integrations/furniture/manage'
import { fieldMessage, runFieldAction, type FieldAction } from '@/lib/integrations/furniture/field'

export type ActionState = { ok?: boolean; message?: string }

const uuid = z.string().uuid()
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Furniture writes are the same column updates the field app makes, through
 * its database, so its triggers still apply. Audited here as requested, then
 * the outcome the database confirmed.
 */
export async function setArchivedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('furniture:operate')
  } catch {
    return { ok: false, message: 'You do not have permission to archive projects.' }
  }
  const id = uuid.safeParse(form.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid project.' }
  const archived = form.get('archived') === 'true'
  const target = `project:${id.data}`
  const action = archived ? 'furniture.project.archive' : 'furniture.project.unarchive'
  const detail = { name: String(form.get('name') ?? '').slice(0, 200) }
  await audit(user, { action, product: 'furniture', target, outcome: 'requested', detail })
  try {
    const res = await setProjectArchived(id.data, archived)
    await audit(user, { action, product: 'furniture', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? detail : { ...detail, message: res.message } })
    revalidatePath('/furniture')
    revalidatePath(`/furniture/${id.data}`)
    if (!res.ok) return { ok: false, message: res.message }
    return { ok: true, message: archived ? 'Archived. The field app now shows it only under ארכיון.' : 'Taken out of the archive.' }
  } catch (e) {
    await audit(user, { action, product: 'furniture', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

const destination = z.enum(DESTINATIONS.map((d) => d.id) as [string, ...string[]])

export async function setDestinationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('furniture:write')
  } catch {
    return { ok: false, message: 'You do not have permission to change items.' }
  }
  const id = uuid.safeParse(form.get('id'))
  const to = destination.safeParse(form.get('to'))
  const expect = z.string().min(1).safeParse(form.get('expectUpdatedAt'))
  if (!id.success || !expect.success) return { ok: false, message: 'Invalid item.' }
  if (!to.success) return { ok: false, message: 'Pick a destination.' }
  const from = String(form.get('from') ?? '')
  if (from === to.data) return { ok: false, message: 'The item already has that destination.' }
  const target = `item:${id.data}`
  const detail = { from: from || null, to: to.data, project: String(form.get('projectId') ?? '') }
  await audit(user, { action: 'furniture.item.set_destination', product: 'furniture', target, outcome: 'requested', detail })
  try {
    const res = await setItemDestination(id.data, to.data as (typeof DESTINATIONS)[number]['id'], expect.data)
    await audit(user, { action: 'furniture.item.set_destination', product: 'furniture', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? { ...detail, intendedForCollection: res.value.intended_for_collection } : { ...detail, message: res.message } })
    if (detail.project) revalidatePath(`/furniture/${detail.project}`)
    if (!res.ok) return { ok: false, message: res.message }
    return { ok: true, message: res.value.intended_for_collection ? 'Moved. It is now on the collection list.' : 'Moved. It is no longer on the collection list.' }
  } catch (e) {
    await audit(user, { action: 'furniture.item.set_destination', product: 'furniture', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

// ── Field actions, through the field app's own endpoint ──────────────────
// Collect / finish / reopen / handover carry rules (collector name, automatic
// apartment completion, the outstanding-items confirmation, third-party only)
// that live in Furniture-Collect. Its /api/command-center applies them; this
// side checks the permission, audits, and forwards.

export type FieldState = ActionState & { needsConfirmation?: boolean; outstanding?: number }

async function field(
  form: FormData,
  auditAction: string,
  target: string,
  build: () => FieldAction | null,
  success: (body: Record<string, unknown>) => string,
): Promise<FieldState> {
  let user
  try {
    user = await requirePermission('furniture:operate')
  } catch {
    return { ok: false, message: 'Your role cannot make field changes.' }
  }
  const input = build()
  if (!input) return { ok: false, message: 'Invalid request.' }
  const projectId = String(form.get('projectId') ?? '')
  const detail = { ...input, project: projectId, label: String(form.get('label') ?? '').slice(0, 200) }
  await audit(user, { action: auditAction, product: 'furniture', target, outcome: 'requested', detail })
  try {
    const res = await runFieldAction(input, { email: user.email, name: user.name })
    await audit(user, { action: auditAction, product: 'furniture', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? { ...detail, result: res.body } : { ...detail, error: res.error, status: res.status } })
    if (uuid.safeParse(projectId).success) revalidatePath(`/furniture/${projectId}`)
    if (res.ok) return { ok: true, message: success(res.body) }
    if (res.error === 'not_configured') return { ok: false, message: `Not connected: set ${((res.body.missing as string[]) ?? []).join(', ')}.` }
    const state = (res.body.state ?? {}) as { outstanding?: number; message?: string }
    if (res.error === 'needs_confirmation') return { ok: false, needsConfirmation: true, outstanding: state.outstanding, message: state.message ?? fieldMessage(res.error) }
    return { ok: false, message: fieldMessage(res.error) }
  } catch (e) {
    await audit(user, { action: auditAction, product: 'furniture', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

export async function collectAction(_prev: FieldState, form: FormData): Promise<FieldState> {
  const id = uuid.safeParse(form.get('id'))
  const expect = z.string().min(1).safeParse(form.get('expectUpdatedAt'))
  const collected = form.get('collected') === 'true'
  return field(form, collected ? 'furniture.item.collect' : 'furniture.item.uncollect', `item:${id.data ?? ''}`,
    () => (id.success && expect.success ? { action: 'collect', itemId: id.data, collected, expectUpdatedAt: expect.data } : null),
    (b) => (collected ? (b.apartmentCompleted ? 'Marked collected. That was the last one: the apartment is now complete.' : 'Marked collected.') : 'Collection undone.'))
}

export async function finishApartmentAction(_prev: FieldState, form: FormData): Promise<FieldState> {
  const id = uuid.safeParse(form.get('id'))
  const confirmOutstanding = form.get('confirmOutstanding') === 'true'
  return field(form, 'furniture.apartment.finish', `apartment:${id.data ?? ''}`,
    () => (id.success ? { action: 'finish_apartment', apartmentId: id.data, confirmOutstanding } : null),
    (b) => (b.unchanged ? 'It was already complete.' : 'Apartment marked complete.'))
}

export async function reopenApartmentAction(_prev: FieldState, form: FormData): Promise<FieldState> {
  const id = uuid.safeParse(form.get('id'))
  return field(form, 'furniture.apartment.reopen', `apartment:${id.data ?? ''}`,
    () => (id.success ? { action: 'reopen_apartment', apartmentId: id.data } : null),
    (b) => (b.unchanged ? 'It was not complete.' : 'Reopened. The apartment is back in documentation.'))
}

export async function handoverAction(_prev: FieldState, form: FormData): Promise<FieldState> {
  const id = uuid.safeParse(form.get('id'))
  const expect = z.string().min(1).safeParse(form.get('expectUpdatedAt'))
  const confirm = form.get('confirm') === 'true'
  const recipient = z.string().trim().max(120).safeParse(form.get('recipient') ?? '')
  return field(form, confirm ? 'furniture.item.handover_confirm' : 'furniture.item.handover_clear', `item:${id.data ?? ''}`,
    () => (id.success && expect.success && recipient.success ? { action: 'handover', itemId: id.data, confirm, recipient: recipient.data || null, expectUpdatedAt: expect.data } : null),
    () => (confirm ? 'Handover confirmed. It now counts as confirmed recycling.' : 'Handover cleared.'))
}
