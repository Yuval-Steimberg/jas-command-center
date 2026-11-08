import type { Handover } from '@/lib/sales/handovers'
import type { Item, Task } from '@/lib/ops/types'

/**
 * "מה מחכה לי היום": the few things on the shop floor that need a person
 * today, each one tap from the screen that does it. Pure: it only sorts and
 * words what the shop's own queues already hold (handoverQueue, reserved
 * items, tasks), so it never disagrees with those screens.
 */

export type TodayLine = {
  key: string
  text: string
  href: string
  /** Late, or due today: shown first and marked. */
  urgent: boolean
}

export type TodayInput = {
  /** Null = not readable for this person (no permission), undefined = could not be read. */
  handovers: Handover[] | null | undefined
  reserved: Item[] | null | undefined
  tasks: Task[] | null | undefined
  userId: string
  /** YYYY-MM-DD in Israel. */
  today: string
}

export type TodayResult = { lines: TodayLine[]; unreadable: string[] }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)))
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null)

export function buildToday(i: TodayInput): TodayResult {
  const lines: TodayLine[] = []
  const unreadable: string[] = []

  if (i.handovers === undefined) unreadable.push('מסירות')
  else if (i.handovers) {
    const overdue = i.handovers.filter((h) => h.overdue)
    const deliveriesToday = i.handovers.filter((h) => !h.overdue && h.kind === 'delivery' && dayOf(h.scheduledFor) === i.today)
    const pickups = i.handovers.filter((h) => !h.overdue && h.kind === 'pickup')
    if (overdue.length) lines.push({ key: 'handover-late', text: plural(overdue.length, 'משלוח אחד באיחור', '{n} משלוחים באיחור'), href: '/shop/deliveries', urgent: true })
    if (deliveriesToday.length) lines.push({ key: 'handover-today', text: plural(deliveriesToday.length, 'משלוח אחד יוצא היום', '{n} משלוחים יוצאים היום'), href: '/shop/deliveries', urgent: true })
    if (pickups.length) lines.push({ key: 'handover-pickup', text: plural(pickups.length, 'לקוח אחד אמור לאסוף פריט שקנה', '{n} לקוחות אמורים לאסוף פריטים שקנו'), href: '/shop/deliveries', urgent: false })
  }

  if (i.reserved === undefined) unreadable.push('שמירות')
  else if (i.reserved) {
    const ending = i.reserved.filter((it) => it.status === 'reserved' && it.reservedUntil && dayOf(it.reservedUntil)! <= i.today)
    if (ending.length)
      lines.push({
        key: 'reserved-ending',
        text: plural(ending.length, 'שמירה אחת על פריט נגמרת היום או כבר נגמרה', '{n} שמירות על פריטים נגמרות היום או כבר נגמרו'),
        href: ending.length === 1 ? `/shop/items/${ending[0]!.id}` : '/shop/items?status=reserved',
        urgent: true,
      })
  }

  if (i.tasks === undefined) unreadable.push('משימות')
  else if (i.tasks) {
    const open = i.tasks.filter((t) => t.status === 'open')
    const mine = open.filter((t) => t.assigneeProfileId === i.userId)
    const late = mine.filter((t) => t.dueAt && dayOf(t.dueAt)! <= i.today)
    if (late.length) lines.push({ key: 'tasks-due', text: plural(late.length, 'משימה אחת שלך להיום', '{n} משימות שלך להיום'), href: '/tasks', urgent: true })
    const rest = mine.length - late.length
    if (rest > 0) lines.push({ key: 'tasks-mine', text: plural(rest, 'משימה פתוחה אחת שלך', '{n} משימות פתוחות שלך'), href: '/tasks', urgent: false })
    // Work nobody took yet, but only what is due: a shop's whole backlog is not "today".
    const freeDue = open.filter((t) => !t.assigneeProfileId && t.dueAt && dayOf(t.dueAt)! <= i.today)
    if (freeDue.length) lines.push({ key: 'tasks-free', text: plural(freeDue.length, 'משימה אחת להיום שאף אחד עוד לא לקח', '{n} משימות להיום שאף אחד עוד לא לקח'), href: '/tasks', urgent: false })
  }

  lines.sort((a, b) => Number(b.urgent) - Number(a.urgent))
  return { lines, unreadable }
}

// ── Most used (per person) ──────────────────────────────────────────────────

export type Use = { actionId: string; uses: number; lastUsedAt: string }

/**
 * A person's most used actions, among those they may still see: at least two
 * uses (one tap is not a habit), most used first, ties by the latest use.
 */
export function frequent<T extends { id: string }>(usage: readonly Use[], shown: readonly T[], max = 4): T[] {
  const byId = new Map(shown.map((a) => [a.id, a]))
  return [...usage]
    .filter((u) => u.uses >= 2 && byId.has(u.actionId))
    .sort((a, b) => b.uses - a.uses || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, max)
    .map((u) => byId.get(u.actionId)!)
}

// ── Scan ────────────────────────────────────────────────────────────────────

export type Scanned =
  | { kind: 'item'; id: string }
  | { kind: 'sku'; code: string }
  | { kind: 'gift_code'; code: string }
  | { kind: 'gift_url'; token: string }
  | { kind: 'empty' }

/** A gift card code as printed (JAS-7F3K-QP2M-9), any case, spaces or dashes. */
const GIFT_CODE = /^JAS[\s-]*([A-Z0-9]{4})[\s-]*([A-Z0-9]{4})[\s-]*([A-Z0-9])$/i

/**
 * What a scanned or typed code is. An item label's QR is the item's own link;
 * its barcode is the SKU. A gift card's QR is the recipient link
 * (…/gift/<token>); its printed code starts with JAS and has a check symbol,
 * which an item SKU (JAS-0042, 6 digits) never matches.
 */
export function classifyScan(raw: string): Scanned {
  const s = raw.trim().slice(0, 300)
  if (!s) return { kind: 'empty' }
  const item = /\/(?:inventory|shop\/items)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(s)
  if (item) return { kind: 'item', id: item[1]!.toLowerCase() }
  const gift = /^https:\/\/[^/\s]+\/gift\/([A-Za-z0-9_-]{16,128})\/?(?:[?#].*)?$/.exec(s)
  if (gift) return { kind: 'gift_url', token: gift[1]! }
  const code = GIFT_CODE.exec(s)
  if (code) return { kind: 'gift_code', code: `JAS-${code[1]}-${code[2]}-${code[3]}`.toUpperCase() }
  return { kind: 'sku', code: s }
}
