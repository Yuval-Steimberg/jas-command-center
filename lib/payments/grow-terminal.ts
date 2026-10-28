/**
 * The shop's Grow card terminal. Pure: configuration, the requests we send
 * and the parsing of what Grow sends back, so the service and the tests share
 * one definition. Nothing here touches the network or the database.
 *
 * Grow's flow ("Initiating a Transaction on a POS Terminal or Android Device"):
 *   1. createPaymentProcess with the terminal's DEDICATED pageCode + the
 *      deviceKey of the device that should take the payment → a url.
 *   2. Opening that url (on another device than the terminal, and kept open)
 *      pushes the amount to the terminal's "מסופון סליקה" app.
 *   3. The customer pays on the terminal; Grow sends a server update.
 *   4. We call approveTransaction to confirm we received the update.
 * Live environment only: there is no sandbox for this flow.
 *
 * ⚠️ Field names of the server update and of approveTransaction follow Grow's
 * (Meshulam) Light Server API as used elsewhere in JAS (gift_card_system's
 * grow.ts) and are parsed tolerantly; the page Grow sent describes the flow,
 * not the payloads. Verify them on the first real ₪1 charge (the raw update is
 * stored on the charge) before relying on this.
 */

export interface TerminalDevice {
  name: string
  key: string
}

export interface GrowTerminalConfig {
  /** Origin + path prefix, e.g. https://secure.meshulam.co.il/api/light/server/1.0 */
  base: string
  userId: string
  /** Not every Grow account is issued one; sent only when set. */
  apiKey: string | null
  pageCode: string
  devices: TerminalDevice[]
  webhookSecret: string
  /** Grow refuses a charge without a valid phone; a walk-in has none, so the shop's own number stands in. */
  fallbackPhone: string
}

export type TerminalSetup = { on: true; config: GrowTerminalConfig } | { on: false; missing: string[] }

export const DEFAULT_GROW_ORIGIN = 'https://secure.meshulam.co.il'
export const DEFAULT_GROW_PATH = '/api/light/server/1.0'
/** A charge that has had no answer for this long is shown as "no answer from the terminal". */
export const TERMINAL_WAIT_MS = 10 * 60 * 1000

/**
 * The shop's own Grow account, as Grow support sent it (2026-10-28). These are
 * account identifiers, not credentials: a charge still needs the webhook secret
 * to be recorded, and Grow only accepts it from this account's terminal flow.
 * The GROW_* variables override them.
 */
export const JAS_GROW = { userId: 'c3d675a2e8469b97', pageCode: '439510662e39', devices: 'מסופון:a3c1ff222e98489d' } as const

/** Keys Grow has replaced: a deployment still holding one sends the new key instead. */
export const RETIRED_DEVICE_KEYS: Record<string, string> = { '122fcdf308e01f78': 'a3c1ff222e98489d' }

/**
 * "Counter:abc123, Phone:def456" → two named devices; a bare "abc123" → one
 * device called מסופון. Grow supports several deviceKeys per account.
 */
export function parseDevices(raw: string | undefined): TerminalDevice[] {
  if (!raw) return []
  const out: TerminalDevice[] = []
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':')
    const name = i > 0 ? part.slice(0, i).trim() : 'מסופון'
    const raw = (i > 0 ? part.slice(i + 1) : part).trim()
    const key = RETIRED_DEVICE_KEYS[raw] ?? raw
    if (key && !out.some((d) => d.name === name)) out.push({ name, key })
  }
  return out
}

export function terminalSetup(e: {
  apiUrl?: string
  apiPath?: string
  userId?: string
  apiKey?: string
  pageCode?: string
  devices?: string
  webhookSecret?: string
  phone?: string
}): TerminalSetup {
  const devices = parseDevices(e.devices)
  const missing: string[] = []
  if (!e.userId) missing.push('GROW_USER_ID')
  if (!e.pageCode) missing.push('GROW_TERMINAL_PAGE_CODE')
  if (!devices.length) missing.push('GROW_TERMINAL_DEVICES')
  // The webhook is outside sign-in; the secret in its URL is its only lock.
  if (!e.webhookSecret || e.webhookSecret.length < 24) missing.push('GROW_WEBHOOK_SECRET (24+ characters)')
  if (missing.length) return { on: false, missing }
  const path = (e.apiPath ?? DEFAULT_GROW_PATH).replace(/\/+$/, '')
  return {
    on: true,
    config: {
      base: `${e.apiUrl ?? DEFAULT_GROW_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`,
      userId: e.userId!,
      apiKey: e.apiKey ?? null,
      pageCode: e.pageCode!,
      devices,
      webhookSecret: e.webhookSecret!,
      fallbackPhone: israeliMobile(e.phone) ?? SHOP_PHONE,
    },
  }
}

/** Agorot → the major-unit string Grow expects ("12.50"). */
export const growSum = (minor: number) => (minor / 100).toFixed(2)

/** A walk-in has no name on file; Grow refuses an empty fullName (gift_card_system gotcha #8b). */
export const WALK_IN_NAME = 'לקוח מזדמן'
/** The shop's phone (058-787-6549), sent for a customer with no valid mobile on file. */
export const SHOP_PHONE = '0587876549'

/** "+972 58-787-6549" → "0587876549"; null unless it is an Israeli mobile, the only form Grow accepts. */
export function israeliMobile(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.startsWith('972')) d = `0${d.slice(3)}`
  return /^05\d{8}$/.test(d) ? d : null
}

/** Grow wants a first and last name; anything less becomes the walk-in name. */
const fullNameFor = (name: string | null) => {
  const n = (name ?? '').trim().replace(/\s+/g, ' ')
  return n.split(' ').length >= 2 ? n.slice(0, 100) : WALK_IN_NAME
}

