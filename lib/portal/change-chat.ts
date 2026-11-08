import { z } from 'zod'
import { AUDIENCES, AUDIENCE_LABEL, ID_RE, PORTAL_ICONS, actionInput, categoryInput, checkAction, newId, resolveDestination, type AppUrls, type PortalAction, type PortalCategory, type PortalData } from './model'
import { WHO_OPTIONS, whoLabel } from './who'

/**
 * "שינוי בפורטל בשיחה" (/portal/change): the owner writes, speaks or sends a
 * screenshot; Claude proposes changes; nothing changes until the owner
 * approves each one on the screen. Pure (no I/O), shared by the server action,
 * the page and the tests.
 *
 * Two kinds of request, deliberately handled differently:
 * - The link registry (categories and their buttons: titles, descriptions,
 *   addresses, who sees them, order, on/off) is DATA. A proposal is checked
 *   here against the live registry and the same rules as link management
 *   (`checkAction`), and approving it saves through the same store, with the
 *   same conditional write and audit trail.
 * - Anything that needs code (colours, layout, new screens, new features) is
 *   never applied by the chat. It becomes a development request: a precise
 *   spec Claude writes, sent as a GitHub issue that a developer, or Claude Code
 *   through the repository's workflow, turns into a pull request. It reaches
 *   the live system only when someone merges that pull request.
 */

export const LIMITS = {
  turns: 16,
  textChars: 4000,
  imagesPerTurn: 3,
  imagesTotal: 4,
  /** A data URL; the browser resizes screenshots to ~1600px JPEG, well under this. */
  imageChars: 1_500_000,
  changes: 8,
} as const

const nullableStr = z.string().nullable()

/** What Claude returns for one turn (structured output). Proposals only: the server never writes on its own. */
export const ChatOutputSchema = z.object({
  reply: z.string(),
  changes: z.array(
    z.object({
      op: z.enum(['edit_action', 'add_action', 'toggle_action', 'move_action', 'edit_category', 'add_category', 'move_category']),
      /** The existing id for edit / toggle / move; null for add. */
      id: nullableStr,
      /** One short Hebrew line: what changes and where. */
      summary: z.string(),
      /** Only the fields that change (edit) or every field (add). Null = keep. */
      title: nullableStr,
      description: nullableStr,
      destination: nullableStr,
      audience: z.enum(AUDIENCES).nullable(),
      /** A permission from the list in the prompt, "everyone" for no restriction, null = keep. */
      permission: nullableStr,
      category_id: nullableStr,
      subtitle: nullableStr,
      icon: z.enum(PORTAL_ICONS).nullable(),
      active: z.boolean().nullable(),
      direction: z.enum(['up', 'down']).nullable(),
    }),
  ),
  developer_request: z.object({ subject: z.string(), details: z.string() }).nullable(),
})
export type ChatOutput = z.infer<typeof ChatOutputSchema>
type RawChange = ChatOutput['changes'][number]

/** The JSON schema sent as the output format: strict, every property required, nullable where optional. */
export function outputJsonSchema(): Record<string, unknown> {
  const s = { type: 'string' }
  const ns = { type: ['string', 'null'] }
  const change = {
    type: 'object',
    additionalProperties: false,
    properties: {
      op: { type: 'string', enum: ['edit_action', 'add_action', 'toggle_action', 'move_action', 'edit_category', 'add_category', 'move_category'] },
      id: ns,
      summary: s,
      title: ns,
      description: ns,
      destination: ns,
      audience: { type: ['string', 'null'], enum: [...AUDIENCES, null] },
      permission: ns,
      category_id: ns,
      subtitle: ns,
      icon: { type: ['string', 'null'], enum: [...PORTAL_ICONS, null] },
      active: { type: ['boolean', 'null'] },
      direction: { type: ['string', 'null'], enum: ['up', 'down', null] },
    },
    required: ['op', 'id', 'summary', 'title', 'description', 'destination', 'audience', 'permission', 'category_id', 'subtitle', 'icon', 'active', 'direction'],
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      reply: s,
      changes: { type: 'array', items: change },
      developer_request: {
        anyOf: [{ type: 'object', additionalProperties: false, properties: { subject: s, details: s }, required: ['subject', 'details'] }, { type: 'null' }],
      },
    },
    required: ['reply', 'changes', 'developer_request'],
  }
}

