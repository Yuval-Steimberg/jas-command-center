'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { anthropicClient, aiErrorCode } from '@/lib/anthropic'
import { requirePermission, type CurrentUser } from '@/lib/auth/session'
import { allowAttempt } from '@/lib/auth/rate-limit'
import { audit } from '@/lib/audit/audit'
import { env } from '@/lib/env'
import { OpsSetupError } from '@/lib/ops/store'
import { ConflictError, getPortalStore } from '@/lib/portal/store'
import { appUrls, loadPortal } from '@/lib/portal/service'
import { WHO_OPTIONS } from '@/lib/portal/who'
import { checkAction, moveInOrder, type PortalAction, type PortalCategory } from '@/lib/portal/model'
import { applyInput, chatTurns, devIssueBody, toTurns, type ChatResult, type PortalChange } from '@/lib/portal/change-chat'
import { openDevIssue, runChangeChat } from '@/lib/portal/change-chat-run'

/**
 * "שינוי בפורטל בשיחה". Three server actions, each behind portal:manage
 * (checked here, never by hiding the page):
 * - askChangeAct: one chat turn. Reads the registry, asks Claude, checks every
 *   proposal. Writes nothing.
 * - applyChangeAct: the owner approved ONE card. The card came back from the
 *   browser, so it is untrusted: re-validated with the same rules as link
 *   management and saved conditional on the version it was made from.
 * - sendDevRequestAct: a request that needs code becomes a GitHub issue.
 * Every one is audited (via = assistant) before and after.
 */

const LIMIT = 20
const WINDOW_MS = 10 * 60_000
const KNOWN = WHO_OPTIONS.map((o) => o.permission).filter((p): p is NonNullable<typeof p> => !!p) as string[]

async function manager(): Promise<CurrentUser | null> {
  try {
    return await requirePermission('portal:manage')
  } catch {
    return null
  }
}

const AI_ERROR: Record<ReturnType<typeof aiErrorCode>, string> = {
  workspace: 'החיבור ל-Claude דורש הגדרת ANTHROPIC_WORKSPACE_ID.',
  key: 'מפתח ה-API של Claude לא תקין.',
  rate: 'Claude עמוס כרגע. נסו שוב בעוד רגע.',
  timeout: 'Claude לא ענה בזמן. נסו לבקש שינוי קטן יותר.',
  unreachable: 'אין חיבור ל-Claude כרגע. נסו שוב.',
  service: 'שגיאה בחיבור ל-Claude. נסו שוב.',
}

export type AskOutcome = { ok: true; result: ChatResult; canApply: boolean } | { ok: false; message: string }

export async function askChangeAct(raw: unknown): Promise<AskOutcome> {
  const user = await manager()
  if (!user) return { ok: false, message: 'רק מי שמנהל את הפורטל יכול לבקש שינויים.' }
  const { apiKey, workspaceId, model } = env().assistant
  if (!apiKey) return { ok: false, message: 'החיבור ל-Claude עוד לא הוגדר (ANTHROPIC_API_KEY).' }
  const parsed = chatTurns.safeParse(raw)
  const turns = parsed.success ? toTurns(parsed.data) : null
  if (!turns) return { ok: false, message: 'מה לשנות? כתבו, הקליטו או צרפו צילום מסך.' }
  if (!allowAttempt(`portal-chat:${user.id}`, Date.now(), LIMIT, WINDOW_MS)) return { ok: false, message: 'יותר מדי בקשות בזמן קצר. נסו שוב בעוד כמה דקות.' }

  const { data, problem } = await loadPortal()
  const client = anthropicClient({ apiKey, workspaceId, timeout: 55_000 })
  const question = turns[turns.length - 1]!.text.slice(0, 500)
  try {
    const out = await runChangeChat(turns, data, appUrls(), { create: (p) => client.beta.messages.create(p), model })
    await audit(user, {
      action: 'portal.chat.ask',
      product: 'portal',
      target: null,
      outcome: out.ok ? 'succeeded' : 'failed',
      via: 'assistant',
      detail: out.ok
        ? { question, proposed: out.result.changes.map((c) => c.summary), dropped: out.result.dropped, developerRequest: out.result.developerRequest?.subject ?? null, usage: out.usage }
        : { question, error: out.message },
    })
    return out.ok ? { ok: true, result: out.result, canApply: problem === null } : out
  } catch (e) {
    await audit(user, { action: 'portal.chat.ask', product: 'portal', target: null, outcome: 'failed', via: 'assistant', detail: { question, error: aiErrorCode(e) } }).catch(() => {})
    return { ok: false, message: AI_ERROR[aiErrorCode(e)] }
  }
}

