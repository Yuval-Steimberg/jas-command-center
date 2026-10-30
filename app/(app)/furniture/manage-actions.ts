'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import type { Permission } from '@/lib/auth/rbac'
import { fieldMessage, runFieldOp } from '@/lib/integrations/furniture/field'

/**
 * Everything else the field app's screens write, sent to its own endpoint
 * (Furniture-Collect src/server/manage.ts), which builds each row with the
 * module its screen uses. This side checks the permission, audits requested →
 * outcome, and forwards. Nothing is retried: a 409 is an answer.
 *
 * Permissions: `furniture:operate` for work on items (what a crew does),
 * `furniture:write` for structure and deletes (projects, buildings,
 * apartments, members, deleting items).
 */

export type OpState = { ok?: boolean; message?: string; id?: string; at?: number }

const uuid = z.string().uuid()
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))
const text = (form: FormData, k: string, max = 2000) => String(form.get(k) ?? '').slice(0, max)

async function op(
  permission: Permission,
  auditAction: string,
  target: string,
  projectId: string,
  action: string,
  payload: Record<string, unknown>,
  success: (body: Record<string, unknown>) => string,
  auditDetail: Record<string, unknown> = payload,
): Promise<OpState & { body?: Record<string, unknown> }> {
  let user
  try {
    user = await requirePermission(permission)
  } catch {
    return { ok: false, message: 'Your role cannot make this change.' }
  }
  const detail = { ...auditDetail, project: projectId }
  await audit(user, { action: auditAction, product: 'furniture', target, outcome: 'requested', detail })
  try {
    const res = await runFieldOp(action, payload, { email: user.email, name: user.name })
    await audit(user, { action: auditAction, product: 'furniture', target, outcome: res.ok ? 'succeeded' : 'failed', detail: res.ok ? { ...detail, result: res.body } : { ...detail, error: res.error, status: res.status, body: res.body } })
    revalidatePath('/furniture')
    if (uuid.safeParse(projectId).success) revalidatePath(`/furniture/${projectId}`, 'layout')
    if (res.ok) return { ok: true, message: success(res.body), body: res.body, at: Date.now() }
    if (res.error === 'not_configured') return { ok: false, message: `Not connected: set ${((res.body.missing as string[]) ?? []).join(', ')}.` }
    const extra = typeof res.body.message === 'string' ? ` ${res.body.message}` : typeof res.body.detail === 'string' ? ` (${res.body.detail})` : ''
    return { ok: false, message: `${fieldMessage(res.error)}${extra}`, body: res.body }
  } catch (e) {
    await audit(user, { action: auditAction, product: 'furniture', target, outcome: 'failed', detail: { ...detail, error: fail(e) } })
    return { ok: false, message: `Not changed: ${fail(e)}` }
  }
}

const strip = ({ body: _b, ...s }: OpState & { body?: unknown }): OpState => s

// ── Items ────────────────────────────────────────────────────────────────

const ITEM_FIELDS = ['description', 'item_category', 'quantity', 'location', 'item_type', 'material_category', 'gallery_type', 'dimensions', 'estimated_weight_kg', 'condition', 'dismantle_difficulty', 'notes'] as const

export async function editItemAction(_p: OpState, form: FormData): Promise<OpState> {
  const id = uuid.safeParse(form.get('id'))
  const expect = z.string().min(1).safeParse(form.get('expectUpdatedAt'))
  if (!id.success || !expect.success) return { ok: false, message: 'Invalid item.' }
  const fields: Record<string, unknown> = {}
  for (const k of ITEM_FIELDS) {
    if (!form.has(k)) continue
    const v = text(form, k).trim()
    fields[k] = k === 'quantity' ? Number(v) || 1 : k === 'estimated_weight_kg' ? (v === '' ? null : Number(v)) : v === '' ? null : v
  }
  return strip(await op('furniture:operate', 'furniture.item.edit', `item:${id.data}`, text(form, 'projectId'), 'edit_item',
    { itemId: id.data, expectUpdatedAt: expect.data, fields }, () => 'Saved in the field app.'))
}

