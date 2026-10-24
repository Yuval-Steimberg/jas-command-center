import type { Contact, Deal, Item, Movement } from '@/lib/ops/types'
import { AVAILABLE } from '@/lib/inventory/model'
import { OPEN_STAGES } from '@/lib/crm/model'
import { AGING_DAYS, STALE_LEAD_DAYS } from '@/lib/ops/summary'
import { israelDate, type DateRange } from '@/lib/time'
import type { Basis, Metric, Quality, Section, SourceInfo, Unit } from './model'

/**
 * Analytics for the command center's own records (migration 0003). Pure, like
 * the other sections. In-store sales are the only money here, and they are
 * shown apart from website revenue: an inventory item sold online is counted
 * (how many), never valued, because its money is already in the website's
 * revenue.
 */
export interface OpsAnalyticsInput {
  items: Item[]
  /** Movements since the start of the previous period. */
  movements: Movement[]
  deals: Deal[]
  contacts: Contact[]
  /** True when a read hit its row cap, so period counts may be low. */
  truncated: boolean
}

export type OpsRead = { state: 'ok'; data: OpsAnalyticsInput; checkedAt: string } | { state: 'not_configured' | 'error'; detail: string }

const MAX_ITEMS_SHOWN = 15

function source(r: OpsRead): SourceInfo {
  return r.state === 'ok'
    ? { key: 'ops', label: 'Command center records', state: 'ok', detail: 'cc_inventory_items, cc_inventory_movements, cc_contacts, cc_deals', checkedAt: r.checkedAt, latencyMs: null }
    : { key: 'ops', label: 'Command center records', state: r.state, detail: r.detail, checkedAt: null, latencyMs: null }
}

const inRange = (iso: string | null, d: DateRange) => {
  if (!iso) return false
  const day = israelDate(new Date(iso))
  return day >= d.from && day <= d.to
}

