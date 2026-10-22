import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { resetSourceCache } from './fake-server'
import { getMapTraffic, parseServiceAccount } from '@/lib/integrations/map/ga4'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const keyFile = { type: 'service_account', client_email: 'cc-reader@jas.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }

beforeEach(() => {
  resetSourceCache()
  delete process.env.MAP_GA4_PROPERTY_ID
  delete process.env.GA4_SERVICE_ACCOUNT_JSON
})
afterEach(() => vi.unstubAllGlobals())

describe('map visitors from GA4', () => {
  it('is not configured, not zero, without the property and key', async () => {
    expect(await getMapTraffic()).toEqual({ state: 'not_configured', missing: ['MAP_GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON'] })
  })

  it('accepts the key file as JSON or base64', () => {
    expect(parseServiceAccount(JSON.stringify(keyFile)).client_email).toBe(keyFile.client_email)
    expect(parseServiceAccount(Buffer.from(JSON.stringify(keyFile)).toString('base64')).client_email).toBe(keyFile.client_email)
    expect(() => parseServiceAccount('{"client_email":"x"}')).toThrow()
  })

  it('signs a read-only token request and maps the two periods, days and sources', async () => {
    process.env.MAP_GA4_PROPERTY_ID = '123456789'
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify(keyFile)
    const calls: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { body: unknown }) => {
      const body = String(init.body)
      calls.push({ url, body })
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
      const req = JSON.parse(body)
      if (req.dateRanges.length === 2)
        return new Response(JSON.stringify({ rows: [
          { dimensionValues: [{ value: 'date_range_0' }], metricValues: [{ value: '40' }, { value: '55' }, { value: '90' }] },
          { dimensionValues: [{ value: 'date_range_1' }], metricValues: [{ value: '20' }, { value: '25' }, { value: '30' }] },
        ] }))
      if (req.dimensions[0].name === 'date') return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: '20261021' }], metricValues: [{ value: '3' }, { value: '4' }] }] }))
      return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: 'instagram.com' }], metricValues: [{ value: '30' }] }] }))
    })
    const r = await getMapTraffic()
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    expect(r.data.current).toEqual({ activeUsers: 40, sessions: 55, screenPageViews: 90 })
    expect(r.data.previous).toEqual({ activeUsers: 20, sessions: 25, screenPageViews: 30 })
    expect(r.data.daily).toEqual([{ date: '2026-10-21', activeUsers: 3, sessions: 4 }])
    expect(r.data.sources).toEqual([{ source: 'instagram.com', sessions: 30 }])

    const assertion = new URLSearchParams(calls[0]!.body).get('assertion')!
    const [h, p, sig] = assertion.split('.')
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toMatchObject({ iss: keyFile.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly' })
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true)
    expect(calls[1]!.url).toContain('/properties/123456789:runReport')
  })
})