export async function addItemsAction(_p: OpState, form: FormData): Promise<OpState> {
  const apartmentId = uuid.safeParse(form.get('apartmentId'))
  const body = text(form, 'text', 20_000).trim()
  if (!apartmentId.success || !body) return { ok: false, message: 'Type at least one item.' }
  return strip(await op('furniture:operate', 'furniture.items.add', `apartment:${apartmentId.data}`, text(form, 'projectId'), 'add_items',
    { apartmentId: apartmentId.data, text: body, galleryType: text(form, 'galleryType', 40) || undefined },
    (b) => `${b.added} item${b.added === 1 ? '' : 's'} added${b.asTyped ? ', saved as typed (the AI could not split the text). Each can be edited.' : '.'}`,
    { apartmentId: apartmentId.data, galleryType: text(form, 'galleryType', 40), chars: body.length }))
}

export async function bulkItemsAction(_p: OpState, form: FormData): Promise<OpState> {
  const ids = form.getAll('itemIds').map(String).filter((x) => uuid.safeParse(x).success)
  const projectId = text(form, 'projectId')
  const todo = text(form, 'todo', 40)
  if (!ids.length) return { ok: false, message: 'Tick at least one item.' }
  if (todo === 'delete') {
    return strip(await op('furniture:write', 'furniture.items.delete', `items:${ids.length}`, projectId, 'delete_items', { itemIds: ids },
      (b) => `${b.deleted} item${b.deleted === 1 ? '' : 's'} deleted.`))
  }
  const album = todo.replace(/^move:/, '')
  if (!todo.startsWith('move:') || !album) return { ok: false, message: 'Pick what to do with them.' }
  return strip(await op('furniture:write', 'furniture.items.move', `items:${ids.length}`, projectId, 'move_items', { itemIds: ids, album },
    (b) => `${b.moved} item${b.moved === 1 ? '' : 's'} moved.`))
}

export async function deleteItemAction(_p: OpState, form: FormData): Promise<OpState> {
  const id = uuid.safeParse(form.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid item.' }
  return strip(await op('furniture:write', 'furniture.items.delete', `item:${id.data}`, text(form, 'projectId'), 'delete_items', { itemIds: [id.data] },
    () => 'Deleted in the field app.', { itemIds: [id.data], label: text(form, 'label', 200) }))
}

// ── Photos ───────────────────────────────────────────────────────────────

const PHOTO_TYPES = new Set(['image/jpeg', 'image/webp', 'image/png'])
const MAX_PHOTO = 900 * 1024

/**
 * One photo: a signed upload into the field app's item-photos bucket, the
 * bytes PUT straight there, then the row (a new item, or appended to an
 * existing one). The description is a second call (`describePhotoAction`), so
 * a slow model never holds the photo hostage: it is saved either way.
 */
export async function addPhotoAction(form: FormData): Promise<OpState> {
  const apartmentId = uuid.safeParse(form.get('apartmentId'))
  const projectId = text(form, 'projectId')
  const itemId = form.get('itemId') ? uuid.safeParse(form.get('itemId')) : null
  const file = form.get('file')
  if (!apartmentId.success || (itemId && !itemId.success)) return { ok: false, message: 'Invalid apartment.' }
  if (!(file instanceof Blob) || !PHOTO_TYPES.has(file.type)) return { ok: false, message: 'Choose a JPEG, PNG or WebP photo.' }
  if (file.size > MAX_PHOTO) return { ok: false, message: 'The photo is still too large after resizing.' }

  const link = await op('furniture:operate', 'furniture.photo.upload_url', `apartment:${apartmentId.data}`, projectId, 'photo_upload',
    { apartmentId: apartmentId.data, contentType: file.type }, () => 'ok', { apartmentId: apartmentId.data, bytes: file.size })
  if (!link.ok) return strip(link)
  const signed = z.object({ path: z.string(), signedUrl: z.string().url() }).safeParse(link.body)
  if (!signed.success) return { ok: false, message: 'The field app gave no upload link.' }
  try {
    const put = await fetch(signed.data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: await file.arrayBuffer(), signal: AbortSignal.timeout(30_000) })
    if (!put.ok) return { ok: false, message: `The field app's storage refused the photo (HTTP ${put.status}). Nothing was saved.` }
  } catch (e) {
    return { ok: false, message: `The photo did not upload: ${fail(e)}. Nothing was saved.` }
  }
  const payload: Record<string, unknown> = { apartmentId: apartmentId.data, path: signed.data.path, galleryType: text(form, 'galleryType', 40) || undefined }
  if (itemId?.success) Object.assign(payload, { itemId: itemId.data, expectUpdatedAt: text(form, 'expectUpdatedAt', 100) })
  const r = await op('furniture:operate', itemId ? 'furniture.photo.attach' : 'furniture.photo.add', itemId ? `item:${itemId.data}` : `apartment:${apartmentId.data}`, projectId, 'add_photo', payload,
    () => (itemId ? 'Photo added to the item.' : 'Photo saved as a new item. Asking the AI what it shows…'))
  return { ...strip(r), id: typeof r.body?.itemId === 'string' ? r.body.itemId : undefined }
}

