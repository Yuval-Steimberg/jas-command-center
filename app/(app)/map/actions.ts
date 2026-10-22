'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { readPlacesSource } from '@/lib/integrations/map/adapter'
import { addPlace, editPlace, placeInput } from '@/lib/integrations/map/edit'
import { openPlacePullRequest } from '@/lib/integrations/map/github'
import { invalidate } from '@/lib/integrations/cache'

export type ActionState = { ok?: boolean; message?: string; url?: string }

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e))
const text = (form: FormData, k: string) => {
  const v = form.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Add or edit a place by opening a pull request on the map repository. The
 * public map changes only when a person merges it on GitHub. Audited
 * requested → the PR that was opened (or why not).
 */
export async function proposePlaceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let user
  try {
    user = await requirePermission('map:write')
  } catch {
    return { ok: false, message: 'You do not have permission to change the map.' }
  }
  const idRaw = text(form, 'id')
  const id = idRaw ? Number(idRaw) : null
  if (id !== null && !Number.isInteger(id)) return { ok: false, message: 'Invalid place.' }
  const reason = text(form, 'reason')
  if (!reason || reason.length < 3) return { ok: false, message: 'Give a reason (at least 3 characters). It goes into the pull request.' }
  const parsed = placeInput.safeParse({
    name: text(form, 'name') ?? '',
    sub: text(form, 'sub'),
    cat: text(form, 'cat') ?? '',
    lat: Number(text(form, 'lat')),
    lng: Number(text(form, 'lng')),
    desc: text(form, 'desc')?.replace(/\r\n/g, '\n') ?? null,
    hours: text(form, 'hours'),
    contact: text(form, 'contact'),
    address: text(form, 'address'),
  })
  if (!parsed.success) {
    const i = parsed.error.issues[0]!
    return { ok: false, message: `${i.path.join('.') || 'input'}: ${i.message}` }
  }

  const action = id === null ? 'map.place.add' : 'map.place.edit'
  const target = id === null ? 'place:new' : `place:${id}`
  await audit(user, { action, product: 'map', target, outcome: 'requested', detail: { place: parsed.data, reason } })
  try {
    // Always the current file: the edit is computed against the blob it will replace.
    const { source, sha } = await readPlacesSource()
    const edit = id === null ? addPlace(source, parsed.data) : editPlace(source, id, parsed.data)
    if (!edit.ok) {
      await audit(user, { action, product: 'map', target, outcome: 'failed', detail: { message: edit.message } })
      return { ok: false, message: edit.message }
    }
    const pr = await openPlacePullRequest({ source: edit.source, fileSha: sha, placeId: edit.placeId, summary: edit.summary, requestedBy: user.email, reason })
    await audit(user, { action, product: 'map', target: `place:${edit.placeId}`, outcome: 'succeeded', detail: { pullRequest: pr.number, url: pr.url, summary: edit.summary } })
    invalidate('map:')
    revalidatePath('/map')
    return { ok: true, message: `Pull request #${pr.number} opened. The map changes when it is merged on GitHub.`, url: pr.url }
  } catch (e) {
    await audit(user, { action, product: 'map', target, outcome: 'failed', detail: { error: fail(e) } })
    return { ok: false, message: `Not opened: ${fail(e)}` }
  }
}
