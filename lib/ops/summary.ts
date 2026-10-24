import type { Contact, Deal, Delivery, Item, ItemStatus, Task } from './types'
import { ITEM_STATUSES } from './types'
import { AVAILABLE, reservationExpired } from '@/lib/inventory/model'
import { OPEN_STAGES, daysWithoutContact } from '@/lib/crm/model'
import { OPEN_PO, isOverdue, type PurchaseOrder } from '@/lib/suppliers/model'

/** The current-state figures of the operational modules. Pure: tests build it from rows. */
export interface OpsSnapshot {
  items: {
    byStatus: Record<ItemStatus, number>
    available: number
    /** In storage, not listed on the website. */
    unlisted: number
    /** In storage 60+ days without a listing. */
    agingUnlisted: number
    /** Sum of asking prices of available items that have one (agorot); `priced` says how many had one. */
    askingValueMinor: number
    priced: number
    reservedExpiringSoon: number
    /** Sold here or online and not delivered yet. */
    awaitingDelivery: number
  }
  crm: { contacts: number; customers: number; openLeads: number; leadsByStage: Record<string, number>; staleLeads: number }
  tasks: { open: number; overdue: number; doubleSale: number }
  deliveries: { scheduled: number; out: number }
  /** Purchase orders (migration 0004); null until that migration is run. */
  purchasing: { open: number; late: number; drafts: number } | null
  rules: Record<string, boolean>
}

export const STALE_LEAD_DAYS = 3
export const AGING_DAYS = 60

export function summarise(i: { items: Item[]; deals: Deal[]; tasks: Task[]; deliveries: Delivery[]; contacts: Contact[]; rules: Map<string, boolean>; orders?: PurchaseOrder[] | null }, now = Date.now()): OpsSnapshot {
  const byStatus = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>
  let askingValueMinor = 0
  let priced = 0
  let agingUnlisted = 0
  let reservedExpiringSoon = 0
  for (const it of i.items) {
    byStatus[it.status]++
    if (AVAILABLE.includes(it.status) && it.priceMinor) {
      askingValueMinor += it.priceMinor
      priced++
    }
    if (it.status === 'in_storage' && now - Date.parse(it.createdAt) >= AGING_DAYS * 86_400_000) agingUnlisted++
    if (it.status === 'reserved' && it.reservedUntil && !reservationExpired(it, now) && Date.parse(it.reservedUntil) - now < 86_400_000) reservedExpiringSoon++
  }
  const open = i.deals.filter((d) => OPEN_STAGES.includes(d.stage))
  const leadsByStage: Record<string, number> = {}
  for (const d of open) leadsByStage[d.stage] = (leadsByStage[d.stage] ?? 0) + 1
  return {
    items: {
      byStatus,
      available: byStatus.in_storage + byStatus.listed,
      unlisted: byStatus.in_storage,
      agingUnlisted,
      askingValueMinor,
      priced,
      reservedExpiringSoon,
      awaitingDelivery: byStatus.sold,
    },
    crm: {
      contacts: i.contacts.length,
      customers: i.contacts.filter((c) => c.roles.includes('customer')).length,
      openLeads: open.length,
      leadsByStage,
      staleLeads: open.filter((d) => d.stage === 'new' && daysWithoutContact(d, now) >= STALE_LEAD_DAYS).length,
    },
    tasks: {
      open: i.tasks.filter((t) => t.status === 'open').length,
      overdue: i.tasks.filter((t) => t.status === 'open' && t.dueAt && Date.parse(t.dueAt) < now).length,
      doubleSale: i.tasks.filter((t) => t.status === 'open' && t.source === 'automation:double_sale').length,
    },
    deliveries: { scheduled: i.deliveries.filter((d) => d.status === 'planned').length, out: i.deliveries.filter((d) => d.status === 'out').length },
    purchasing: i.orders
      ? { open: i.orders.filter((o) => OPEN_PO.includes(o.status)).length, late: i.orders.filter((o) => isOverdue(o, now)).length, drafts: i.orders.filter((o) => o.status === 'draft').length }
      : null,
    rules: Object.fromEntries(i.rules),
  }
}
