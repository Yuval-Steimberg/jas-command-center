/**
 * Volunteer notifications. Every message is a row in cc_vol_outbox first
 * (dedupe key = it is sent once), then delivered by `deliverOutbox`, which
 * either front end or the hourly sweep may run: claiming is atomic, so running
 * it twice never sends twice.
 *
 * Channel: email through SendGrid. WhatsApp is not available (the connected
 * WhatsApp number is the owner's design agent); consent is recorded for later.
 *
 * Restraint is the point: confirmations and changes are transactional and
 * always sent; reminders follow `notifyReminders`; new-opportunity mail follows
 * `notifyOpportunities` and is capped at one per volunteer per three days;
 * nothing non-urgent goes out between 21:00 and 08:00 Israel time.
 */
import type { Activity, OutboxRow, Shift, Signup, Volunteer } from './model'
import { AREA_HE } from './model'
import type { NewOutbox, VolunteerStore } from './store'
import { afterQuietHours, dayLabelHe, reminderAt, timeRange } from './time'

export interface NotifyContext {
  /** The volunteer app's public URL, for links in messages. */
  appUrl: string | null
  /** The team's phone shown in messages when an activity has none. */
  teamPhone: string | null
  now?: number
}

export type Sender = (to: string, subject: string, text: string) => Promise<{ ok: true } | { ok: false; error: string }>

const H = 3_600_000
const link = (ctx: NotifyContext, path: string) => (ctx.appUrl ? `${ctx.appUrl.replace(/\/$/, '')}${path}` : null)
const footer = (ctx: NotifyContext) =>
  ['', '—', 'Just A Second · JAS Volunteers', link(ctx, '/profile') ? `לשינוי העדפות ההתראות: ${link(ctx, '/profile')}` : null].filter((x) => x !== null).join('\n')

function when(shift: Pick<Shift, 'startsAt' | 'endsAt'>) {
  return `${dayLabelHe(shift.startsAt)}, ${timeRange(shift.startsAt, shift.endsAt)}`
}

function where(a: Pick<Activity, 'locationName' | 'address' | 'area'>) {
  return [a.locationName, a.address, a.area ? AREA_HE[a.area] : null].filter(Boolean).join(', ') || 'המיקום יישלח בהמשך'
}

function shiftBlock(a: Activity, shift: Shift, ctx: NotifyContext) {
  return [
    `${a.title}`,
    `מתי: ${when(shift)}`,
    `איפה: ${where(a)}`,
    a.equipment ? `מה להביא: ${a.equipment}` : null,
    a.coordinatorName ? `רכז/ת: ${a.coordinatorName}` : null,
    a.contactPhone || ctx.teamPhone ? `טלפון הצוות: ${a.contactPhone || ctx.teamPhone}` : null,
  ].filter((x) => x !== null).join('\n')
}

/** Urgent = about a shift less than a day away: not held for quiet hours. */
const notBefore = (ctx: NotifyContext, shift: Pick<Shift, 'startsAt'> | null) => {
  const now = ctx.now ?? Date.now()
  if (shift && Date.parse(shift.startsAt) - now < 24 * H) return new Date(now).toISOString()
  return new Date(afterQuietHours(now)).toISOString()
}

export type SignupMessage = 'joined' | 'waitlisted' | 'promoted' | 'invited' | 'cancelled_by_team' | 'removed'

