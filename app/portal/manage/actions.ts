'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePermission, type CurrentUser } from '@/lib/auth/session'
import { audit } from '@/lib/audit/audit'
import { OpsSetupError } from '@/lib/ops/store'
import { ConflictError, getPortalStore } from '@/lib/portal/store'
import { appUrls } from '@/lib/portal/service'
import { WHO_OPTIONS } from '@/lib/portal/who'
import { actionInput, categoryInput, checkAction, moveInOrder, newId, resolveDestination, type PortalAction, type PortalCategory } from '@/lib/portal/model'

/**
 * Link management. Every write: portal:manage checked here (never by hiding a
 * button), audit `requested`, run, audit the outcome with before/after, then
 * refresh every portal page. The result comes back as a sentence on the page.
 */

/** `record`: what changed (before/after), added to the outcome's audit row. */
type Outcome = { ok: boolean; message: string; anchor?: string; record?: Record<string, unknown> }

async function act(action: string, target: string, detail: Record<string, unknown>, run: (u: CurrentUser) => Promise<Outcome>): Promise<never> {
  let user: CurrentUser
  try {
    user = await requirePermission('portal:manage')
  } catch {
    redirect(`/portal/manage?err=${encodeURIComponent('רק מי שמנהל את הפורטל יכול לשנות קישורים.')}`)
  }
  await audit(user, { action, product: 'portal', target, outcome: 'requested', detail })
  let out: Outcome
  try {
    out = await run(user)
    await audit(user, { action, product: 'portal', target, outcome: out.ok ? 'succeeded' : 'failed', detail: { ...detail, ...out.record, message: out.message } })
  } catch (e) {
    const message =
      e instanceof ConflictError ? e.message : e instanceof OpsSetupError ? 'טבלאות הפורטל עוד לא הותקנו. יש להריץ את supabase/migrations/0014_portal.sql.' : `לא נשמר: ${e instanceof Error ? e.message : String(e)}`
    await audit(user, { action, product: 'portal', target, outcome: 'failed', detail: { ...detail, error: e instanceof Error ? e.message : String(e) } })
    out = { ok: false, message }
  }
  revalidatePath('/portal', 'layout')
  redirect(`/portal/manage?${out.ok ? 'ok' : 'err'}=${encodeURIComponent(out.message)}${out.anchor ? `#${out.anchor}` : ''}`)
}

const KNOWN = WHO_OPTIONS.map((o) => o.permission).filter((p): p is NonNullable<typeof p> => !!p) as string[]
const str = (f: FormData, k: string) => String(f.get(k) ?? '')
const snapshot = (a: PortalAction) => ({ title: a.title, categoryId: a.categoryId, destination: a.destination, audience: a.audience, permission: a.permission, active: a.active })

export async function saveActionAct(form: FormData) {
  const parsed = actionInput.safeParse({
    id: str(form, 'id') || undefined,
    categoryId: str(form, 'categoryId'),
    title: str(form, 'title'),
    description: str(form, 'description'),
    destination: str(form, 'destination'),
    audience: str(form, 'audience'),
    permission: str(form, 'permission') || null,
    active: form.get('active') === 'on',
    expectedUpdatedAt: str(form, 'expectedUpdatedAt') || undefined,
  })
  if (!parsed.success) redirect(`/portal/manage?err=${encodeURIComponent('יש למלא שם (לפחות שתי אותיות), ולבדוק שהתיאור קצר משורה וחצי.')}`)
  const input = parsed.data
  return act(input.id ? 'portal.action.edit' : 'portal.action.add', input.id ?? 'new', { after: { ...input, expectedUpdatedAt: undefined } }, async () => {
    const errors = checkAction(input, appUrls(), KNOWN)
    if (errors.length) return { ok: false, message: errors.join(' '), anchor: input.id ? `a-${input.id}` : `c-${input.categoryId}` }
    const store = getPortalStore()
    const data = await store.load()
    const before = input.id ? data.actions.find((a) => a.id === input.id) : undefined
    if (input.id && !before) return { ok: false, message: 'הקישור כבר לא קיים.' }
    const inCat = data.actions.filter((a) => a.categoryId === input.categoryId)
    const id = input.id ?? newId(input.categoryId, new Set(data.actions.map((a) => a.id)))
    // Moving to another category puts it last there; otherwise it keeps its place.
    const sort = before && before.categoryId === input.categoryId ? before.sort : Math.max(0, ...inCat.map((a) => a.sort)) + 1
    const row: Omit<PortalAction, 'updatedAt'> = {
      id,
      categoryId: input.categoryId,
      title: input.title,
      description: input.description,
      destination: input.destination,
      audience: input.audience,
      permission: (input.permission as PortalAction['permission']) ?? null,
      sort,
      active: input.active,
    }
    await store.saveAction(row, before ? input.expectedUpdatedAt ?? before.updatedAt : null)
    return {
      ok: true,
      message: before ? `"${row.title}" עודכן.` : `"${row.title}" נוסף.`,
      anchor: `a-${id}`,
      record: { id, before: before ? snapshot(before) : null, after: snapshot({ ...row, updatedAt: '' }) },
    }
  })
}

export async function toggleActionAct(form: FormData) {
  const id = str(form, 'id')
  const expected = str(form, 'expectedUpdatedAt')
  return act('portal.action.toggle', id, {}, async () => {
    const store = getPortalStore()
    const a = (await store.load()).actions.find((x) => x.id === id)
    if (!a) return { ok: false, message: 'הקישור כבר לא קיים.' }
    if (!a.active) {
      const r = resolveDestination(a.destination, appUrls())
      if (!r.ok && r.reason !== 'app_not_configured') return { ok: false, message: `אי אפשר להפעיל את "${a.title}" בלי כתובת תקינה. אפשר לערוך אותו ולהוסיף כתובת.`, anchor: `a-${id}` }
    }
    await store.saveAction({ ...a, active: !a.active }, expected || a.updatedAt)
    return { ok: true, message: a.active ? `"${a.title}" כובה. הוא לא יופיע בפורטל.` : `"${a.title}" הופעל.`, anchor: `a-${id}`, record: { title: a.title, active: !a.active } }
  })
}

export async function moveActionAct(form: FormData) {
  const id = str(form, 'id')
  const dir = str(form, 'dir') === 'up' ? 'up' : 'down'
  return act('portal.action.move', id, { dir }, async () => {
    const store = getPortalStore()
    const data = await store.load()
    const a = data.actions.find((x) => x.id === id)
    if (!a) return { ok: false, message: 'הקישור כבר לא קיים.' }
    const order = data.actions.filter((x) => x.categoryId === a.categoryId).sort((x, y) => x.sort - y.sort || x.id.localeCompare(y.id)).map((x) => x.id)
    await store.reorder('action', moveInOrder(order, id, dir))
    return { ok: true, message: `הסדר עודכן.`, anchor: `a-${id}` }
  })
}

export async function deleteActionAct(form: FormData) {
  const id = str(form, 'id')
  const expected = str(form, 'expectedUpdatedAt')
  return act('portal.action.delete', id, {}, async () => {
    const store = getPortalStore()
    const a = (await store.load()).actions.find((x) => x.id === id)
    if (!a) return { ok: false, message: 'הקישור כבר לא קיים.' }
    // Spec page 4: disable before delete. Only an action already off can be deleted, so nothing disappears by one slip.
    if (a.active) return { ok: false, message: 'קודם מכבים את הקישור, ורק אז אפשר למחוק אותו.', anchor: `a-${id}` }
    await store.deleteAction(id, expected || a.updatedAt)
    // The whole row goes into the audit log, so a deleted link can be put back by hand.
    return { ok: true, message: `"${a.title}" נמחק.`, anchor: `c-${a.categoryId}`, record: { before: { ...snapshot(a), description: a.description, sort: a.sort }, after: null } }
  })
}

export async function saveCategoryAct(form: FormData) {
  const parsed = categoryInput.safeParse({
    id: str(form, 'id') || undefined,
    title: str(form, 'title'),
    subtitle: str(form, 'subtitle'),
    icon: str(form, 'icon'),
    active: form.get('active') === 'on',
    expectedUpdatedAt: str(form, 'expectedUpdatedAt') || undefined,
  })
  if (!parsed.success) redirect(`/portal/manage?err=${encodeURIComponent('לקטגוריה צריך שם של לפחות שתי אותיות.')}`)
  const input = parsed.data
  return act(input.id ? 'portal.category.edit' : 'portal.category.add', input.id ?? 'new', { after: { ...input, expectedUpdatedAt: undefined } }, async () => {
    const store = getPortalStore()
    const data = await store.load()
    const before = input.id ? data.categories.find((c) => c.id === input.id) : undefined
    if (input.id && !before) return { ok: false, message: 'הקטגוריה כבר לא קיימת.' }
    const id = input.id ?? newId('category', new Set(data.categories.map((c) => c.id)))
    const row: Omit<PortalCategory, 'updatedAt'> = {
      id,
      title: input.title,
      subtitle: input.subtitle,
      icon: input.icon,
      sort: before ? before.sort : Math.max(0, ...data.categories.map((c) => c.sort)) + 1,
      active: input.active,
    }
    await store.saveCategory(row, before ? input.expectedUpdatedAt ?? before.updatedAt : null)
    return {
      record: { id, before: before ? { title: before.title, active: before.active } : null, after: { title: row.title, active: row.active } },
      ok: true, message: before ? `הקטגוריה "${row.title}" עודכנה.` : `הקטגוריה "${row.title}" נוספה. עכשיו אפשר להוסיף לה קישורים.`, anchor: `c-${id}`,
    }
  })
}

export async function moveCategoryAct(form: FormData) {
  const id = str(form, 'id')
  const dir = str(form, 'dir') === 'up' ? 'up' : 'down'
  return act('portal.category.move', id, { dir }, async () => {
    const store = getPortalStore()
    const order = (await store.load()).categories.sort((x, y) => x.sort - y.sort || x.id.localeCompare(y.id)).map((x) => x.id)
    await store.reorder('category', moveInOrder(order, id, dir))
    return { ok: true, message: 'סדר הקטגוריות עודכן.', anchor: `c-${id}` }
  })
}
