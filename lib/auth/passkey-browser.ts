/**
 * The browser half of a passkey (Face ID / fingerprint) ceremony. Supabase Auth
 * holds the passkeys and checks them; the server actions fetch its challenge and
 * hand back its answer, so the session cookie is set exactly as a password
 * sign-in sets it. This file only converts between Supabase's JSON options and
 * the binary shapes `navigator.credentials` wants, and words the outcome in
 * Hebrew. Pure apart from the two functions that touch `navigator`.
 */

export type JsonCreationOptions = {
  challenge: string
  user: { id: string; name: string; displayName: string }
  excludeCredentials?: { id: string; type?: string; transports?: string[] }[]
  [k: string]: unknown
}
export type JsonRequestOptions = {
  challenge: string
  allowCredentials?: { id: string; type?: string; transports?: string[] }[]
  [k: string]: unknown
}
/** What Supabase expects back: the W3C `PublicKeyCredential.toJSON()` shape. */
export type CredentialJson = {
  id: string
  rawId: string
  type: 'public-key'
  response: Record<string, string | string[] | undefined>
  clientExtensionResults: Record<string, unknown>
  authenticatorAttachment?: string
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const buf = (s: string) => fromBase64Url(s).buffer as ArrayBuffer
const descriptors = (list?: { id: string; type?: string; transports?: string[] }[]) =>
  list?.length ? list.map((c) => ({ ...c, id: buf(c.id), type: 'public-key' as const, transports: c.transports as AuthenticatorTransport[] | undefined })) : undefined

export function creationOptions(o: JsonCreationOptions): PublicKeyCredentialCreationOptions {
  const { challenge, user, excludeCredentials, ...rest } = o
  const out = { ...rest, challenge: buf(challenge), user: { ...user, id: buf(user.id) } } as unknown as PublicKeyCredentialCreationOptions
  const ex = descriptors(excludeCredentials)
  if (ex) out.excludeCredentials = ex
  return out
}

export function requestOptions(o: JsonRequestOptions): PublicKeyCredentialRequestOptions {
  const { challenge, allowCredentials, ...rest } = o
  const out = { ...rest, challenge: buf(challenge) } as unknown as PublicKeyCredentialRequestOptions
  const allow = descriptors(allowCredentials)
  if (allow) out.allowCredentials = allow
  return out
}

type AnyCredential = {
  id: string
  rawId: ArrayBuffer
  type: string
  authenticatorAttachment?: string | null
  getClientExtensionResults(): unknown
  response: {
    clientDataJSON: ArrayBuffer
    attestationObject?: ArrayBuffer
    authenticatorData?: ArrayBuffer
    signature?: ArrayBuffer
    userHandle?: ArrayBuffer | null
    getTransports?: () => string[]
  }
}

/** Manual toJSON: Safari before 18.4 has no `PublicKeyCredential.toJSON()`. */
export function credentialJson(c: AnyCredential): CredentialJson {
  const r = c.response
  const response: CredentialJson['response'] = { clientDataJSON: toBase64Url(r.clientDataJSON) }
  if (r.attestationObject) {
    response.attestationObject = toBase64Url(r.attestationObject)
    const t = typeof r.getTransports === 'function' ? r.getTransports() : undefined
    if (t?.length) response.transports = t
  }
  if (r.authenticatorData) response.authenticatorData = toBase64Url(r.authenticatorData)
  if (r.signature) response.signature = toBase64Url(r.signature)
  if (r.userHandle) response.userHandle = toBase64Url(r.userHandle)
  return {
    id: c.id,
    rawId: toBase64Url(c.rawId),
    type: 'public-key',
    response,
    clientExtensionResults: (c.getClientExtensionResults() ?? {}) as Record<string, unknown>,
    ...(c.authenticatorAttachment ? { authenticatorAttachment: c.authenticatorAttachment } : {}),
  }
}

/** What to call this device in the list of saved sign-ins ("iPhone", "Mac", …). */
export function deviceLabel(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  // iPadOS asks for desktop sites and reports itself as a Mac.
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Android/.test(ua)) return 'טלפון אנדרואיד'
  if (/Windows/.test(ua)) return 'מחשב Windows'
  return 'מכשיר'
}

/** "Face ID" on an Apple device, the generic words elsewhere. */
export function biometricName(ua: string): string {
  if (/iPhone|iPad/.test(ua)) return 'Face ID'
  if (/Macintosh/.test(ua)) return 'Touch ID'
  if (/Android/.test(ua)) return 'טביעת אצבע או זיהוי פנים'
  if (/Windows/.test(ua)) return 'Windows Hello'
  return 'Face ID או טביעת אצבע'
}

export type PasskeyOutcome = { ok: true } | { ok: false; cancelled?: boolean; message: string }

/**
 * Hebrew for a failed ceremony. `code` is Supabase's `error_code`, or a browser
 * DOMException name. A person closing the Face ID sheet is not an error.
 */
export function passkeyMessage(code: string | undefined): { cancelled?: boolean; message: string } {
  switch (code) {
    case 'NotAllowedError':
    case 'AbortError':
      return { cancelled: true, message: 'הפעולה בוטלה. אפשר לנסות שוב.' }
    case 'InvalidStateError':
    case 'webauthn_credential_exists':
      return { message: 'כניסה מהירה כבר מופעלת במכשיר הזה.' }
    case 'SecurityError':
      return { message: 'הכתובת הזאת עדיין לא מאושרת לכניסה מהירה. צריך להוסיף אותה בהגדרות.' }
    case 'NotSupportedError':
    case 'unsupported':
      return { message: 'הדפדפן או המכשיר הזה לא תומכים בכניסה מהירה. אפשר להמשיך עם סיסמה.' }
    case 'passkey_disabled':
      return { message: 'כניסה מהירה עוד לא הופעלה במערכת. אפשר להמשיך עם סיסמה.' }
    case 'too_many_passkeys':
      return { message: 'שמורים יותר מדי מכשירים. מוחקים אחד מהרשימה ומנסים שוב.' }
    case 'webauthn_challenge_expired':
    case 'webauthn_challenge_not_found':
      return { message: 'עבר יותר מדי זמן. מנסים שוב.' }
    case 'webauthn_credential_not_found':
      return { message: 'המכשיר הזה לא מוכר. נכנסים עם סיסמה, ואז מפעילים כניסה מהירה מחדש.' }
    case 'email_not_confirmed':
    case 'user_banned':
    case 'no_role':
      return { message: 'לחשבון הזה אין גישה פעילה. כדאי לפנות למנהלת.' }
    case 'rate_limited':
      return { message: 'יותר מדי ניסיונות. מחכים רבע שעה ומנסים שוב.' }
    default:
      return { message: 'הכניסה המהירה לא הצליחה. אפשר לנסות שוב או להיכנס עם סיסמה.' }
  }
}

export function browserSupportsPasskeys(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.get === 'function'
}

/** True when this device has a built-in Face ID / fingerprint unlock (not only a USB key). */
export async function hasBuiltInUnlock(): Promise<boolean> {
  if (!browserSupportsPasskeys()) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** Runs `navigator.credentials` and maps a browser refusal to its DOMException name. */
export async function runCeremony<T>(f: () => Promise<T | null>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  if (!browserSupportsPasskeys()) return { ok: false, code: 'unsupported' }
  try {
    const v = await f()
    return v ? { ok: true, value: v } : { ok: false, code: 'NotAllowedError' }
  } catch (e) {
    return { ok: false, code: e instanceof Error ? e.name : 'unknown' }
  }
}
