'use server'

import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { IMAGE_FOLDERS, uploadWebsiteImage, type ImageFolder } from '@/lib/integrations/website/manage'

export type UploadState = { ok: boolean; url?: string; message?: string }

const TYPES = new Set(['image/webp', 'image/jpeg', 'image/png'])
/** The browser resizes to 1600px first (~150–400 KB); this is a backstop under the server-action body limit. */
const MAX_BYTES = 900 * 1024

/**
 * Uploads one image to the website's public storage and returns its link. It
 * changes nothing on the site by itself: the link only appears once the form
 * it was put into is saved (and that save is audited as usual).
 */
export async function uploadImageAction(form: FormData): Promise<UploadState> {
  let user
  try {
    user = await requirePermission('website:write')
  } catch {
    return { ok: false, message: 'You do not have permission to upload images.' }
  }
  const folder = String(form.get('folder') ?? '') as ImageFolder
  const file = form.get('file')
  if (!IMAGE_FOLDERS.includes(folder)) return { ok: false, message: 'Invalid folder.' }
  if (!(file instanceof Blob) || !TYPES.has(file.type)) return { ok: false, message: 'Choose a JPEG, PNG or WebP photo.' }
  if (file.size > MAX_BYTES) return { ok: false, message: 'The photo is still too large after resizing. Try a smaller one.' }
  const detail = { folder, bytes: file.size, type: file.type }
  try {
    const url = await uploadWebsiteImage(folder, await file.arrayBuffer(), file.type)
    await audit(user, { action: 'website.image.upload', product: 'website', target: url.slice(-120), outcome: 'succeeded', detail })
    return { ok: true, url }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await audit(user, { action: 'website.image.upload', product: 'website', target: `folder:${folder}`, outcome: 'failed', detail: { ...detail, error: message } })
    return { ok: false, message: `Not uploaded: ${message}` }
  }
}
