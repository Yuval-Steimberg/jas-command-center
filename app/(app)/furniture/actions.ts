'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { DESTINATIONS, setItemDestination, setProjectArchived } from '@/lib/integrations/furniture/manage'

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
