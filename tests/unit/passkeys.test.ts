import { describe, expect, it } from 'vitest'
import { biometricName, creationOptions, credentialJson, deviceLabel, fromBase64Url, passkeyMessage, requestOptions, toBase64Url } from '@/lib/auth/passkey-browser'
import { credentialSchema, errorCode, readEnabled } from '@/lib/auth/passkeys'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const bytes = (...n: number[]) => new Uint8Array(n)

describe('base64url', () => {
  it('round-trips every byte value without padding or + /', () => {
    const all = new Uint8Array(256).map((_, i) => i)
    const s = toBase64Url(all)
    expect(s).not.toMatch(/[+/=]/)
    expect([...fromBase64Url(s)]).toEqual([...all])
  })
  it('decodes unpadded input of each length', () => {
    for (const b of [bytes(1), bytes(1, 2), bytes(1, 2, 3), bytes(1, 2, 3, 4)]) expect([...fromBase64Url(toBase64Url(b))]).toEqual([...b])
  })
})

describe('options from Supabase', () => {
  it('turns the challenge, user id and excluded credentials into binary', () => {
    const o = creationOptions({
      challenge: toBase64Url(bytes(9, 8, 7)),
      rp: { id: 'jas-command-center.vercel.app', name: 'JAS' },
      user: { id: toBase64Url(bytes(1, 2)), name: 'a@b.c', displayName: 'A' },
      excludeCredentials: [{ id: toBase64Url(bytes(5)), type: 'public-key', transports: ['internal'] }],
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    })
    expect([...new Uint8Array(o.challenge as ArrayBuffer)]).toEqual([9, 8, 7])
    expect([...new Uint8Array(o.user.id as ArrayBuffer)]).toEqual([1, 2])
    expect([...new Uint8Array(o.excludeCredentials![0]!.id as ArrayBuffer)]).toEqual([5])
    expect(o.rp.id).toBe('jas-command-center.vercel.app')
  })
  it('leaves allowCredentials out when empty (discoverable sign-in: no email asked)', () => {
    const o = requestOptions({ challenge: toBase64Url(bytes(1)), allowCredentials: [], userVerification: 'preferred' })
    expect(o.allowCredentials).toBeUndefined()
    expect(o.userVerification).toBe('preferred')
  })
})

describe('the browser answer', () => {
  const sign = {
    id: 'abc',
    rawId: bytes(1, 2, 3).buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
    response: { clientDataJSON: bytes(4).buffer, authenticatorData: bytes(5).buffer, signature: bytes(6).buffer, userHandle: bytes(7).buffer },
  }
  it('serialises a sign-in to the shape the server checks', () => {
    const j = credentialJson(sign)
    expect(j).toEqual({ id: 'abc', rawId: 'AQID', type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: { clientDataJSON: 'BA', authenticatorData: 'BQ', signature: 'Bg', userHandle: 'Bw' } })
    expect(credentialSchema.safeParse(j).success).toBe(true)
  })
  it('serialises a registration with its transports', () => {
    const j = credentialJson({ ...sign, response: { clientDataJSON: bytes(4).buffer, attestationObject: bytes(8).buffer, getTransports: () => ['internal', 'hybrid'] } })
    expect(j.response).toEqual({ clientDataJSON: 'BA', attestationObject: 'CA', transports: ['internal', 'hybrid'] })
    expect(credentialSchema.safeParse(j).success).toBe(true)
  })
  it('refuses anything else before it reaches Supabase', () => {
    const j = credentialJson(sign)
    expect(credentialSchema.safeParse({ ...j, type: 'password' }).success).toBe(false)
    expect(credentialSchema.safeParse({ ...j, extra: 1 }).success).toBe(false)
    expect(credentialSchema.safeParse({ ...j, response: { ...j.response, signature: 'not base64url!' } }).success).toBe(false)
  })
})

describe('words for people', () => {
  it('names the unlock the device actually has', () => {
    expect(biometricName(IPHONE)).toBe('Face ID')
    expect(biometricName(ANDROID)).toBe('טביעת אצבע או זיהוי פנים')
    expect(deviceLabel(IPHONE)).toBe('iPhone')
    expect(deviceLabel(ANDROID)).toBe('טלפון אנדרואיד')
  })
  it('treats closing the Face ID sheet as a choice, not an error', () => {
    expect(passkeyMessage('NotAllowedError').cancelled).toBe(true)
    expect(passkeyMessage('passkey_disabled').cancelled).toBeUndefined()
  })
  it('has a Hebrew sentence for every code, including unknown ones', () => {
    for (const c of ['passkey_disabled', 'SecurityError', 'webauthn_credential_not_found', 'rate_limited', 'no_role', 'whatever', undefined]) expect(passkeyMessage(c).message).toMatch(/[֐-׿]/)
  })
})

describe('server helpers', () => {
  it('reads whether Supabase has passkeys on, and says "unknown" rather than guessing', () => {
    expect(readEnabled({ passkeys_enabled: true })).toBe(true)
    expect(readEnabled({ passkeys_enabled: false })).toBe(false)
    expect(readEnabled({ external: { passkey: true } })).toBe(true)
    expect(readEnabled({ external: { email: true } })).toBeNull()
    expect(readEnabled(null)).toBeNull()
  })
  it('keeps only the error code, never the message', () => {
    expect(errorCode({ code: 'passkey_disabled', message: 'user x@y.z' })).toBe('passkey_disabled')
    expect(errorCode(new Error('x@y.z'))).toBe('unknown')
    expect(errorCode(null)).toBe('unknown')
  })
})