/** The message for a sign-up change. Null when there is nothing to say (e.g. a volunteer's own cancellation). */
export function signupMessage(kind: SignupMessage, v: Pick<Volunteer, 'id' | 'email' | 'fullName'>, s: Signup, shift: Shift, a: Activity, ctx: NotifyContext, reason?: string | null): NewOutbox | null {
  if (!v.email) return null
  const first = v.fullName.split(' ')[0]
  const shiftUrl = link(ctx, `/my/${s.id}`)
  const base = { volunteerId: v.id, toEmail: v.email, kind, notBefore: notBefore(ctx, shift) }
  const block = shiftBlock(a, shift, ctx)
  switch (kind) {
    case 'joined':
      return { ...base, dedupeKey: `joined:${s.id}:${s.version}`, subject: `נרשמת: ${a.title}, ${dayLabelHe(shift.startsAt)}`, body: [`היי ${first},`, '', 'נרשמת למשמרת. תודה.', '', block, '', shiftUrl ? `כל הפרטים, וביטול אם צריך: ${shiftUrl}` : null, footer(ctx)].filter((x) => x !== null).join('\n') }
    case 'waitlisted':
      return { ...base, dedupeKey: `waitlisted:${s.id}:${s.version}`, subject: `ברשימת ההמתנה: ${a.title}`, body: [`היי ${first},`, '', 'המשמרת מלאה כרגע, ונכנסת לרשימת ההמתנה. אם יתפנה מקום, הוא יעבור אלייך לפי סדר ההרשמה ותקבל/י על כך הודעה.', '', block, footer(ctx)].join('\n') }
    case 'promoted':
      return { ...base, dedupeKey: `promoted:${s.id}:${s.version}`, subject: `התפנה מקום, ואת/ה רשום/ה: ${a.title}`, body: [`היי ${first},`, '', 'התפנה מקום במשמרת שחיכית לה, ועכשיו את/ה רשום/ה.', '', block, '', shiftUrl ? `לא מתאים יותר? אפשר לבטל כאן: ${shiftUrl}` : null, footer(ctx)].filter((x) => x !== null).join('\n') }
    case 'invited':
      return { ...base, dedupeKey: `invited:${s.id}:${s.version}`, subject: `הזמנה להתנדבות: ${a.title}`, body: [`היי ${first},`, '', 'חשבנו שהמשמרת הזאת מתאימה לך. ההרשמה בידיים שלך: שום דבר לא נקבע בלי אישור שלך.', '', block, '', shiftUrl ? `לאישור או לדחייה: ${shiftUrl}` : null, footer(ctx)].filter((x) => x !== null).join('\n') }
    case 'cancelled_by_team':
      return { ...base, notBefore: new Date(ctx.now ?? Date.now()).toISOString(), dedupeKey: `cancelled:${s.id}:${s.version}`, subject: `בוטל: ${a.title}, ${dayLabelHe(shift.startsAt)}`, body: [`היי ${first},`, '', 'המשמרת שנרשמת אליה בוטלה. אין צורך להגיע.', reason ? `הסיבה: ${reason}` : null, '', `${a.title}`, `מתי: ${when(shift)}`, '', 'תודה על הנכונות, ונשמח לראותך בפעילות אחרת.', link(ctx, '/activities') ? `פעילויות פתוחות: ${link(ctx, '/activities')}` : null, footer(ctx)].filter((x) => x !== null).join('\n') }
    case 'removed':
      return { ...base, dedupeKey: `removed:${s.id}:${s.version}`, subject: `עדכון לגבי המשמרת: ${a.title}`, body: [`היי ${first},`, '', 'הרשמתך למשמרת הזאת הוסרה על ידי הצוות.', reason ? `הסיבה: ${reason}` : null, '', `${a.title}`, `מתי: ${when(shift)}`, '', a.contactPhone || ctx.teamPhone ? `לשאלות: ${a.contactPhone || ctx.teamPhone}` : null, footer(ctx)].filter((x) => x !== null).join('\n') }
  }
}