export function inventorySection(r: OpsRead, range: DateRange, previous: DateRange, now = Date.now()): Section {
  const sec: Section = { product: 'inventory', title: 'Inventory', sources: [source(r)], metrics: [], series: [], tables: [], notes: [] }
  const d = r.state === 'ok' ? r.data : null
  const q: Quality = !d ? 'unavailable' : d.truncated ? 'partial' : 'ok'
  const m = (id: string, label: string, unit: Unit, basis: Basis, value: number | null, prev: number | null = null, extra: Partial<Metric> = {}): Metric => ({ id, label, unit, basis, value, previous: basis === 'now' ? null : prev, quality: basis === 'now' && d ? 'ok' : q, source: 'ops', ...extra })
  const moves = (p: DateRange, test: (x: Movement) => boolean) => (d ? d.movements.filter((x) => inRange(x.at, p) && test(x)) : null)
  const count = (p: DateRange, test: (x: Movement) => boolean) => moves(p, test)?.length ?? null
  const inStore = (x: Movement) => x.type === 'sell' && x.detail.channel === 'in_store'
  const online = (x: Movement) => x.type === 'sell' && x.detail.channel === 'website'
  const value = (p: DateRange) => moves(p, inStore)?.reduce((a, x) => a + (Number(x.detail.priceMinor) || 0), 0) ?? null
  // Days from intake to sale, for items whose sale fell in the period and is still on the item (a return clears it).
  const daysToSell = (p: DateRange) => {
    if (!d) return null
    const ds = d.items.filter((i) => i.soldAt && inRange(i.soldAt, p)).map((i) => (Date.parse(i.soldAt!) - Date.parse(i.createdAt)) / 86_400_000)
    return ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null
  }
  const available = d?.items.filter((i) => AVAILABLE.includes(i.status)) ?? null
  const byId = new Map((d?.items ?? []).map((i) => [i.id, i]))
  const units = (x: Movement) => Math.max(1, Number(x.detail.units) || 1)
  const shopReturn = (x: Movement) => x.type === 'return' && x.detail.channel === 'in_store' && Number(x.detail.priceMinor) > 0
  const returned = (p: DateRange) => moves(p, shopReturn)?.reduce((a, x) => a + (Number(x.detail.priceMinor) || 0), 0) ?? null
  const net = (p: DateRange) => { const v = value(p), r = returned(p); return v == null || r == null ? null : v - r }
  const avgPrice = (p: DateRange) => {
    const xs = moves(p, inStore)
    if (!xs?.length) return null
    return Math.round(xs.reduce((a, x) => a + (Number(x.detail.priceMinor) || 0), 0) / xs.reduce((a, x) => a + units(x), 0))
  }
  // Margin only where the item records what it cost; the rest are left out and counted in the note.
  const margin = (p: DateRange) => {
    const xs = moves(p, inStore)
    if (!xs) return { value: null, known: 0, all: 0 }
    const known = xs.filter((x) => byId.get(x.itemId)?.unitCostMinor != null)
    return { value: known.length ? known.reduce((a, x) => a + (Number(x.detail.priceMinor) || 0) - units(x) * byId.get(x.itemId)!.unitCostMinor!, 0) : null, known: known.length, all: xs.length }
  }
  const mNow = margin(range)
  sec.metrics.push(
    m('inv.intake', 'Items taken in', 'count', 'period', count(range, (x) => x.type === 'intake'), count(previous, (x) => x.type === 'intake')),
    m('inv.inStoreSales', 'Sold in the shop', 'count', 'period', count(range, inStore), count(previous, inStore)),
    m('inv.inStoreValue', 'In-store sales value', 'agorot', 'period', value(range), value(previous), { note: 'Recorded here. Not website revenue; never added to it.' }),
    m('inv.inStoreReturns', 'Returned to the shop', 'agorot', 'period', returned(range), returned(previous), { lowerIsBetter: true, note: 'Value of shop-sale units customers brought back.' }),
    m('inv.inStoreNet', 'In-store sales after returns', 'agorot', 'period', net(range), net(previous)),
    m('inv.avgSalePrice', 'Average in-store price per unit', 'agorot', 'period', avgPrice(range), avgPrice(previous)),
    m('inv.margin', 'In-store margin (items with a cost)', 'agorot', 'period', mNow.value, margin(previous).value, { note: mNow.all ? `${mNow.known} of ${mNow.all} sales have a recorded cost; the rest are left out.` : 'Price minus recorded cost.' }),
    m('inv.soldOnline', 'Inventory items sold online', 'count', 'period', count(range, online), count(previous, online), { note: 'Their money is in the website revenue.' }),
    m('inv.diverted', 'Donated or recycled', 'count', 'period', count(range, (x) => x.type === 'donate' || x.type === 'recycle'), count(previous, (x) => x.type === 'donate' || x.type === 'recycle')),
    m('inv.daysToSell', 'Days from intake to sale', 'count', 'period', daysToSell(range), daysToSell(previous), { lowerIsBetter: true }),
    m('inv.available', 'Available now', 'count', 'now', available?.length ?? null),
    m('inv.unlisted', 'In storage, not listed', 'count', 'now', d ? d.items.filter((i) => i.status === 'in_storage').length : null),
    m('inv.aging', `Unlisted ${AGING_DAYS}+ days`, 'count', 'now', d ? d.items.filter((i) => i.status === 'in_storage' && now - Date.parse(i.createdAt) >= AGING_DAYS * 86_400_000).length : null, null, { lowerIsBetter: true }),
    m('inv.awaitingDelivery', 'Sold, not delivered', 'count', 'now', d ? d.items.filter((i) => i.status === 'sold').length : null, null, { lowerIsBetter: true }),
  )
  if (d) {
    const cats = new Map<string, { available: number; sold: number }>()
    for (const i of d.items) {
      const k = i.category?.trim() || 'Uncategorised'
      const c = cats.get(k) ?? { available: 0, sold: 0 }
      if (AVAILABLE.includes(i.status)) c.available++
      if (i.soldAt && inRange(i.soldAt, range)) c.sold++
      cats.set(k, c)
    }
    sec.tables.push({
      id: 'inv.categories',
      title: 'By category',
      columns: [{ key: 'category', label: 'Category' }, { key: 'available', label: 'Available now', unit: 'count' }, { key: 'sold', label: 'Sold in period', unit: 'count' }],
      rows: [...cats].sort((a, b) => b[1].available + b[1].sold - (a[1].available + a[1].sold)).slice(0, MAX_ITEMS_SHOWN).map(([category, c]) => ({ category, ...c })),
    })
    const sales = new Map<string, { units: number; value: number; margin: number | null }>()
    for (const x of moves(range, inStore) ?? []) {
      const it = byId.get(x.itemId)
      const k = it?.category?.trim() || 'Uncategorised'
      const c = sales.get(k) ?? { units: 0, value: 0, margin: null }
      c.units += units(x)
      c.value += Number(x.detail.priceMinor) || 0
      if (it?.unitCostMinor != null) c.margin = (c.margin ?? 0) + (Number(x.detail.priceMinor) || 0) - units(x) * it.unitCostMinor
      sales.set(k, c)
    }
    sec.tables.push({
      id: 'inv.inStoreByCategory',
      title: 'In-store sales by category (period)',
      columns: [{ key: 'category', label: 'Category' }, { key: 'units', label: 'Units', unit: 'count' }, { key: 'value', label: 'Value', unit: 'agorot' }, { key: 'avg', label: 'Avg per unit', unit: 'agorot' }, { key: 'margin', label: 'Margin (with cost)', unit: 'agorot' }],
      rows: [...sales].sort((a, b) => b[1].value - a[1].value).slice(0, MAX_ITEMS_SHOWN).map(([category, c]) => ({ category, units: c.units, value: c.value, avg: Math.round(c.value / c.units), margin: c.margin })),
    })
    const colours = new Map<string, { available: number; sold: number }>()
    for (const i of d.items) {
      const first = i.colors?.split(',')[0]?.trim()
      if (!first) continue
      const c = colours.get(first) ?? { available: 0, sold: 0 }
      if (AVAILABLE.includes(i.status)) c.available++
      if (i.soldAt && inRange(i.soldAt, range)) c.sold++
      colours.set(first, c)
    }
    if (colours.size) sec.tables.push({
      id: 'inv.colours',
      title: 'By main colour',
      columns: [{ key: 'colour', label: 'Colour' }, { key: 'available', label: 'Available now', unit: 'count' }, { key: 'sold', label: 'Sold in period', unit: 'count' }],
      rows: [...colours].sort((a, b) => b[1].available + b[1].sold - (a[1].available + a[1].sold)).slice(0, MAX_ITEMS_SHOWN).map(([colour, c]) => ({ colour, ...c })),
    })
    if (d.truncated) sec.notes.push('More records than one read returns: period counts are a lower bound.')
  }
  sec.notes.push('Days, counts and values come from the inventory movement log, which is append-only. Furniture collection progress is in its own section.')
  return sec
}

