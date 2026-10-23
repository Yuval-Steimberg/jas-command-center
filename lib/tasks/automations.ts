import 'server-only'
import { getOpsStore } from '@/lib/ops'
import type { Item } from '@/lib/ops/types'
import { AUTOMATION_RULES, type RuleId } from './rules'

export { AUTOMATION_RULES }

/** Is the rule on? Every rule is on until someone switches it off on /tasks. */
export async function ruleEnabled(id: RuleId): Promise<boolean> {
  return (await getOpsStore().ruleSettings()).get(id) ?? true
}

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

type Ctx = { item: Item; orderNumber?: string | null }

/**
 * Run one task-creating rule for an event. Idempotent: each task carries a
 * dedupe key, so a replayed event (a sync that sees the same order twice)
 * never opens a second task.
 */
export async function runRule(id: Extract<RuleId, 'intake_needs_price' | 'sale_needs_delivery'>, ctx: Ctx, actorEmail: string): Promise<void> {
  if (!(await ruleEnabled(id))) return
  const store = getOpsStore()
  const { item } = ctx
  if (id === 'intake_needs_price') {
    const missing = [!item.priceMinor && 'an asking price', !item.photoUrl && 'a photo'].filter(Boolean)
    if (!missing.length) return
    await store.createTask({ title: `Prepare ${item.sku} for sale: add ${missing.join(' and ')}`, detail: item.title, dueAt: days(3), entityKind: 'item', entityId: item.id, source: `automation:${id}`, dedupeKey: `${id}:${item.id}`, createdBy: actorEmail })
  }
  if (id === 'sale_needs_delivery') {
    const how = item.soldChannel === 'website' ? `website order ${ctx.orderNumber ?? item.websiteOrderNumber ?? ''}`.trim() : 'shop sale'
    await store.createTask({ title: `Arrange delivery or pickup of ${item.sku} (${how})`, detail: item.title, dueAt: days(2), entityKind: 'item', entityId: item.id, source: `automation:${id}`, dedupeKey: `${id}:${item.id}:${item.soldAt ?? ''}`, createdBy: actorEmail })
  }
}
