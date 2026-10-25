import { describe, expect, it } from 'vitest'
import { appUrl } from '@/lib/env'

describe('CC_APP_URL (invitation links)', () => {
  it('defaults to production', () => expect(appUrl(undefined, true)).toBe('https://jas-command-center.vercel.app'))
  it('ignores a localhost value in a production build', () => {
    expect(appUrl('http://localhost:3000', true)).toBe('https://jas-command-center.vercel.app')
    expect(appUrl('http://127.0.0.1:3000', true)).toBe('https://jas-command-center.vercel.app')
  })
  it('keeps localhost in development and any real host everywhere', () => {
    expect(appUrl('http://localhost:3000', false)).toBe('http://localhost:3000')
    expect(appUrl('https://cc.justasecond.co.il', true)).toBe('https://cc.justasecond.co.il')
  })
})