export function crmSection(r: OpsRead, range: DateRange, previous: DateRange, now = Date.now()): Section {
  const sec: Section = { product: 'crm', title: 'Customers & leads', sources: [source(r)], metrics: [], series: [], tables: [], notes: [] }
  const d = r.state === 'ok' ? r.data : null
  const q: Quality = !d ? 'unavailable' : d.truncated ? 'partial' : 'ok'
  const m = (id: string, label: string, basis: Basis, value: number | null, prev: number | null = null, extra: Partial<Metric> = {}): Metric => ({ id, label, unit: 'count', basis, value, previous: basis === 'now' ? null : prev, quality: basis === 'now' && d ? 'ok' : q, source: 'ops', ...extra })
  const n = <T>(xs: T[] | undefined, test: (x: T) => boolean) => (xs ? xs.filter(test).length : null)
  const won = (p: DateRange) => n(d?.deals, (x) => x.stage === 'won' && inRange(x.closedAt, p))
  sec.metrics.push(
    m('crm.newContacts', 'New contacts', 'period', n(d?.contacts, (c) => inRange(c.createdAt, range)), n(d?.contacts, (c) => inRange(c.createdAt, previous))),
    m('crm.newLeads', 'New leads', 'period', n(d?.deals, (x) => inRange(x.createdAt, range)), n(d?.deals, (x) => inRange(x.createdAt, previous))),
    m('crm.won', 'Leads won', 'period', won(range), won(previous)),
    m('crm.openLeads', 'Open leads', 'now', n(d?.deals, (x) => OPEN_STAGES.includes(x.stage))),
    m('crm.staleLeads', `New leads waiting ${STALE_LEAD_DAYS}+ days`, 'now', n(d?.deals, (x) => x.stage === 'new' && now - Date.parse(x.lastContactedAt ?? x.createdAt) >= STALE_LEAD_DAYS * 86_400_000), null, { lowerIsBetter: true }),
    m('crm.customers', 'Customers', 'now', n(d?.contacts, (c) => c.roles.includes('customer'))),
  )
  if (d) {
    const bySource = new Map<string, number>()
    for (const x of d.deals) if (inRange(x.createdAt, range)) bySource.set(x.source, (bySource.get(x.source) ?? 0) + 1)
    sec.tables.push({
      id: 'crm.leadSources',
      title: 'Where leads came from (period)',
      columns: [{ key: 'source', label: 'Source' }, { key: 'leads', label: 'Leads', unit: 'count' }],
      rows: [...bySource].sort((a, b) => b[1] - a[1]).map(([s, leads]) => ({ source: s.replace('_', ' '), leads })),
    })
  }
  sec.notes.push('WhatsApp conversations are counted only when someone logs them on a contact: the WhatsApp number connected here is the owner’s design agent, not a customer inbox.')
  return sec
}
