import { afterEach, describe, expect, it } from 'vitest'
import { diagnoseSetupError, SetupError } from '@/lib/auth/setup-error'
import { env } from '@/lib/env'

describe('a broken command center database explains itself', () => {
  it('missing tables → run the migration', () => {
    const e = diagnoseSetupError({ code: 'PGRST205', message: "Could not find the table 'public.cc_role_permissions' in the schema cache" })
    expect(e).toBeInstanceOf(SetupError)
    expect(e.message).toMatch(/0001_init\.sql/)
    expect(diagnoseSetupError({ code: '42P01', message: 'relation "cc_profiles" does not exist' }).message).toMatch(/0001_init\.sql/)
  })
  it('rejected key → check the service role key, without echoing it', () => {
    const e = diagnoseSetupError({ message: 'Invalid API key' })
    expect(e.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })
  it('unreachable project → check the URL', () => {
    expect(diagnoseSetupError({ message: 'TypeError: fetch failed' }).message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})

describe('env tolerates values pasted with quotes', () => {
  afterEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
  })
  it('strips one pair of surrounding quotes and whitespace', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ' "sb_secret_abc" '
    process.env.NEXT_PUBLIC_SUPABASE_URL = "'https://abc.supabase.co/'"
    expect(env().cc.supabaseServiceKey).toBe('sb_secret_abc')
    expect(env().cc.supabaseUrl).toBe('https://abc.supabase.co')
  })
})