/**
 * A change the server checked, ready to show and to apply. `row` is the
 * complete row to save; `expectedUpdatedAt` the version it was computed from
 * (null for a new row), so a link someone edited in between is refused, never
 * overwritten.
 */
export type PortalChange =
  | { kind: 'action'; mode: 'save'; summary: string; row: Omit<PortalAction, 'updatedAt'>; expectedUpdatedAt: string | null; show: Shown }
  | { kind: 'category'; mode: 'save'; summary: string; row: Omit<PortalCategory, 'updatedAt'>; expectedUpdatedAt: string | null; show: Shown }
  | { kind: 'action' | 'category'; mode: 'move'; summary: string; id: string; direction: 'up' | 'down'; show: Shown }

/**
 * A card coming back from the browser to be applied: untrusted, so re-parsed
 * with the same field rules as link management (the server action then runs
 * checkAction and a conditional write). Every change checkChanges produces
 * must pass it (tests/unit/portal-change-chat.test.ts).
 */
const actionRow = actionInput.omit({ expectedUpdatedAt: true }).extend({ id: z.string().regex(ID_RE), sort: z.number().int().min(0).max(10_000) })
const categoryRow = categoryInput.omit({ expectedUpdatedAt: true }).extend({ id: z.string().regex(ID_RE), sort: z.number().int().min(0).max(10_000) })
const shown = z.object({ title: z.string().max(200), before: z.string().max(2000), after: z.string().max(2000) })
export const applyInput = z.union([
  z.object({ mode: z.literal('save'), kind: z.literal('action'), row: actionRow, expectedUpdatedAt: z.string().nullable(), summary: z.string().max(300), show: shown }),
  z.object({ mode: z.literal('save'), kind: z.literal('category'), row: categoryRow, expectedUpdatedAt: z.string().nullable(), summary: z.string().max(300), show: shown }),
  z.object({ mode: z.literal('move'), kind: z.enum(['action', 'category']), id: z.string().regex(ID_RE), direction: z.enum(['up', 'down']), summary: z.string().max(300), show: shown }),
])

/** What the owner reads on the card: plain lines, before and after. */
export type Shown = { title: string; before: string; after: string }

export type ChatResult = {
  reply: string
  changes: PortalChange[]
  developerRequest: { subject: string; details: string } | null
  /** Proposals the checks refused, said plainly so nobody is told something will change when it will not. */
  dropped: { summary: string; reason: string }[]
}

const KNOWN_PERMISSIONS = WHO_OPTIONS.map((o) => o.permission).filter((p): p is NonNullable<typeof p> => !!p) as string[]

function actionLines(a: Pick<PortalAction, 'title' | 'description' | 'destination' | 'audience' | 'permission' | 'active'>, categoryTitle: string): string {
  return [
    `שם: ${a.title}`,
    a.description ? `תיאור: ${a.description}` : null,
    `קטגוריה: ${categoryTitle}`,
    `כתובת: ${a.destination || '(אין)'}`,
    `למי: ${AUDIENCE_LABEL[a.audience]}`,
    `מי רואה: ${whoLabel(a.permission)}`,
    a.active ? 'מופעל' : 'כבוי',
  ]
    .filter(Boolean)
    .join('\n')
}

const categoryLines = (c: Pick<PortalCategory, 'title' | 'subtitle' | 'active'>) => [`שם: ${c.title}`, c.subtitle ? `תת כותרת: ${c.subtitle}` : null, c.active ? 'מופעלת' : 'כבויה'].filter(Boolean).join('\n')

/** Model text → the stored permission: "everyone" (or empty) = null, otherwise a known permission. */
function permissionOf(v: string): { ok: true; value: PortalAction['permission'] } | { ok: false } {
  const t = v.trim()
  if (!t || t === 'everyone' || t === 'null') return { ok: true, value: null }
  return KNOWN_PERMISSIONS.includes(t) ? { ok: true, value: t as PortalAction['permission'] } : { ok: false }
}

