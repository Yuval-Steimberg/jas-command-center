import { describe, expect, it } from 'vitest'
import { JAS_GROW, SHOP_PHONE, israeliMobile, approveForm, createProcessForm, flattenUpdate, parseDevices, parseProcessResponse, readUpdate, terminalSetup, WALK_IN_NAME } from '@/lib/payments/grow-terminal'

const secret = 's'.repeat(32)
const on = (over: Record<string, string> = {}) => {
  const s = terminalSetup({ userId: 'u1', pageCode: 'pc', devices: 'Counter:dk-1', webhookSecret: secret, ...over })
  if (!s.on) throw new Error(s.missing.join())
  return s.config
}

describe('configuration', () => {
  it('replaces a device key Grow retired, and the shop defaults name the current one', () => {
    expect(parseDevices('מסופון:122fcdf308e01f78')).toEqual([{ name: 'מסופון', key: 'a3c1ff222e98489d' }])
    expect(parseDevices(JAS_GROW.devices)).toEqual([{ name: 'מסופון', key: 'a3c1ff222e98489d' }])
  })

  it('stays off and names every missing variable', () => {
    expect(terminalSetup({})).toEqual({ on: false, missing: ['GROW_USER_ID', 'GROW_TERMINAL_PAGE_CODE', 'GROW_TERMINAL_DEVICES', 'GROW_WEBHOOK_SECRET (24+ characters)'] })
    expect(terminalSetup({ userId: 'u', pageCode: 'p', devices: 'k', webhookSecret: 'short' })).toMatchObject({ on: false, missing: ['GROW_WEBHOOK_SECRET (24+ characters)'] })
  })
  it('turns on with the default Grow base, and the api key only when given', () => {
    const c = on()
    expect(c.base).toBe('https://secure.meshulam.co.il/api/light/server/1.0')
    expect(c.apiKey).toBeNull()
    expect(on({ apiUrl: 'https://x.test', apiPath: 'api/v2/' }).base).toBe('https://x.test/api/v2')
  })
  it('reads one bare key or several named devices', () => {
    expect(parseDevices('abc')).toEqual([{ name: 'מסופון', key: 'abc' }])
    expect(parseDevices(' Counter:abc , Phone:def,')).toEqual([{ name: 'Counter', key: 'abc' }, { name: 'Phone', key: 'def' }])
  })
})

describe('createPaymentProcess', () => {
  it('sends the dedicated page, the device, the amount in shekels and the charge id', () => {
    const f = createProcessForm(on({ apiKey: 'ak' }), { amountMinor: 12550, deviceKey: 'dk-1', chargeId: 'c-1', description: 'S-00001', notifyUrl: 'https://cc.test/api/webhooks/grow?token=t', fullName: null, phone: null })
    expect(f.has('maxPayments')).toBe(false)
    expect(Object.fromEntries(f)).toMatchObject({ pageCode: 'pc', userId: 'u1', apiKey: 'ak', deviceKey: 'dk-1', sum: '125.50', paymentNum: '1', cField1: 'c-1', 'pageField[fullName]': WALK_IN_NAME })
    // Grow refuses a charge without a phone: a walk-in sends the shop's number.
    expect(f.get('pageField[phone]')).toBe(SHOP_PHONE)
    const named = createProcessForm(on({}), { amountMinor: 100, deviceKey: 'dk', chargeId: 'c', description: 'd', notifyUrl: 'https://x', fullName: 'נועה', phone: '+972 54-123-4567' })
    expect(named.get('pageField[phone]')).toBe('0541234567')
    expect(named.get('pageField[fullName]')).toBe(WALK_IN_NAME)
    expect(createProcessForm(on({}), { amountMinor: 100, deviceKey: 'dk', chargeId: 'c', description: 'd', notifyUrl: 'https://x', fullName: 'Dana Levi', phone: '03-1234567' }).get('pageField[phone]')).toBe(SHOP_PHONE)
    expect([israeliMobile('058-787-6549'), israeliMobile('12345'), israeliMobile(null)]).toEqual(['0587876549', null, null])
  })
  it('takes the url from a success and the message from a refusal', () => {
    expect(parseProcessResponse([{ status: 1, data: { url: 'https://grow.test/p/1', processId: 77, processToken: 'tk' } }])).toEqual({ ok: true, url: 'https://grow.test/p/1', processId: '77', processToken: 'tk' })
    expect(parseProcessResponse({ status: 0, err: { message: 'deviceKey לא תקין' } })).toEqual({ ok: false, message: 'deviceKey לא תקין' })
    expect(parseProcessResponse({ status: 1, data: { url: 'javascript:alert(1)' } })).toMatchObject({ ok: false })
  })
})

describe('server update', () => {
  it('flattens the Light Server form shape, custom field included', () => {
    const body = 'err=&status=1&data[processId]=77&data[transactionId]=9001&data[asmachta]=123456&data[cardSuffix]=4242&data[paymentSum]=125.5&data[statusCode]=2&data[customFields][cField1]=0F8FAD5B-D9CB-469F-A165-70867728950E'
    const u = readUpdate(flattenUpdate(body, 'application/x-www-form-urlencoded'))
    expect(u).toMatchObject({ paid: true, paidMinor: 12550, transactionId: '9001', asmachta: '123456', cardSuffix: '4242', processId: '77', chargeId: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  })
  it('reads the flat JSON the account webhook sends', () => {
    const u = readUpdate(flattenUpdate(JSON.stringify({ transactionCode: 'T1', paymentSum: '10', payerEmail: 'a@b.c' }), 'text/plain'))
    expect(u).toMatchObject({ paid: true, transactionId: 'T1', paidMinor: 1000, chargeId: null })
  })
  it('is not a payment without a transaction, an amount, or with a failing status', () => {
    expect(readUpdate({ paymentSum: '10' }).paid).toBe(false)
    expect(readUpdate({ transactionId: '1', paymentSum: '0' }).paid).toBe(false)
    expect(readUpdate({ transactionId: '1', paymentSum: '10', statusCode: '3' }).paid).toBe(false)
    expect(readUpdate({ transactionId: '1', paymentSum: '10', status: '0' }).paid).toBe(false)
  })
  it('approves with our credentials plus what the update carried, never a forwarded key', () => {
    const u = readUpdate({ transactionId: '9001', transactionToken: 'tt', paymentSum: '10', processId: '77', userId: 'evil', token: 'leak' })
    const f = Object.fromEntries(approveForm(on(), u))
    expect(f).toMatchObject({ userId: 'u1', pageCode: 'pc', transactionId: '9001', transactionToken: 'tt', processId: '77', paymentSum: '10' })
    expect(f.token).toBeUndefined()
  })
})
