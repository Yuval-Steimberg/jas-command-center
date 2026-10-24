import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeVolunteers } from '@/lib/selfcheck/volunteers'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('production check: volunteers', () => {
  it('reads the tables and reports the app as not configured without VOLUNTEER_APP_URL', async () => {
    vi.stubEnv('VOLUNTEER_APP_URL', '')
    const [tables, app] = await probeVolunteers()
    expect(tables).toMatchObject({ section: 'volunteers', state: 'ok' })
    expect(app).toMatchObject({ state: 'not_configured' })
  })

  it("passes only when the app's own health says ok, and fails on anything else", async () => {
    vi.stubEnv('VOLUNTEER_APP_URL', 'https://vol.example')
    const reply = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
    reply({ ok: true, database: 'ok', missing: [], email: 'sendgrid', commit: 'abc1234' })
    expect((await probeVolunteers())[1]).toMatchObject({ state: 'ok', detail: 'database ok, email sendgrid, commit abc1234' })
    reply({ ok: false, database: 'error', error: 'migration 0005_volunteers not applied', missing: ['CRON_SECRET'], email: 'sendgrid', commit: null })
    expect((await probeVolunteers())[1]).toMatchObject({ state: 'error', detail: expect.stringContaining('migration 0005_volunteers not applied') })
    reply({ message: 'not found' }, 404)
    expect((await probeVolunteers())[1]).toMatchObject({ state: 'error', detail: expect.stringContaining('HTTP 404') })
  })
})