const pick = <T>(v: T | null | undefined, keep: T): T => (v === null || v === undefined ? keep : v)

/**
 * Turn Claude's proposals into checked changes against the registry as it is
 * now. Anything that names a link that does not exist, breaks a link
 * management rule or changes nothing is dropped with a Hebrew reason.
 * Several proposals in one answer are checked in order against the result of
 * the ones before (so "add a category and put a link in it" works), but
 * applied one at a time by the owner.
 */
export function checkChanges(out: ChatOutput, data: PortalData, apps: AppUrls): ChatResult {
  const cats = data.categories.map((c) => ({ ...c }))
  const acts = data.actions.map((a) => ({ ...a }))
  const changes: PortalChange[] = []
  const dropped: ChatResult['dropped'] = []
  const drop = (c: RawChange, reason: string) => dropped.push({ summary: c.summary || c.op, reason })
  const catTitle = (id: string) => cats.find((c) => c.id === id)?.title ?? id

  for (const c of out.changes.slice(0, LIMITS.changes)) {
    if (c.op === 'move_action' || c.op === 'move_category') {
      const list: { id: string; title: string }[] = c.op === 'move_action' ? acts : cats
      const target = list.find((x) => x.id === c.id)
      if (!target || !c.direction) {
        drop(c, 'לא מצאנו את מה שצריך להזיז.')
        continue
      }
      const kind = c.op === 'move_action' ? 'action' : 'category'
      const word = c.direction === 'up' ? 'מקום אחד למעלה' : 'מקום אחד למטה'
      changes.push({ kind, mode: 'move', summary: c.summary, id: target.id, direction: c.direction, show: { title: target.title, before: '', after: word } })
      continue
    }

    if (c.op === 'edit_category' || c.op === 'add_category') {
      const before = c.op === 'edit_category' ? cats.find((x) => x.id === c.id) : undefined
      if (c.op === 'edit_category' && !before) {
        drop(c, 'הקטגוריה הזאת לא קיימת.')
        continue
      }
      const parsed = categoryInput.safeParse({
        id: before?.id,
        title: pick(c.title, before?.title ?? ''),
        subtitle: pick(c.subtitle, before?.subtitle ?? ''),
        icon: pick(c.icon, before?.icon ?? 'link'),
        active: pick(c.active, before?.active ?? true),
      })
      if (!parsed.success) {
        drop(c, 'לקטגוריה צריך שם של 2 עד 40 אותיות ותת כותרת קצרה.')
        continue
      }
      const id = before?.id ?? newId('category', new Set(cats.map((x) => x.id)))
      const row: Omit<PortalCategory, 'updatedAt'> = {
        id,
        title: parsed.data.title,
        subtitle: parsed.data.subtitle,
        icon: parsed.data.icon,
        active: parsed.data.active,
        sort: before?.sort ?? Math.max(0, ...cats.map((x) => x.sort)) + 1,
      }
      if (before && before.title === row.title && before.subtitle === row.subtitle && before.icon === row.icon && before.active === row.active) {
        drop(c, 'אין כאן שינוי: זה כבר כך.')
        continue
      }
      if (before) Object.assign(before, row)
      else cats.push({ ...row, updatedAt: '' })
      changes.push({ kind: 'category', mode: 'save', summary: c.summary, row, expectedUpdatedAt: before ? data.categories.find((x) => x.id === id)!.updatedAt : null, show: { title: row.title, before: before ? categoryLines(data.categories.find((x) => x.id === id)!) : '', after: categoryLines(row) } })
      continue
    }

    // edit_action / add_action / toggle_action
    const before = c.op === 'add_action' ? undefined : acts.find((x) => x.id === c.id)
    if (c.op !== 'add_action' && !before) {
      drop(c, 'הכפתור הזה לא קיים.')
      continue
    }
    let permission = before?.permission ?? null
    if (c.permission !== null && c.op !== 'toggle_action') {
      const p = permissionOf(c.permission)
      if (!p.ok) {
        drop(c, 'ההרשאה שהוצעה לא קיימת.')
        continue
      }
      permission = p.value
    }
    const merged = {
      id: before?.id,
      categoryId: c.op === 'toggle_action' ? before!.categoryId : pick(c.category_id, before?.categoryId ?? ''),
      title: c.op === 'toggle_action' ? before!.title : pick(c.title, before?.title ?? ''),
      description: c.op === 'toggle_action' ? before!.description : pick(c.description, before?.description ?? ''),
      destination: c.op === 'toggle_action' ? before!.destination : pick(c.destination, before?.destination ?? ''),
      audience: c.op === 'toggle_action' ? before!.audience : pick(c.audience, before?.audience ?? 'team'),
      permission,
      active: c.op === 'toggle_action' ? !before!.active : pick(c.active, before?.active ?? true),
    }
    const parsed = actionInput.safeParse(merged)
    if (!parsed.success) {
      drop(c, 'לכפתור צריך שם של 2 עד 60 אותיות ותיאור קצר משורה וחצי.')
      continue
    }
    if (!cats.some((x) => x.id === parsed.data.categoryId)) {
      drop(c, 'הקטגוריה שנבחרה לא קיימת.')
      continue
    }
    const errors = checkAction(parsed.data, apps, KNOWN_PERMISSIONS)
    // Switching on a link whose app address is not configured is allowed in link management too (it stays hidden).
    if (errors.length) {
      drop(c, errors.join(' '))
      continue
    }
    if (parsed.data.active && !before?.active) {
      const r = resolveDestination(parsed.data.destination, apps)
      if (!r.ok && r.reason !== 'app_not_configured') {
        drop(c, 'אי אפשר להפעיל כפתור בלי כתובת תקינה.')
        continue
      }
    }
    const inCat = acts.filter((x) => x.categoryId === parsed.data.categoryId)
    const id = before?.id ?? newId(parsed.data.categoryId, new Set(acts.map((x) => x.id)))
    const row: Omit<PortalAction, 'updatedAt'> = {
      id,
      categoryId: parsed.data.categoryId,
      title: parsed.data.title,
      description: parsed.data.description,
      destination: parsed.data.destination,
      audience: parsed.data.audience,
      permission: parsed.data.permission as PortalAction['permission'],
      active: parsed.data.active,
      sort: before && before.categoryId === parsed.data.categoryId ? before.sort : Math.max(0, ...inCat.map((x) => x.sort)) + 1,
    }
    const original = data.actions.find((x) => x.id === id)
    if (original && (['categoryId', 'title', 'description', 'destination', 'audience', 'permission', 'active'] as const).every((k) => original[k] === row[k])) {
      drop(c, 'אין כאן שינוי: זה כבר כך.')
      continue
    }
    if (before) Object.assign(before, row)
    else acts.push({ ...row, updatedAt: '' })
    changes.push({
      kind: 'action',
      mode: 'save',
      summary: c.summary,
      row,
      expectedUpdatedAt: original?.updatedAt ?? null,
      show: { title: row.title, before: original ? actionLines(original, catTitle(original.categoryId)) : '', after: actionLines(row, catTitle(row.categoryId)) },
    })
  }

  const dev = out.developer_request
  return { reply: out.reply, changes, developerRequest: dev && dev.subject.trim() ? { subject: dev.subject.trim().slice(0, 120), details: dev.details.trim().slice(0, 6000) } : null, dropped }
}

