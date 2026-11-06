import 'server-only'
import { catalogEditFields } from './catalog'

/**
 * Photoroom image editing API (Plus plan, $0.10 per call; read 2026-11-06).
 * POST https://image-api.photoroom.com/v2/edit, multipart, `x-api-key`.
 * Returns the edited JPEG. Off until PHOTOROOM_API_KEY is set; PHOTOROOM_BACKGROUND
 * (hex) overrides the cream backdrop.
 */
const ENDPOINT = 'https://image-api.photoroom.com/v2/edit'

export const photoroomConfigured = () => !!process.env.PHOTOROOM_API_KEY?.trim()

export type PhotoroomResult = { ok: true; bytes: ArrayBuffer; type: string } | { ok: false; message: string }

async function call(bytes: ArrayBuffer, type: string, lighting: boolean): Promise<PhotoroomResult & { status?: number }> {
  const form = new FormData()
  form.append('imageFile', new Blob([bytes], { type }), `photo.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`)
  for (const [k, v] of Object.entries(catalogEditFields({ background: process.env.PHOTOROOM_BACKGROUND, lighting }))) form.append(k, v)
  let res: Response
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: { 'x-api-key': process.env.PHOTOROOM_API_KEY!.trim() }, body: form, signal: AbortSignal.timeout(40_000), cache: 'no-store' })
  } catch (e) {
    return { ok: false, message: `Photoroom could not be reached (${e instanceof Error ? e.message : String(e)})` }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let detail = body.slice(0, 200)
    try {
      const j = JSON.parse(body) as { error?: { message?: string; detail?: string }; detail?: string; message?: string }
      detail = j.error?.message ?? j.error?.detail ?? j.detail ?? j.message ?? detail
    } catch {
      // not JSON
    }
    const why = res.status === 402 ? 'the Photoroom account is out of credit or has no plan' : res.status === 401 || res.status === 403 ? 'Photoroom refused the API key' : `Photoroom answered ${res.status}`
    return { ok: false, status: res.status, message: `${why}${detail ? `: ${detail}` : ''}` }
  }
  const outType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim() || 'image/jpeg'
  return { ok: true, bytes: await res.arrayBuffer(), type: outType }
}

/** Make the catalog version of one photo. A refused relight (large images) is retried once without it. */
export async function photoroomCatalog(bytes: ArrayBuffer, type: string): Promise<PhotoroomResult> {
  if (!photoroomConfigured()) return { ok: false, message: 'Photoroom is not set up (PHOTOROOM_API_KEY).' }
  const first = await call(bytes, type, true)
  if (first.ok || first.status !== 400) return first
  return call(bytes, type, false)
}
