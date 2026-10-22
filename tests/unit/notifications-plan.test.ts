import { describe, expect, it } from 'vitest'
import { family, planSync } from '@/lib/notifications/plan'
import type { Alert } from '@/lib/alerts'

const alert = (id: string, product: Alert['product'] = 'gift_cards'): Alert => ({ id, product, severity: 'critical', title: id, detail: '', href: '/' })

describe('remembering alerts', () => {
  it('raises new alerts, touches open ones, resolves ones that are gone', () => {
    const plan = planSync([{ id: 'n1', alertKey: 'gift:undelivered' }, { id: 'n2', alertKey: 'agent:dead' }], [alert('gift:undelivered'), alert('gift:unmatched')], () => true)
    expect(plan.raise.map((a) => a.id)).toEqual(['gift:unmatched'])
    expect(plan.touch).toEqual([{ id: 'n1', alert: alert('gift:undelivered') }])
    expect(plan.resolve).toEqual(['n2'])
  })

  it('does NOT resolve an alert whose source could not be read this time', () => {
    const observed = (k: string) => family(k) === 'health'
    const plan = planSync([{ id: 'n1', alertKey: 'gift:undelivered' }, { id: 'n2', alertKey: 'health:furniture' }], [], observed)
    expect(plan.resolve).toEqual(['n2'])
  })
})