export async function applyChangeAct(raw: PortalChange): Promise<{ ok: boolean; message: string }> {
  const user = await manager()
  if (!user) return { ok: false, message: 'רק מי שמנהל את הפורטל יכול לשנות אותו.' }
  const parsed = applyInput.safeParse(raw)
  if (!parsed.success) return { ok: false, message: 'השינוי הזה כבר לא תקף. בקשו אותו שוב.' }
  const c = parsed.data
  const action =
    c.mode === 'move' ? `portal.${c.kind}.move` : c.kind === 'action' ? (c.expectedUpdatedAt ? 'portal.action.edit' : 'portal.action.add') : c.expectedUpdatedAt ? 'portal.category.edit' : 'portal.category.add'
  const target = c.mode === 'move' ? c.id : c.row.id
  const detail = c.mode === 'move' ? { dir: c.direction, summary: c.summary } : { after: c.row, summary: c.summary }
  await audit(user, { action, product: 'portal', target, outcome: 'requested', via: 'assistant', detail })

  let out: { ok: boolean; message: string; record?: Record<string, unknown> }
  try {
    const store = getPortalStore()
    const data = await store.load()
    if (c.mode === 'move') {
      const list: { id: string; sort: number; categoryId?: string }[] = c.kind === 'action' ? data.actions : data.categories
      const me = list.find((x) => x.id === c.id)
      if (!me) out = { ok: false, message: 'זה כבר לא קיים.' }
      else {
        const order = list
          .filter((x) => c.kind === 'category' || x.categoryId === me.categoryId)
          .sort((x, y) => x.sort - y.sort || x.id.localeCompare(y.id))
          .map((x) => x.id)
        await store.reorder(c.kind, moveInOrder(order, c.id, c.direction))
        out = { ok: true, message: 'הסדר עודכן.' }
      }
    } else if (c.kind === 'action') {
      const errors = checkAction(c.row, appUrls(), KNOWN)
      const before = data.actions.find((a) => a.id === c.row.id)
      if (errors.length) out = { ok: false, message: errors.join(' ') }
      else if (!data.categories.some((x) => x.id === c.row.categoryId)) out = { ok: false, message: 'הקטגוריה לא קיימת.' }
      else if (!c.expectedUpdatedAt && before) out = { ok: false, message: 'כבר יש כפתור עם המזהה הזה. בקשו שוב.' }
      else {
        await store.saveAction({ ...c.row, permission: c.row.permission as PortalAction['permission'] } satisfies Omit<PortalAction, 'updatedAt'>, c.expectedUpdatedAt)
        out = { ok: true, message: `"${c.row.title}" ${before ? 'עודכן' : 'נוסף'}.`, record: { before: before ?? null } }
      }
    } else {
      const before = data.categories.find((x) => x.id === c.row.id)
      if (!c.expectedUpdatedAt && before) out = { ok: false, message: 'כבר יש קטגוריה עם המזהה הזה. בקשו שוב.' }
      else {
        await store.saveCategory(c.row satisfies Omit<PortalCategory, 'updatedAt'>, c.expectedUpdatedAt)
        out = { ok: true, message: `הקטגוריה "${c.row.title}" ${before ? 'עודכנה' : 'נוספה'}.`, record: { before: before ?? null } }
      }
    }
  } catch (e) {
    const message =
      e instanceof ConflictError ? e.message : e instanceof OpsSetupError ? 'טבלאות הפורטל עוד לא הותקנו (0014_portal.sql), ולכן אי אפשר לשמור.' : `לא נשמר: ${e instanceof Error ? e.message : String(e)}`
    out = { ok: false, message }
  }
  await audit(user, { action, product: 'portal', target, outcome: out.ok ? 'succeeded' : 'failed', via: 'assistant', detail: { ...detail, ...out.record, message: out.message } })
  if (out.ok) revalidatePath('/portal', 'layout')
  return { ok: out.ok, message: out.message }
}

const devInput = z.object({
  subject: z.string().trim().min(2).max(120),
  details: z.string().trim().min(5).max(6000),
  conversation: z.array(z.object({ role: z.enum(['owner', 'assistant']), text: z.string().max(8000) })).max(40),
  screenshots: z.number().int().min(0).max(40),
})

export type DevOutcome = { ok: true; url: string | null; message: string } | { ok: false; message: string }

export async function sendDevRequestAct(raw: unknown): Promise<DevOutcome> {
  const user = await manager()
  if (!user) return { ok: false, message: 'רק מי שמנהל את הפורטל יכול לשלוח בקשות פיתוח.' }
  const parsed = devInput.safeParse(raw)
  if (!parsed.success) return { ok: false, message: 'הבקשה חסרה נושא או פירוט.' }
  const r = parsed.data
  const body = devIssueBody({ ...r, requestedBy: user.name || user.email })
  await audit(user, { action: 'portal.dev_request', product: 'portal', target: null, outcome: 'requested', via: 'assistant', detail: { subject: r.subject, details: r.details } })
  const issue = await openDevIssue(r.subject, body)
  if (issue.status === 'opened') {
    await audit(user, { action: 'portal.dev_request', product: 'portal', target: `#${issue.number}`, outcome: 'succeeded', via: 'assistant', detail: { subject: r.subject, url: issue.url } })
    return { ok: true, url: issue.url, message: `הבקשה נשלחה לפיתוח (מספר ${issue.number}). השינוי יעלה אחרי שמישהו יבדוק ויאשר אותו.` }
  }
  if (issue.status === 'not_configured') {
    // Kept in full in the audit log above, so nothing is lost; said plainly rather than pretending it was sent.
    await audit(user, { action: 'portal.dev_request', product: 'portal', target: null, outcome: 'failed', via: 'assistant', detail: { subject: r.subject, error: 'PORTAL_GITHUB_TOKEN not set' } })
    return { ok: false, message: 'השליחה האוטומטית לפיתוח עוד לא הוגדרה (PORTAL_GITHUB_TOKEN). הבקשה נשמרה ביומן השינויים; אפשר להעתיק אותה ולשלוח ידנית.' }
  }
  await audit(user, { action: 'portal.dev_request', product: 'portal', target: null, outcome: 'failed', via: 'assistant', detail: { subject: r.subject, error: issue.message } })
  return { ok: false, message: `הבקשה לא נשלחה: ${issue.message}. היא נשמרה ביומן השינויים.` }
}