/** "Something changed": time, place or instructions. One per volunteer per activity version. */
export function changeMessage(v: Pick<Volunteer, 'id' | 'email' | 'fullName'>, s: Signup, shift: Shift, a: Activity, what: string, ctx: NotifyContext): NewOutbox | null {
  if (!v.email) return null
  return {
    volunteerId: v.id, toEmail: v.email, kind: 'changed', notBefore: notBefore(ctx, shift),
    dedupeKey: `changed:${s.id}:${a.version}:${shift.version}`,
    subject: `עדכון בפעילות: ${a.title}`,
    body: [`היי ${v.fullName.split(' ')[0]},`, '', `יש עדכון בפעילות שנרשמת אליה: ${what}`, '', shiftBlock(a, shift, ctx), '', link(ctx, `/my/${s.id}`) ? `הפרטים המעודכנים: ${link(ctx, `/my/${s.id}`)}` : null, footer(ctx)].filter((x) => x !== null).join('\n'),
  }
}

/** A coordinator's message to the confirmed volunteers of one shift. Staff write it and confirm sending. */
export function coordinatorMessage(v: Pick<Volunteer, 'id' | 'email' | 'fullName'>, s: Signup, shift: Shift, a: Activity, text: string, requestId: string, ctx: NotifyContext): NewOutbox | null {
  if (!v.email) return null
  return {
    volunteerId: v.id, toEmail: v.email, kind: 'message', notBefore: notBefore(ctx, shift),
    dedupeKey: `message:${requestId}:${s.id}`,
    subject: `הודעה מהצוות: ${a.title}, ${dayLabelHe(shift.startsAt)}`,
    body: [`היי ${v.fullName.split(' ')[0]},`, '', text.trim(), '', `${a.title} · ${when(shift)}`, footer(ctx)].join('\n'),
  }
}

export function welcomeMessage(v: Pick<Volunteer, 'id' | 'email' | 'fullName'>, ctx: NotifyContext): NewOutbox | null {
  if (!v.email) return null
  return {
    volunteerId: v.id, toEmail: v.email, kind: 'welcome', notBefore: new Date(afterQuietHours(ctx.now ?? Date.now())).toISOString(), dedupeKey: `welcome:${v.id}`,
    subject: 'ברוכים הבאים ל-JAS Volunteers',
    body: [`היי ${v.fullName.split(' ')[0]},`, '', 'תודה שהצטרפת לקהילת המתנדבים של Just A Second. ביחד אנחנו נותנים לרהיטים ולחפצים חיים שניים.', '', link(ctx, '/activities') ? `כל הפעילויות הפתוחות: ${link(ctx, '/activities')}` : null, footer(ctx)].filter((x) => x !== null).join('\n'),
  }
}

// ── Scheduled messages (reminders, thanks) ─────────────────────────────────

export interface Loaded {
  shifts: Shift[]
  activities: Activity[]
  signups: Signup[]
  volunteers: Volunteer[]
}

/**
 * Day-before reminders for confirmed volunteers who want them, for shifts in
 * the next two days. A volunteer who joined after the reminder time gets no
 * reminder: the confirmation already said it all.
 */
export function reminderRows(l: Loaded, ctx: NotifyContext): NewOutbox[] {
  const now = ctx.now ?? Date.now()
  const act = new Map(l.activities.map((a) => [a.id, a]))
  const vol = new Map(l.volunteers.map((v) => [v.id, v]))
  const out: NewOutbox[] = []
  for (const sh of l.shifts) {
    const a = act.get(sh.activityId)
    const start = Date.parse(sh.startsAt)
    if (!a || a.status !== 'published' || sh.status !== 'open' || start <= now || start - now > 48 * H) continue
    const at = reminderAt(sh.startsAt)
    for (const s of l.signups) {
      if (s.shiftId !== sh.id || s.status !== 'confirmed') continue
      const v = vol.get(s.volunteerId)
      if (!v?.email || v.status !== 'active' || !v.notifyReminders) continue
      if (Date.parse(s.updatedAt) > at) continue
      out.push({
        volunteerId: v.id, toEmail: v.email, kind: 'reminder', notBefore: new Date(at).toISOString(),
        dedupeKey: `reminder:${s.id}:${sh.startsAt}`,
        subject: `תזכורת: ${a.title}, ${dayLabelHe(sh.startsAt)}`,
        body: [`היי ${v.fullName.split(' ')[0]},`, '', 'תזכורת קטנה למשמרת שלך:', '', shiftBlock(a, sh, ctx), a.arrivalInfo ? `\nהגעה: ${a.arrivalInfo}` : null, '', link(ctx, `/my/${s.id}`) ? `לא יכול/ה להגיע? חשוב לבטל כאן כדי שמישהו אחר יוכל להגיע: ${link(ctx, `/my/${s.id}`)}` : null, footer(ctx)].filter((x) => x !== null).join('\n'),
      })
    }
  }
  return out
}

