import { describe, expect, it } from 'vitest'
import { productForProject, summariseDeployments, type DeploymentRow } from '@/lib/integrations/vercel/summarise'
import { deriveAlerts } from '@/lib/alerts'

const row = (project: string, createdAt: string, state: string, commit: string | null = null): DeploymentRow => ({ id: `${project}-${createdAt}`, project, url: null, inspectorUrl: null, createdAt, state, commit, branch: 'main' })
const now = new Date('2026-10-23T08:00:00Z')

describe('production deployments', () => {
  it('separates what is live from the newest attempt', () => {
    const [w] = summariseDeployments([row('just-a-second-website', '2026-10-23T07:00:00Z', 'ERROR', 'Break it'), row('just-a-second-website', '2026-10-22T07:00:00Z', 'READY', 'Good'), row('just-a-second-website', '2026-10-23T06:00:00Z', 'ERROR')], now)
    expect(w).toMatchObject({ latestFailed: true, failedLast24h: 2, latest: { commit: 'Break it' }, live: { commit: 'Good' } })
  })

  it('a building deploy is not a failure, and failed projects sort first', () => {
    const out = summariseDeployments([row('jas-command-center', '2026-10-23T07:30:00Z', 'BUILDING'), row('gift-card-system', '2026-10-22T07:00:00Z', 'ERROR')], now)
    expect(out.map((d) => [d.project, d.latestFailed, d.live])).toEqual([['gift-card-system', true, null], ['jas-command-center', false, null]])
  })

  it('maps Vercel project names to products, and the console itself to none', () => {
    expect(['just-a-second-website', 'gift-card-system', 'furniture-collect', 'whatssup-bot', 'interactive-map', 'jas-command-center'].map(productForProject)).toEqual(['website', 'gift_cards', 'furniture', 'design_agent', 'map', null])
  })

  it('alerts on a failed latest deploy of a product, never on the console or a recovered one', () => {
    const data = summariseDeployments([row('gift-card-system', '2026-10-23T07:00:00Z', 'ERROR', 'x'), row('gift-card-system', '2026-10-22T07:00:00Z', 'READY'), row('jas-command-center', '2026-10-23T07:00:00Z', 'ERROR'), row('just-a-second-website', '2026-10-23T07:00:00Z', 'READY'), row('just-a-second-website', '2026-10-23T06:00:00Z', 'ERROR')], now)
    const alerts = deriveAlerts({ health: [], deployments: { state: 'ok', data, checkedAt: now.toISOString(), latencyMs: 1, source: 'v' } })
    expect(alerts.map((a) => [a.id, a.product, a.severity])).toEqual([['deploy:gift-card-system', 'gift_cards', 'warning']])
    expect(alerts[0]!.detail).toContain('still serves')
  })
})