export async function describePhotoAction(projectId: string, itemId: string): Promise<OpState> {
  if (!uuid.safeParse(itemId).success) return { ok: false, message: 'Invalid item.' }
  return strip(await op('furniture:operate', 'furniture.photo.describe', `item:${itemId}`, projectId, 'describe_photo', { itemId },
    (b) => (b.described ? `The AI described it: ${String(b.description ?? '')}` : 'The AI could not describe it; the item keeps its placeholder and can be edited.')))
}

// ── Apartments ───────────────────────────────────────────────────────────

export async function addApartmentAction(_p: OpState, form: FormData): Promise<OpState> {
  const projectId = uuid.safeParse(form.get('projectId'))
  if (!projectId.success) return { ok: false, message: 'Invalid project.' }
  const payload = { projectId: projectId.data, building: text(form, 'building', 40).trim(), entrance: text(form, 'entrance', 20).trim(), number: text(form, 'number', 40).trim(), notes: text(form, 'notes') }
  if (!payload.building || !payload.number) return { ok: false, message: 'Give the building and the apartment number.' }
  return strip(await op('furniture:write', 'furniture.apartment.add', `project:${projectId.data}`, projectId.data, 'add_apartment', payload,
    () => `Apartment ${payload.number} added to building ${payload.building}.`))
}

export async function editApartmentAction(_p: OpState, form: FormData): Promise<OpState> {
  const id = uuid.safeParse(form.get('id'))
  const expect = z.string().min(1).safeParse(form.get('expectUpdatedAt'))
  if (!id.success || !expect.success) return { ok: false, message: 'Invalid apartment.' }
  return strip(await op('furniture:write', 'furniture.apartment.edit', `apartment:${id.data}`, text(form, 'projectId'), 'edit_apartment',
    { apartmentId: id.data, expectUpdatedAt: expect.data, number: text(form, 'number', 40), entrance: text(form, 'entrance', 20), notes: text(form, 'notes') },
    () => 'Apartment saved.'))
}

export async function deleteApartmentAction(_p: OpState, form: FormData): Promise<OpState> {
  const id = uuid.safeParse(form.get('id'))
  if (!id.success) return { ok: false, message: 'Invalid apartment.' }
  return strip(await op('furniture:write', 'furniture.apartment.delete', `apartment:${id.data}`, text(form, 'projectId'), 'delete_apartment', { apartmentId: id.data },
    () => 'Apartment deleted.', { apartmentId: id.data, label: text(form, 'label', 200) }))
}

// ── Buildings ────────────────────────────────────────────────────────────

