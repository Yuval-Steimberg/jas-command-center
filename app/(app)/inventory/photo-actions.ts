'use server'

import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { getOpsStore } from '@/lib/ops'
import { describePhoto, type PhotoAiError, type PhotoFields } from '@/lib/inventory/ai'
import { MAX_PHOTO_BYTES, PHOTO_TYPES, uploadInventoryPhoto } from '@/lib/inventory/photos'
import { isPhotoHash, similarPhotos } from '@/lib/inventory/photo-hash'

/**
 * The photo half of intake (console and shop): store the photo, ask the AI
 * for suggested fields, and look for an item whose photo looks the same.
 * Nothing here creates or changes an item; the form is saved separately.
 */

async function user() {
  try {
    return await requirePermission('inventory:write')
  } catch {
    return null
  }
}

function fileOf(form: FormData): { ok: true; file: Blob; type: 'image/jpeg' | 'image/png' | 'image/webp' } | { ok: false; message: string } {
  const file = form.get('file')
  if (!(file instanceof Blob) || !PHOTO_TYPES.has(file.type)) return { ok: false, message: 'Choose a JPEG, PNG or WebP photo.' }
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, message: 'The photo is still too large after resizing. Try a smaller one.' }
  return { ok: true, file, type: file.type as 'image/jpeg' | 'image/png' | 'image/webp' }
}

export async function uploadItemPhotoAction(form: FormData): Promise<{ ok: boolean; url?: string; message?: string }> {
  const u = await user()
  if (!u) return { ok: false, message: 'Your role cannot add item photos.' }
  const f = fileOf(form)
  if (!f.ok) return f
  try {
    const url = await uploadInventoryPhoto(await f.file.arrayBuffer(), f.type)
    await audit(u, { action: 'inventory.photo.upload', product: 'inventory', target: url.slice(-120), outcome: 'succeeded', detail: { bytes: f.file.size, type: f.type } })
    return { ok: true, url }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await audit(u, { action: 'inventory.photo.upload', product: 'inventory', target: 'photo', outcome: 'failed', detail: { error: message } })
    return { ok: false, message: `Not uploaded: ${message}` }
  }
}

/** Audited as a request + outcome: the photo is sent to the model provider. */
export async function describeItemPhotoAction(form: FormData): Promise<{ ok: boolean; fields?: PhotoFields; code?: PhotoAiError; message?: string }> {
  const u = await user()
  if (!u) return { ok: false, message: 'Your role cannot add items.' }
  const f = fileOf(form)
  if (!f.ok) return f
  await audit(u, { action: 'inventory.photo.describe', product: 'inventory', target: 'photo', outcome: 'requested', detail: { bytes: f.file.size } })
  const r = await describePhoto(await f.file.arrayBuffer(), f.type)
  await audit(u, { action: 'inventory.photo.describe', product: 'inventory', target: 'photo', outcome: r.ok ? 'succeeded' : 'failed', detail: r.ok ? { category: r.fields.category } : { code: r.code, error: r.message.slice(0, 500) } })
  return r.ok ? { ok: true, fields: r.fields } : { ok: false, code: r.code }
}

export interface SimilarItem {
  id: string
  sku: string
  title: string
  photoUrl: string | null
  status: string
  distance: number
}

/** Items whose main photo looks like this one (a warning, never a block). */
export async function similarPhotosAction(hash: string): Promise<{ ok: boolean; items: SimilarItem[] }> {
  try {
    await requirePermission('inventory:read')
  } catch {
    return { ok: false, items: [] }
  }
  if (!isPhotoHash(hash)) return { ok: true, items: [] }
  try {
    const items = await getOpsStore().photoHashes()
    return { ok: true, items: similarPhotos(hash, items).slice(0, 3).map((i) => ({ id: i.id, sku: i.sku, title: i.title, photoUrl: i.photoUrl, status: i.status, distance: i.distance })) }
  } catch {
    return { ok: false, items: [] }
  }
}