/** The registry as Claude reads it: one line per category and button, ids included, in display order. */
export function registryText(data: PortalData): string {
  const lines: string[] = []
  const bySort = <T extends { sort: number; id: string }>(a: T, b: T) => a.sort - b.sort || a.id.localeCompare(b.id)
  for (const c of [...data.categories].sort(bySort)) {
    lines.push(`category ${c.id} | ${JSON.stringify(c.title)} | subtitle ${JSON.stringify(c.subtitle)} | icon ${c.icon} | ${c.active ? 'on' : 'off'}`)
    for (const a of data.actions.filter((x) => x.categoryId === c.id).sort(bySort))
      lines.push(
        `  action ${a.id} | ${JSON.stringify(a.title)} | ${JSON.stringify(a.description)} | destination ${JSON.stringify(a.destination)} | audience ${a.audience} | permission ${a.permission ?? 'everyone'} | ${a.active ? 'on' : 'off'}`,
      )
  }
  return lines.join('\n')
}

export const permissionsText = () => WHO_OPTIONS.map((o) => `${o.permission ?? 'everyone'} = ${o.label}`).join('\n')

/** One turn as the browser sends it. Images are JPEG/PNG/WebP data URLs. */
export const chatTurn = z.object({
  role: z.enum(['owner', 'assistant']),
  text: z.string().max(LIMITS.textChars * 2),
  images: z.array(z.string().max(LIMITS.imageChars)).max(LIMITS.imagesPerTurn).optional(),
})
export type ChatTurn = z.infer<typeof chatTurn>
export const chatTurns = z.array(chatTurn).min(1).max(LIMITS.turns * 2)