export async function buildingAction(_p: OpState, form: FormData): Promise<OpState> {
  const projectId = uuid.safeParse(form.get('projectId'))
  if (!projectId.success) return { ok: false, message: 'Invalid project.' }
  const todo = text(form, 'todo', 20)
  const from = text(form, 'from', 40).trim()
  const to = text(form, 'to', 40).trim()
  if (todo === 'add') {
    if (!to) return { ok: false, message: 'Give the building a number.' }
    return strip(await op('furniture:write', 'furniture.building.add', `project:${projectId.data}`, projectId.data, 'add_building', { projectId: projectId.data, number: to }, () => `Building ${to} added.`))
  }
  if (todo === 'rename') {
    if (!from || !to) return { ok: false, message: 'Give the new number.' }
    return strip(await op('furniture:write', 'furniture.building.rename', `project:${projectId.data}`, projectId.data, 'rename_building', { projectId: projectId.data, from, to },
      (b) => (b.unchanged ? 'Nothing to change.' : `Building ${from} is now ${to} (${b.flats} apartment${b.flats === 1 ? '' : 's'}).`)))
  }
  if (todo === 'delete') {
    if (!from) return { ok: false, message: 'Invalid building.' }
    return strip(await op('furniture:write', 'furniture.building.delete', `project:${projectId.data}`, projectId.data, 'delete_building', { projectId: projectId.data, building: from },
      (b) => `Building ${from} deleted, with its ${b.flats} empty apartment${b.flats === 1 ? '' : 's'}.`))
  }
  return { ok: false, message: 'Invalid request.' }
}

// ── Projects ─────────────────────────────────────────────────────────────

export async function createProjectAction(_p: OpState, form: FormData): Promise<OpState> {
  const identity: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (k.startsWith('identity.') && typeof v === 'string') identity[k.slice(9)] = v.slice(0, 4000)
  const numbers = form.getAll('building_number').map(String)
  const counts = form.getAll('building_apartments').map((v) => Number(v) || 0)
  const buildings = numbers.map((n, i) => ({ building_number: n.trim(), apartments: counts[i] ?? 0 }))
  if (!identity.name?.trim()) return { ok: false, message: 'A project needs a name.' }
  const r = await op('furniture:write', 'furniture.project.create', `project:new`, '', 'create_project', { identity, buildings },
    (b) => `Project created: ${b.buildings} building${b.buildings === 1 ? '' : 's'}, ${b.apartments} apartment${b.apartments === 1 ? '' : 's'}.`,
    { name: identity.name, buildings: buildings.length })
  const id = typeof r.body?.projectId === 'string' ? r.body.projectId : undefined
  return { ...strip(r), id }
}

export async function editProjectAction(_p: OpState, form: FormData): Promise<OpState> {
  const projectId = uuid.safeParse(form.get('projectId'))
  if (!projectId.success) return { ok: false, message: 'Invalid project.' }
  const identity: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (k.startsWith('identity.') && typeof v === 'string') identity[k.slice(9)] = v.slice(0, 4000)
  return strip(await op('furniture:write', 'furniture.project.edit', `project:${projectId.data}`, projectId.data, 'edit_project', { projectId: projectId.data, identity },
    () => 'Project card saved in the field app.', { fields: Object.keys(identity) }))
}

// ── Members ──────────────────────────────────────────────────────────────

export async function memberAction(_p: OpState, form: FormData): Promise<OpState> {
  const projectId = uuid.safeParse(form.get('projectId'))
  const userId = uuid.safeParse(form.get('userId'))
  const todo = text(form, 'todo', 20)
  const role = text(form, 'role', 40)
  const label = text(form, 'label', 200)
  if (!projectId.success || !userId.success) return { ok: false, message: 'Pick a person.' }
  const map: Record<string, [string, string, string]> = {
    add: ['add_member', 'furniture.member.add', `${label || 'They'} added to the project.`],
    role: ['set_member_role', 'furniture.member.role', 'Role changed.'],
    remove: ['remove_member', 'furniture.member.remove', `${label || 'They'} removed from the project.`],
  }
  const m = map[todo]
  if (!m) return { ok: false, message: 'Invalid request.' }
  return strip(await op('furniture:write', m[1], `user:${userId.data}`, projectId.data, m[0], { projectId: projectId.data, userId: userId.data, role }, () => m[2]))
}