/** One thank-you per volunteer per activity, after a shift they attended ended (last 3 days only). */
export function thanksRows(l: Loaded, ctx: NotifyContext): NewOutbox[] {
  const now = ctx.now ?? Date.now()
  const act = new Map(l.activities.map((a) => [a.id, a]))
  const sh = new Map(l.shifts.map((s) => [s.id, s]))
  const vol = new Map(l.volunteers.map((v) => [v.id, v]))
  const out = new Map<string, NewOutbox>()
  for (const s of l.signups) {
    const shift = sh.get(s.shiftId)
    if (!shift || s.status !== 'confirmed' || s.attendance !== 'present') continue
    const end = Date.parse(shift.endsAt)
    if (end > now || now - end > 72 * H) continue
    const a = act.get(shift.activityId)
    const v = vol.get(s.volunteerId)
    if (!a || !v?.email || v.status !== 'active') continue
    const key = `thanks:${a.id}:${v.id}`
    if (out.has(key)) continue
    out.set(key, {
      volunteerId: v.id, toEmail: v.email, kind: 'thanks', notBefore: new Date(afterQuietHours(now)).toISOString(), dedupeKey: key,
      subject: `תודה על ההתנדבות: ${a.title}`,
      body: [`היי ${v.fullName.split(' ')[0]},`, '', 'תודה שהגעת. בזכותך עוד רהיטים וחפצים מקבלים חיים שניים במקום להיזרק.', '', link(ctx, '/my') ? `השעות שלך נרשמו, ואפשר לראות אותן כאן: ${link(ctx, '/my')}` : null, footer(ctx)].filter((x) => x !== null).join('\n'),
    })
  }
  return [...out.values()]
}

/**
 * New-opportunity mail when an activity is published: only volunteers who
 * opted in, whose areas include the activity's (or who chose none), who did not
 * get one in the last three days. Capped per publish.
 */
export function opportunityRows(a: Activity, shifts: Shift[], volunteers: Volunteer[], recent: Pick<OutboxRow, 'volunteerId' | 'kind' | 'createdAt'>[], ctx: NotifyContext, cap = 200): NewOutbox[] {
  const now = ctx.now ?? Date.now()
  const first = shifts.filter((s) => s.status === 'open' && Date.parse(s.startsAt) > now).sort((x, y) => x.startsAt.localeCompare(y.startsAt))[0]
  if (a.status !== 'published' || !first) return []
  const since = now - 72 * H
  const got = new Set(recent.filter((r) => r.kind === 'opportunity' && Date.parse(r.createdAt) >= since).map((r) => r.volunteerId))
  return volunteers
    .filter((v) => v.status === 'active' && v.email && v.notifyOpportunities && !got.has(v.id) && (!a.area || v.areas.length === 0 || v.areas.includes(a.area)) && (!a.adultsOnly || v.adult))
    .slice(0, cap)
    .map((v) => ({
      volunteerId: v.id, toEmail: v.email!, kind: 'opportunity', notBefore: new Date(afterQuietHours(now)).toISOString(), dedupeKey: `opportunity:${a.id}:${v.id}`,
      subject: `פעילות חדשה: ${a.title}`,
      body: [`היי ${v.fullName.split(' ')[0]},`, '', 'נפתחה פעילות שאולי תתאים לך:', '', `${a.title}`, a.summary, `החל מ: ${when(first)}`, `איפה: ${where(a)}`, '', link(ctx, `/activities/${a.id}`) ? `לפרטים ולהרשמה: ${link(ctx, `/activities/${a.id}`)}` : null, footer(ctx)].filter((x) => x !== null && x !== undefined).join('\n'),
    }))
}

