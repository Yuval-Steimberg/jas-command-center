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

/**
 * `deferred`: not attempted, or cut short, because the caller's time ran out
 * (an hourly run's deadline). Not the photo's fault, so it is never recorded
 * against the photo: the next run tries again.
 */
export type PhotoroomResult = { ok: true; bytes: ArrayBuffer; type: string } | { ok: false; message: string; deferred?: true }

const CALL_MS = 40_000
/** Below this much time left a call is not started: a typical edit takes several seconds. */
const MIN_CALL_MS = 8_000

async function call(bytes: ArrayBuffer, type: string, lighting: boolean, timeoutMs: number): Promise<PhotoroomResult & { status?: number }> {
  const form = new FormData()
  form.append('imageFile', new Blob([bytes], { type }), `photo.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`)
  for (const [k, v] of Object.entries(catalogEditFields({ background: process.env.PHOTOROOM_BACKGROUND, lighting }))) form.append(k, v)
  let res: Response
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: { 'x-api-key': process.env.PHOTOROOM_API_KEY!.trim() }, body: form, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  } catch (e) {
    // Aborted by the caller's deadline (a shorter timeout than our own), not by Photoroom being down.
    if (timeoutMs < CALL_MS && e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return { ok: false, deferred: true, message: 'out of time for this run' }
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

/** Time to give one call: our own limit, or less when the caller has a deadline. null = not enough left. */
function budget(deadline: number | undefined): number | null {
  const ms = deadline == null ? CALL_MS : Math.min(CALL_MS, deadline - Date.now())
  return ms < MIN_CALL_MS ? null : ms
}

/**
 * Make the catalog version of one photo. A refused relight (large images) is
 * retried once without it. With a `deadline` (epoch ms) no call runs past it.
 */
export async function photoroomCatalog(bytes: ArrayBuffer, type: string, opts: { deadline?: number } = {}): Promise<PhotoroomResult> {
  if (!photoroomConfigured()) return { ok: false, message: 'Photoroom is not set up (PHOTOROOM_API_KEY).' }
  const outOfTime = { ok: false as const, deferred: true as const, message: 'out of time for this run' }
  const t1 = budget(opts.deadline)
  if (t1 == null) return outOfTime
  const first = await call(bytes, type, true, t1)
  if (first.ok || first.status !== 400) return first
  const t2 = budget(opts.deadline)
  return t2 == null ? outOfTime : call(bytes, type, false, t2)
}
