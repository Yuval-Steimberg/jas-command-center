import { ConflictError, type OpsStore } from './store'
import type { Contact, Deal, Delivery, Interaction, Item, Location, Movement, Task } from './types'

/**
 * In-memory OpsStore for local development and tests. Same rules as the SQL
 * functions in 0003: every check-then-write runs without an await in between,
 * so two concurrent callers are serialised exactly like a row lock would.
 */
export interface MemoryData {
  locations: Location[]
  items: Item[]
  movements: Movement[]
  contacts: Contact[]
  deals: Deal[]
  interactions: Interaction[]
  tasks: Task[]
  deliveries: Delivery[]
  rules: Map<string, boolean>
  cursors: Map<string, { cursor: string | null; lastSuccessAt: string | null; lastError: string | null }>
  sku: number
}

export const emptyData = (): MemoryData => ({ locations: [], items: [], movements: [], contacts: [], deals: [], interactions: [], tasks: [], deliveries: [], rules: new Map(), cursors: new Map(), sku: 0 })

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const copy = <T>(x: T): T => structuredClone(x)
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
const hit = (q: string | undefined, ...fields: (string | null | undefined)[]) => !q || words(q).every((w) => fields.some((f) => f?.toLowerCase().includes(w)))

export function memoryStore(d: MemoryData = emptyData()): OpsStore {
  return {
    kind: 'memory',

    async listLocations() {
      return copy(d.locations).sort((a, b) => a.name.localeCompare(b.name))
    },
    async saveLocation(input, locId) {
      if (locId) {
        const l = d.locations.find((x) => x.id === locId)
        if (!l) throw new ConflictError('Location not found')
        Object.assign(l, input)
        return copy(l)
      }
      const l: Location = { id: id(), name: input.name, kind: input.kind, parentId: input.parentId ?? null, address: input.address ?? null, notes: input.notes ?? null, active: input.active ?? true, createdAt: now() }
      d.locations.push(l)
      return copy(l)
    },

    async listItems(f = {}) {
      return copy(
        d.items
          .filter(
            (i) =>
              (!f.statuses || f.statuses.includes(i.status)) &&
              (!f.locationId || i.locationId === f.locationId) &&
              (!f.ids || f.ids.includes(i.id)) &&
              (!f.websiteProductIds || (i.websiteProductId != null && f.websiteProductIds.includes(i.websiteProductId))) &&
              (!f.furnitureItemIds || (i.furnitureItemId != null && f.furnitureItemIds.includes(i.furnitureItemId))) &&
              (!f.buyerContactId || i.buyerContactId === f.buyerContactId) &&
              (!f.reservedFor || i.reservedFor === f.reservedFor) &&
              (!f.createdSince || i.createdAt >= f.createdSince) &&
              hit(f.q, i.sku, i.title, i.description, i.category, i.furnitureProjectName),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, f.limit ?? 500),
      )
    },
    async getItem(itemId) {
      return copy(d.items.find((i) => i.id === itemId) ?? null)
    },
    async getItemBySku(sku) {
      return copy(d.items.find((i) => i.sku === sku.trim().toUpperCase()) ?? null)
    },
    async createItem(input, mv) {
      if (input.furnitureItemId) {
        const ex = d.items.find((i) => i.furnitureItemId === input.furnitureItemId)
        if (ex) throw new ConflictError(`already taken into inventory as ${ex.sku}`)
      }
      if (input.websiteProductId != null && d.items.some((i) => i.websiteProductId === input.websiteProductId)) throw new ConflictError('that website product is already linked to another item')
      const t = now()
      const item: Item = {
        id: id(), sku: `JAS-${String(++d.sku).padStart(6, '0')}`, description: null, category: null, kind: 'unique', quantity: 1, condition: null,
        status: 'in_storage', locationId: null, priceMinor: null, photoUrl: null, dimensions: null, material: null, weightKg: null, source: 'manual',
        furnitureItemId: null, furnitureProjectId: null, furnitureProjectName: null, furnitureApartment: null, websiteProductId: null,
        reservedFor: null, reservedUntil: null, reservedPrevStatus: null, reservedWebsiteQty: null, soldChannel: null, soldAt: null, soldPriceMinor: null,
        buyerContactId: null, websiteOrderId: null, websiteOrderNumber: null, dispositionNote: null, createdBy: 'system',
        ...input, version: 1, createdAt: t, updatedAt: t,
      } as Item
      d.items.push(item)
      d.movements.push({ id: id(), itemId: item.id, at: t, type: 'intake', fromStatus: null, toStatus: item.status, fromLocation: null, toLocation: item.locationId, quantityDelta: item.quantity, refKind: mv.refKind ?? null, refId: mv.refId ?? null, note: mv.note ?? null, actorEmail: mv.actorEmail, detail: mv.detail ?? {} })
      return copy(item)
    },
    async applyItem(itemId, expect, set, mv) {
      const item = d.items.find((i) => i.id === itemId)
      if (!item) throw new ConflictError('item not found')
      if (mv.refId != null && d.movements.some((m) => m.itemId === itemId && m.type === mv.type && m.refKind === (mv.refKind ?? null) && m.refId === mv.refId)) return copy(item)
      if (expect.version != null && item.version !== expect.version) throw new ConflictError('the item changed since it was loaded')
      if (expect.from && !expect.from.includes(item.status)) throw new ConflictError(`the item is ${item.status.replace('_', ' ')}`)
      if (set.websiteProductId != null && d.items.some((i) => i.id !== itemId && i.websiteProductId === set.websiteProductId)) throw new ConflictError('that website product is already linked to another item')
      const before = { ...item }
      const safe = { ...set } as Record<string, unknown>
      for (const k of ['id', 'sku', 'version', 'createdAt', 'createdBy', 'source', 'furnitureItemId']) delete safe[k]
      Object.assign(item, safe, { version: item.version + 1, updatedAt: now() })
      d.movements.push({
        id: id(), itemId, at: item.updatedAt, type: mv.type, fromStatus: before.status, toStatus: item.status, fromLocation: before.locationId, toLocation: item.locationId,
        quantityDelta: mv.quantityDelta ?? item.quantity - before.quantity, refKind: mv.refKind ?? null, refId: mv.refId ?? null, note: mv.note ?? null, actorEmail: mv.actorEmail, detail: mv.detail ?? {},
      })
      return copy(item)
    },
    async movements(itemId) {
      return copy(d.movements.filter((m) => m.itemId === itemId).sort((a, b) => b.at.localeCompare(a.at)))
    },
    async recentMovements(limit, since) {
      return copy(d.movements.filter((m) => !since || m.at >= since).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit))
    },

    async listContacts(f = {}) {
      return copy(
        d.contacts
          .filter((c) => (!f.role || c.roles.includes(f.role)) && (!f.ids || f.ids.includes(c.id)) && hit(f.q, c.fullName, c.email, c.phone))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, f.limit ?? 500),
      )
    },
    async getContact(cid) {
      return copy(d.contacts.find((c) => c.id === cid) ?? null)
    },
    async findContact(email, phone) {
      return copy((email && d.contacts.find((c) => c.email === email)) || (phone && d.contacts.find((c) => c.phone === phone)) || null)
    },
    async createContact(input) {
      if (input.email && d.contacts.some((c) => c.email === input.email)) throw new ConflictError('A contact with that email already exists')
      if (input.phone && d.contacts.some((c) => c.phone === input.phone)) throw new ConflictError('A contact with that phone already exists')
      const t = now()
      const c: Contact = { id: id(), kind: 'person', email: null, phone: null, companyId: null, roles: [], source: 'manual', notes: null, ownerProfileId: null, ...input, createdAt: t, updatedAt: t }
      d.contacts.push(c)
      return copy(c)
    },
    async updateContact(cid, patch) {
      const c = d.contacts.find((x) => x.id === cid)
      if (!c) throw new ConflictError('Contact not found')
      if (patch.email && d.contacts.some((x) => x.id !== cid && x.email === patch.email)) throw new ConflictError('Another contact already has that email')
      if (patch.phone && d.contacts.some((x) => x.id !== cid && x.phone === patch.phone)) throw new ConflictError('Another contact already has that phone')
      Object.assign(c, patch, { updatedAt: now() })
      return copy(c)
    },

    async listDeals(f = {}) {
      return copy(d.deals.filter((x) => (!f.stages || f.stages.includes(x.stage)) && (!f.contactId || x.contactId === f.contactId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, f.limit ?? 500))
    },
    async getDeal(did) {
      return copy(d.deals.find((x) => x.id === did) ?? null)
    },
    async createDeal(input) {
      const ex = input.sourceRef ? d.deals.find((x) => x.sourceRef === input.sourceRef) : undefined
      if (ex) return { deal: copy(ex), created: false }
      const t = now()
      const deal: Deal = { id: id(), stage: 'new', valueMinor: null, itemId: null, source: 'manual', sourceRef: null, nextStep: null, nextStepAt: null, ownerProfileId: null, lastContactedAt: null, closedAt: null, ...input, createdAt: t, updatedAt: t }
      d.deals.push(deal)
      return { deal: copy(deal), created: true }
    },
    async updateDeal(did, patch) {
      const x = d.deals.find((y) => y.id === did)
      if (!x) throw new ConflictError('Lead not found')
      Object.assign(x, patch, { updatedAt: now() })
      return copy(x)
    },

    async listInteractions(f) {
      return copy(d.interactions.filter((x) => (!f.contactId || x.contactId === f.contactId) && (!f.since || x.at >= f.since)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, f.limit ?? 200))
    },
    async addInteraction(input) {
      const ex = input.refId != null ? d.interactions.find((x) => x.contactId === input.contactId && x.refKind === input.refKind && x.refId === input.refId) : undefined
      if (ex) return { interaction: copy(ex), created: false }
      const x: Interaction = { ...input, id: id(), at: input.at ?? now() }
      d.interactions.push(x)
      return { interaction: copy(x), created: true }
    },

    async listTasks(f = {}) {
      return copy(
        d.tasks
          .filter((t) => (!f.status || t.status === f.status) && (!f.entityKind || t.entityKind === f.entityKind) && (!f.entityId || t.entityId === f.entityId) && (!f.assignee || t.assigneeProfileId === f.assignee))
          .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || b.createdAt.localeCompare(a.createdAt))
          .slice(0, f.limit ?? 500),
      )
    },
    async createTask(input) {
      const ex = input.dedupeKey ? d.tasks.find((t) => t.dedupeKey === input.dedupeKey) : undefined
      if (ex) return { task: copy(ex), created: false }
      const t: Task = { id: id(), detail: null, status: 'open', dueAt: null, assigneeProfileId: null, entityKind: null, entityId: null, source: 'manual', dedupeKey: null, ...input, createdAt: now(), completedAt: null, completedBy: null }
      d.tasks.push(t)
      return { task: copy(t), created: true }
    },
    async setTaskStatus(tid, status, by) {
      const t = d.tasks.find((x) => x.id === tid)
      if (!t) return null
      Object.assign(t, { status, completedAt: status === 'open' ? null : now(), completedBy: status === 'open' ? null : by })
      return copy(t)
    },

    async listDeliveries(f = {}) {
      return copy(
        d.deliveries
          .filter((x) => (!f.statuses || f.statuses.includes(x.status)) && (f.websiteOrderId == null || x.websiteOrderId === f.websiteOrderId) && (!f.itemId || x.itemId === f.itemId))
          .sort((a, b) => (a.scheduledFor ?? '9999').localeCompare(b.scheduledFor ?? '9999'))
          .slice(0, f.limit ?? 500),
      )
    },
    async getDelivery(did) {
      const x = d.deliveries.find((y) => y.id === did)
      return x ? copy(x) : null
    },

    async createDelivery(input) {
      const t = now()
      const x: Delivery = { id: id(), itemId: null, websiteOrderId: null, websiteOrderNumber: null, contactId: null, address: null, scheduledFor: null, timeWindow: null, assigneeProfileId: null, status: 'planned', note: null, ...input, createdAt: t, updatedAt: t }
      d.deliveries.push(x)
      return copy(x)
    },
    async updateDelivery(did, expectStatus, patch) {
      const x = d.deliveries.find((y) => y.id === did && y.status === expectStatus)
      if (!x) return null
      Object.assign(x, patch, { updatedAt: now() })
      return copy(x)
    },

    async ruleSettings() {
      return new Map(d.rules)
    },
    async setRule(rid, enabled) {
      d.rules.set(rid, enabled)
    },
    async getCursor(key) {
      return { ...(d.cursors.get(key) ?? { cursor: null, lastSuccessAt: null, lastError: null }) }
    },
    async setCursor(key, v) {
      const cur = d.cursors.get(key) ?? { cursor: null, lastSuccessAt: null, lastError: null }
      d.cursors.set(key, { cursor: v.cursor !== undefined ? v.cursor : cur.cursor, lastSuccessAt: v.ok ? now() : cur.lastSuccessAt, lastError: v.ok ? null : (v.error ?? 'failed') })
    },
  }
}