export function createProcessForm(
  c: GrowTerminalConfig,
  p: { amountMinor: number; deviceKey: string; chargeId: string; description: string; notifyUrl: string; returnUrl: string; fullName: string | null; phone: string | null },
): URLSearchParams {
  const f = new URLSearchParams()
  f.set('pageCode', c.pageCode)
  f.set('userId', c.userId)
  if (c.apiKey) f.set('apiKey', c.apiKey)
  f.set('deviceKey', p.deviceKey)
  f.set('sum', growSum(p.amountMinor))
  f.set('description', p.description)
  // One payment. Grow rejects maxPayments=1 (it must be 2–12); paymentNum=1 is its single-payment form.
  f.set('paymentNum', '1')
  f.set('notifyUrl', p.notifyUrl)
  // Grow requires both, or it falls back to its card-entry page instead of the terminal. Both return to the sale.
  f.set('successUrl', `${p.returnUrl}?terminal=success`)
  f.set('cancelUrl', `${p.returnUrl}?terminal=cancel`)
  // Echoed back on the server update, so the update names the exact charge.
  f.set('cField1', p.chargeId)
  f.set('pageField[fullName]', fullNameFor(p.fullName))
  f.set('pageField[phone]', israeliMobile(p.phone) ?? c.fallbackPhone)
  return f
}

export type ProcessResult = { ok: true; url: string; processId: string | null; processToken: string | null } | { ok: false; message: string }

/** Grow answers {status: 1, data: {url, processId, processToken}} or {status: 0, err: {message}}; sometimes wrapped in an array. */
export function parseProcessResponse(raw: unknown): ProcessResult {
  const r = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined
  if (!r || typeof r !== 'object') return { ok: false, message: 'Grow sent an empty answer.' }
  const data = (r.data ?? {}) as Record<string, unknown>
  const url = typeof data.url === 'string' ? data.url : null
  if (String(r.status) === '1' && url && /^https:\/\//.test(url)) {
    const s = (v: unknown) => (v == null || v === '' ? null : String(v))
    return { ok: true, url, processId: s(data.processId), processToken: s(data.processToken) }
  }
  const err = r.err as { message?: unknown } | string | undefined
  const message = typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : 'Grow did not return a link.'
  return { ok: false, message: message || 'Grow did not return a link.' }
}

/**
 * Grow's server update arrives as JSON or as a form; the Light Server API
 * nests fields under `data[...]` (and custom fields under
 * `data[customFields][cField1]`), the account-wide webhook sends them flat.
 * Everything becomes one flat string map.
 */
export function flattenUpdate(rawBody: string, contentType: string): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (k: string, v: unknown) => {
    if (v == null || typeof v === 'object') return
    if (!(k in out)) out[k] = String(v)
  }
  const walk = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v as Record<string, unknown>)
      else put(k, v)
    }
  }
  const t = rawBody.trim()
  if (contentType.includes('json') || t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t) as unknown
      const o = (Array.isArray(j) ? j[0] : j) as Record<string, unknown>
      if (o && typeof o === 'object') {
        // Top-level status/err first, then data's fields (data.status wins for its own keys only if absent above).
        walk(o)
        return out
      }
    } catch {
      /* fall through to form parsing */
    }
  }
  for (const [k, v] of new URLSearchParams(rawBody)) {
    // data[customFields][cField1] → cField1; data[processId] → processId; status → status
    const m = /\[([^\]]+)\]$/.exec(k)
    put(m ? m[1]! : k, v)
  }
  return out
}

export interface ServerUpdate {
  chargeId: string | null
  processId: string | null
  processToken: string | null
  transactionId: string | null
  asmachta: string | null
  cardSuffix: string | null
  /** Agorot actually charged, from Grow's major-unit sum. */
  paidMinor: number
  paid: boolean
  statusCode: string | null
  fields: Record<string, string>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readUpdate(fields: Record<string, string>): ServerUpdate {
  const s = (...keys: string[]) => {
    for (const k of keys) if (fields[k]?.trim()) return fields[k]!.trim()
    return null
  }
  const transactionId = s('transactionId', 'transactionCode')
  const asmachta = s('asmachta')
  const sum = Number(s('paymentSum', 'sum') ?? NaN)
  const paidMinor = Number.isFinite(sum) ? Math.round(sum * 100) : 0
  const statusCode = s('statusCode')
  const status = s('status')
  // A charge counts as paid only with a transaction reference and an amount, and with no status saying
  // otherwise: statusCode 2 = paid in the Light Server API; status 1 = a successful call.
  const statusOk = (statusCode == null || statusCode === '2' || statusCode === '1') && (status == null || status === '1')
  const cf = s('cField1')
  return {
    chargeId: cf && UUID.test(cf) ? cf.toLowerCase() : null,
    processId: s('processId'),
    processToken: s('processToken'),
    transactionId: transactionId ?? asmachta,
    asmachta,
    cardSuffix: s('cardSuffix'),
    paidMinor,
    paid: Boolean(transactionId ?? asmachta) && paidMinor > 0 && statusOk,
    statusCode: statusCode ?? status,
    fields,
  }
}

/** approveTransaction: our credentials plus everything the update carried, as Grow asks. */
export function approveForm(c: GrowTerminalConfig, u: ServerUpdate): URLSearchParams {
  const f = new URLSearchParams()
  for (const [k, v] of Object.entries(u.fields)) if (!['userId', 'apiKey', 'pageCode', 'token', 'err', 'status'].includes(k)) f.set(k, v)
  f.set('pageCode', c.pageCode)
  f.set('userId', c.userId)
  if (c.apiKey) f.set('apiKey', c.apiKey)
  return f
}

/** Timing-safe-enough string compare for a URL token (lengths are public). */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
