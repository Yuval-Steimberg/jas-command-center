import { describe, expect, it } from 'vitest'
import { buildActivity } from '@/lib/activity/build'
import type { AuditEntry } from '@/lib/audit/audit'

const audit = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 'a1', at: '2026-10-22T10:00:00Z', actorId: 'p1', actorEmail: 'owner@x', actorRole: 'owner', via: 'user', action: 'design_agent.job.retry', product: 'design_agent', target: 'job:7', outcome: 'succeeded', detail: {}, ...over,
})

describe('activity feed', () => {
  it('merges every source newest first, with opened and resolved alerts as two events', () => {
    const items = buildActivity({
      notifications: [{ id: 'n1', alertKey: 'agent:dead', product: 'design_agent', severity: 'warning', title: '7 jobs failed', detail: '', firstSeenAt: '2026-10-22T08:00:00Z', lastSeenAt: '2026-10-22T09:00:00Z', resolvedAt: '2026-10-22T11:00:00Z' }],
      audit: [audit({})],
      furniture: [{ id: 'p1', name: 'בניין א', city: 'חולון', developer_name: null, start_date: null, archived: false, created_at: '2026-10-21T00:00:00Z', apartments: 0, apartmentsCompleted: 0, items: 0, itemsToCollect: 0, itemsCollected: 0 }],
      agent: { jobs: [], dead: [{ id: 3, type: 'os_automation_run', attempts: 5, err: 'channel not configured for WhatsApp', updated_at: Date.parse('2026-10-22T07:00:00Z') }], projects: [], outbound_failed: [] },
    })
    expect(items.map((i) => i.title)).toEqual([
      'Resolved: 7 jobs failed',
      'owner@x · design_agent.job.retry',
      'Alert raised: 7 jobs failed',
      'Job failed permanently: os_automation_run',
      'Furniture project added: בניין א',
    ])
  })

  it('leaves out assistant lookups and the "requested" half of an action', () => {
    const items = buildActivity({ audit: [audit({ id: 'x', action: 'assistant.tool' }), audit({ id: 'y', outcome: 'requested' }), audit({ id: 'z', outcome: 'failed' })] })
    expect(items.map((i) => i.id)).toEqual(['a:z'])
    expect(items[0]!.tone).toBe('bad')
  })

  it('is empty when nothing was read, never filled in', () => {
    expect(buildActivity({})).toEqual([])
  })
})