// ── Delivery ───────────────────────────────────────────────────────────────

export interface DeliveryResult {
  claimed: number
  sent: number
  failed: number
  skipped: number
}

/** Send what is due. A volunteer who was deleted or blocked since the row was queued is skipped, never mailed. */
export async function deliverOutbox(store: VolunteerStore, send: Sender | null, limit = 50): Promise<DeliveryResult> {
  const r: DeliveryResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 }
  if (!send) return r
  const rows = await store.claimOutbox(limit)
  r.claimed = rows.length
  for (const o of rows) {
    const v = o.volunteerId ? await store.getVolunteer(o.volunteerId) : null
    const to = v ? v.email : o.toEmail
    if (!to || (v && v.status !== 'active')) {
      await store.markOutbox(o.id, 'skipped', v ? `volunteer is ${v.status}` : 'no address')
      r.skipped++
      continue
    }
    const res = await send(to, o.subject, o.body)
    if (res.ok) {
      await store.markOutbox(o.id, 'sent')
      r.sent++
    } else {
      await store.markOutbox(o.id, 'failed', res.error.slice(0, 500))
      r.failed++
    }
  }
  return r
}

/**
 * The scheduled job: queue reminders and thank-yous, then deliver everything
 * due. Run hourly (the Command Center's sweep) and by the volunteer app's own
 * cron; both at once is safe.
 */
export async function runVolunteerJobs(store: VolunteerStore, send: Sender | null, ctx: NotifyContext): Promise<{ queued: number; delivery: DeliveryResult }> {
  const now = ctx.now ?? Date.now()
  const shifts = await store.listShifts({ from: new Date(now - 72 * H).toISOString(), to: new Date(now + 48 * H).toISOString() })
  const signups = shifts.length ? await store.listSignups({ shiftIds: shifts.map((s) => s.id), statuses: ['confirmed'] }) : []
  const [activities, volunteers] = await Promise.all([
    shifts.length ? store.listActivities({ ids: [...new Set(shifts.map((s) => s.activityId))] }) : Promise.resolve([]),
    signups.length ? store.listVolunteers({ ids: [...new Set(signups.map((s) => s.volunteerId))] }) : Promise.resolve([]),
  ])
  const l = { shifts, activities, signups, volunteers }
  const added = await store.enqueue([...reminderRows(l, ctx), ...thanksRows(l, ctx)])
  return { queued: added.length, delivery: await deliverOutbox(store, send) }
}

/** SendGrid v3 sender. A 202 is "accepted", not "delivered". Never retried here (the outbox retries). */
export function sendgridSender(cfg: { apiKey: string | undefined; from: string | undefined; replyTo?: string | undefined }): Sender | null {
  if (!cfg.apiKey || !cfg.from) return null
  const m = /^(.*)<([^>]+)>\s*$/.exec(cfg.from)
  const from = m ? { email: m[2]!.trim(), name: m[1]!.trim().replace(/^"|"$/g, '') || undefined } : { email: cfg.from.trim() }
  return async (to, subject, text) => {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from,
          ...(cfg.replyTo ? { reply_to: { email: cfg.replyTo } } : {}),
          subject: subject.slice(0, 200),
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: htmlOf(text) },
          ],
          tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
        }),
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      })
      if (res.status === 202 || res.ok) return { ok: true }
      return { ok: false, error: `SendGrid HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** The plain text as right-to-left HTML, links clickable. */
export function htmlOf(text: string): string {
  const body = esc(text).replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#333D36">${u}</a>`).replace(/\n/g, '<br>')
  return `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;font-size:16px;line-height:1.6;color:#333D36;background:#FFFCF5;padding:20px">${body}</div>`
}