export type ImageSource = { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }

export function imageSource(src: string): ImageSource | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(src)
  return m ? { media_type: m[1] as ImageSource['media_type'], data: m[2]! } : null
}

export type OutTurn = { role: 'user' | 'assistant'; text: string; images: ImageSource[] }

/**
 * The conversation as Claude reads it: newest turns, only the newest
 * screenshots (LIMITS.imagesTotal), the owner's words wrapped so they read as
 * data, starting with the owner and ending with the owner.
 */
export function toTurns(turns: ChatTurn[]): OutTurn[] | null {
  let imagesLeft: number = LIMITS.imagesTotal
  const out: OutTurn[] = []
  for (const t of [...turns].slice(-LIMITS.turns).reverse()) {
    const text = t.text.slice(0, LIMITS.textChars).trim()
    if (t.role === 'assistant') {
      if (text) out.unshift({ role: 'assistant', text, images: [] })
      continue
    }
    const images: ImageSource[] = []
    for (const src of (t.images ?? []).slice(0, LIMITS.imagesPerTurn)) {
      if (imagesLeft <= 0) break
      const img = imageSource(src)
      if (img) {
        images.push(img)
        imagesLeft--
      }
    }
    out.unshift({ role: 'user', text: `<owner_message>${text || '(צילום מסך בלי טקסט)'}</owner_message>`, images })
  }
  while (out.length && out[0]!.role !== 'user') out.shift()
  // Consecutive turns of one role are merged, so the API sees a strict alternation.
  const merged: OutTurn[] = []
  for (const t of out) {
    const last = merged[merged.length - 1]
    if (last && last.role === t.role) {
      last.text += `\n\n${t.text}`
      last.images.push(...t.images)
    } else merged.push({ ...t, images: [...t.images] })
  }
  return merged.length && merged[merged.length - 1]!.role === 'user' ? merged : null
}

/** The body of a development request (GitHub issue). Never includes screenshots' pixels: Claude describes them in `details`. */
export function devIssueBody(r: { subject: string; details: string; requestedBy: string; conversation: { role: 'owner' | 'assistant'; text: string }[]; screenshots: number }): string {
  const convo = r.conversation
    .slice(-10)
    .map((t) => `> **${t.role === 'owner' ? 'בעלת העסק' : 'Claude'}:** ${t.text.slice(0, 1500).replace(/\n/g, '\n> ')}`)
    .join('\n>\n')
  return [
    `**בקשה מ:** ${r.requestedBy} (דרך "שינוי בפורטל בשיחה")`,
    '',
    '## מה צריך לעשות',
    r.details,
    '',
    r.screenshots ? `_צורפו ${r.screenshots} צילומי מסך לשיחה. התיאור שלהם כלול למעלה; הקבצים עצמם לא נשמרים כאן._` : '',
    '',
    '## השיחה',
    convo,
    '',
    '---',
    'Scope: the jas-command-center repository. Follow CLAUDE.md (Hebrew RTL, the portal design tokens, permissions checked on the server). Open a pull request; the owner reviews the preview and merges.',
  ]
    .filter((l) => l !== null)
    .join('\n')
}
